// The worker reads Orca and GitHub, and pings the sites the user lists, on a fixed clock, builds
// the view model and pushes it to open panels, the status bar and (for stuck agents and sites that
// go down or come back) desktop notifications. It never writes to an agent, terminal or bot. Its
// actions: focusing a terminal, showing a workspace, and resolving a decision gate the owner
// confirmed in the panel (only while "Allow answering from the panel" is on).
import type { OrcaWorkerApi } from 'orca/worker'
import {
  alarmNotice,
  buildFlows,
  buildOffice,
  buildQueue,
  buildShipRow,
  fromFullInbox,
  freshAlarms,
  githubRepos,
  productNames,
  resolveRefusal,
  stuckAlarms,
  type BotItems,
  type RawGate,
  type RawItem,
  type RawFullMessage,
  type RawMessage,
  type RawPr,
  type RawRepo,
  type RawRun,
  type RawTask,
  type RawWorker,
  type RawWorkflowRun,
  type RawWorktree,
  type RunData
} from './model'
import { buildOverview } from './overview'
import { resolveTool } from './platform'
import { emptySnapshot, type Snapshot } from './protocol'
import { nextSiteRows, parseSites, ping, siteAlarms, siteNotice } from './sites'
import { ghRead, orcaRead, orcaWrite, PR_FIELDS, RUN_FIELDS } from './sources'

export const ORCA_EVERY_MS = 5_000
export const GH_EVERY_MS = 60_000
export const SITES_EVERY_MS = 60_000
const FLOW_LIMIT = 40
const SEEN_KEY = 'alarms.seen'

type Settings = { notifications: boolean; stuckMinutes: number; shipRepos: string; orcaPath: string; sites: string; allowAnswer: boolean }

async function readSettings(orca: OrcaWorkerApi): Promise<Settings> {
  const s = await orca.settings.get()
  return {
    notifications: s.notifications !== false,
    stuckMinutes: typeof s.stuckMinutes === 'number' && s.stuckMinutes > 0 ? s.stuckMinutes : 15,
    shipRepos: typeof s.shipRepos === 'string' ? s.shipRepos : '',
    orcaPath: typeof s.orcaPath === 'string' ? s.orcaPath : '',
    sites: typeof s.sites === 'string' ? s.sites : '',
    allowAnswer: s.allowAnswer !== false
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function activate(orca: OrcaWorkerApi): void {
  let snap: Snapshot = emptySnapshot()
  let repos: RawRepo[] = []
  let stopped = false

  const publish = (next: Partial<Snapshot>) => {
    // An error set to undefined is cleared; dropping the key keeps the snapshot plain JSON.
    const errors = JSON.parse(JSON.stringify({ ...snap.errors, ...next.errors })) as Snapshot['errors']
    snap = { ...snap, ...next, errors }
    orca.panels.post('snapshot', snap)
  }

  async function orcaRound(): Promise<void> {
    const settings = await readSettings(orca)
    const bin = resolveTool('orca', settings.orcaPath)
    if (!bin) return publish({ errors: { orca: 'Orca CLI not found. Set its path in Settings.' } })
    try {
      const [repoList, ps] = await Promise.all([
        orcaRead<{ repos: RawRepo[] }>(bin, 'repo list'),
        orcaRead<{ worktrees: RawWorktree[] }>(bin, 'worktree ps', ['--limit', '500'])
      ])
      repos = repoList.repos ?? []
      const products = productNames(repos)
      const office = buildOffice(ps.worktrees ?? [], products)

      // Bot items: the owner's queue. A separate source, so a failure leaves the rest showing.
      let items: BotItems[] = []
      let botsError: string | undefined
      try {
        const bots = await orcaRead<{ bots: { name: string }[] }>(bin, 'bot list')
        items = await Promise.all(
          (bots.bots ?? []).map(async ({ name }) => {
            // Open items only (needs you, in progress, planned): the CLI's default.
            const r = await orcaRead<{ items: RawItem[] }>(bin, 'bot item list', ['--bot', name, '--limit', '100'])
            return { bot: name, items: r.items ?? [] }
          })
        )
      } catch (e) {
        botsError = message(e)
      }

      // Runs supplement the items with decision gates and untracked tasks.
      let runs: RunData[] = []
      let workers: RawWorker[] = []
      let runsError: string | undefined
      try {
        const list = await orcaRead<{ runs: RawRun[] }>(bin, 'orchestration run-list')
        const live = (list.runs ?? []).filter((r) => !r.legacy)
        ;[runs, workers] = await Promise.all([
          Promise.all(
            live.map(async (run) => {
              const [t, g] = await Promise.all([
                orcaRead<{ tasks: RawTask[] }>(bin, 'orchestration task-list', ['--run', run.id]),
                orcaRead<{ gates: RawGate[] }>(bin, 'orchestration gate-list', ['--run', run.id])
              ])
              return { run, tasks: t.tasks ?? [], gates: g.gates ?? [] }
            })
          ),
          orcaRead<{ workers: RawWorker[] }>(bin, 'orchestration worker-list', ['--limit', '100']).then((w) => w.workers ?? [])
        ])
      } catch (e) {
        runsError = message(e)
      }
      // Flows: the last messages across every mailbox.
      let flows = snap.flows
      let flowsError: string | undefined
      let messages: RawMessage[] = []
      const titles = new Map(runs.flatMap((r) => r.tasks.map((t) => [t.id, t.title ?? t.id] as [string, string])))
      try {
        // --full: the concise view has no send time, which a collapsed Flows group needs.
        const inbox = await orcaRead<{ messages: RawFullMessage[] }>(bin, 'orchestration inbox', ['--limit', String(FLOW_LIMIT), '--full'])
        messages = (inbox.messages ?? []).map(fromFullInbox)
        flows = buildFlows(messages, workers, products, titles)
      } catch (e) {
        flowsError = message(e)
      }
      const repoProducts = new Map(githubRepos(repos).map((r) => [r.repo.toLowerCase(), r.product]))
      const queue = buildQueue({ items, runs, workers, products, repoProducts, office })
      const overview = buildOverview({ items, workers, office, messages, taskTitles: titles })
      publish({ orcaAt: Date.now(), office, flows, overview, ...queue, projects: [...new Set(products.values())], allowAnswer: settings.allowAnswer, errors: { orca: undefined, bots: botsError, runs: runsError, flows: flowsError } })
      await statusBar(queue.needsYou.length)
      await alarm(settings)
    } catch (e) {
      publish({ errors: { orca: message(e) } })
    }
  }

  async function ghRound(): Promise<void> {
    const settings = await readSettings(orca)
    const bin = resolveTool('gh')
    if (!bin) return publish({ ghAt: Date.now(), errors: { gh: 'GitHub CLI (gh) not found on PATH.' } })
    const watched = settings.shipRepos
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((repo) => ({ repo, product: githubRepos(repos).find((r) => r.repo.toLowerCase() === repo.toLowerCase())?.product ?? repo }))
    const targets = watched.length ? watched : githubRepos(repos)
    const ship = await mapLimit(targets, 4, async ({ product, repo }) => {
      try {
        const [prs, runs] = await Promise.all([
          ghRead<RawPr[]>(bin, 'pr list', repo, ['--state', 'open', '--limit', '30', '--json', PR_FIELDS]),
          ghRead<RawWorkflowRun[]>(bin, 'run list', repo, ['--limit', '1', '--json', RUN_FIELDS])
        ])
        return buildShipRow(product, repo, prs, runs, null)
      } catch (e) {
        return buildShipRow(product, repo, null, null, message(e))
      }
    })
    ship.sort((a, b) => a.product.localeCompare(b.product))
    const failing = ship.length > 0 && ship.every((s) => s.error)
    publish({ ghAt: Date.now(), ship, errors: { gh: failing ? ship[0].error ?? undefined : undefined } })
  }

  async function sitesRound(): Promise<void> {
    const { sites, errors } = parseSites((await readSettings(orca)).sites)
    // No sites, no request: an empty setting never touches the network.
    const results = await mapLimit(sites, 4, (site) => ping(site.url, fetch))
    publish({ sitesAt: Date.now(), sites: nextSiteRows(snap.sites, sites, results, Date.now()), siteErrors: errors })
  }

  async function statusBar(count: number): Promise<void> {
    await orca.host
      .call('statusBar.update', {
        id: 'control-room',
        text: `Control Room · ${count} to decide`,
        tone: count > 0 ? 'warning' : 'neutral'
      })
      .catch(() => undefined)
  }

  async function alarm(settings: Settings): Promise<void> {
    const stored = await orca.storage.get(SEEN_KEY)
    const seen = Array.isArray(stored) ? stored.map(String) : []
    const isSite = (key: string) => key.startsWith('site:')
    const { fresh, remember } = freshAlarms(
      [...stuckAlarms(snap.office, Date.now(), settings.stuckMinutes), ...siteAlarms(snap.sites)],
      seen
    )
    // Until this worker has pinged once, keep the remembered site events so a restart does not re-announce them.
    await orca.storage.set(SEEN_KEY, snap.sitesAt ? remember : [...remember, ...seen.filter(isSite)])
    if (!settings.notifications) return
    for (const notice of [alarmNotice(fresh.filter((a) => !isSite(a.key))), siteNotice(fresh.filter((a) => isSite(a.key)))]) {
      if (notice) await orca.host.call('notifications.show', notice).catch(() => undefined)
    }
  }

  // One reading round at a time across all sources; asking for a round already queued is a no-op.
  let chain: Promise<void> = Promise.resolve()
  const queued = new Set<() => Promise<void>>()
  const enqueue = (round: () => Promise<void>) => {
    if (stopped || queued.has(round)) return
    queued.add(round)
    chain = chain.then(async () => {
      queued.delete(round)
      await round().catch((e) => orca.log(`round failed: ${message(e)}`))
    })
  }

  const timers = [
    setInterval(() => enqueue(orcaRound), ORCA_EVERY_MS),
    setInterval(() => enqueue(ghRound), GH_EVERY_MS),
    setInterval(() => enqueue(sitesRound), SITES_EVERY_MS)
  ]
  enqueue(orcaRound)
  enqueue(ghRound)
  enqueue(sitesRound)

  // Agent and workspace changes refresh early instead of waiting for the next tick.
  for (const event of ['agent.status.changed', 'workspace.created', 'workspace.removed'] as const) {
    orca.events.on(event, () => enqueue(orcaRound))
  }
  orca.settings.onDidChange(() => {
    enqueue(orcaRound)
    enqueue(ghRound)
    enqueue(sitesRound)
  })

  orca.panels.handle('snapshot.get', async () => snap)

  orca.panels.handle('navigate', async ({ worktreeId, address }) => {
    if (address?.startsWith('term_')) {
      const r = await orca.host.call('terminal.focus', { terminalId: address }).catch(() => null)
      if (r?.focused) return { ok: true }
    }
    // Chats and closed terminals: show the workspace they live in.
    const r = await orca.host.call('workspace.open', { workspaceId: worktreeId }).catch(() => null)
    return { ok: !!r?.opened }
  })

  orca.panels.handle('gate.resolve', async ({ gateId, resolution }) => {
    // Checked again here, against fresh settings and the latest reading: the panel's view may be stale.
    const settings = await readSettings(orca)
    const refusal = resolveRefusal(snap.needsYou, settings.allowAnswer, gateId, resolution)
    if (refusal) return { ok: false, error: refusal }
    const bin = resolveTool('orca', settings.orcaPath)
    if (!bin) return { ok: false, error: 'Orca CLI not found. Set its path in Settings.' }
    try {
      await orcaWrite(bin, 'orchestration gate-resolve', ['--id', gateId, '--resolution', resolution.trim()])
      orca.log(`resolved gate ${gateId} from the panel`)
      enqueue(orcaRound)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: message(e) }
    }
  })

  stop = () => {
    stopped = true
    timers.forEach(clearInterval)
  }
}

let stop: () => void = () => undefined
export function deactivate(): void {
  stop()
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    })
  )
  return out
}
