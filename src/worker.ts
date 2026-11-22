// The worker reads Orca and GitHub on a fixed clock, builds the view model and pushes it to open
// panels, the status bar and (for stuck agents) desktop notifications. It never writes to an
// agent, terminal or bot: the only actions are focusing a terminal or showing a workspace.
import type { OrcaWorkerApi } from 'orca/worker'
import {
  alarmNotice,
  buildOffice,
  buildQueue,
  buildShipRow,
  freshAlarms,
  githubRepos,
  productNames,
  stuckAlarms,
  type RawGate,
  type RawPr,
  type RawRepo,
  type RawRun,
  type RawTask,
  type RawWorker,
  type RawWorkflowRun,
  type RawWorktree,
  type RunData
} from './model'
import { resolveTool } from './platform'
import { emptySnapshot, type Snapshot } from './protocol'
import { ghRead, orcaRead, PR_FIELDS, RUN_FIELDS } from './sources'

export const ORCA_EVERY_MS = 5_000
export const GH_EVERY_MS = 60_000
const SEEN_KEY = 'alarms.seen'

type Settings = { notifications: boolean; stuckMinutes: number; shipRepos: string; orcaPath: string }

async function readSettings(orca: OrcaWorkerApi): Promise<Settings> {
  const s = await orca.settings.get()
  return {
    notifications: s.notifications !== false,
    stuckMinutes: typeof s.stuckMinutes === 'number' && s.stuckMinutes > 0 ? s.stuckMinutes : 15,
    shipRepos: typeof s.shipRepos === 'string' ? s.shipRepos : '',
    orcaPath: typeof s.orcaPath === 'string' ? s.orcaPath : ''
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

      // Runs are a separate source: if they fail, the Office still shows.
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
      const queue = buildQueue(runs, workers, products, office)
      publish({ orcaAt: Date.now(), office, ...queue, errors: { orca: undefined, runs: runsError } })
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
    const seen = await orca.storage.get(SEEN_KEY)
    const { fresh, remember } = freshAlarms(
      stuckAlarms(snap.office, Date.now(), settings.stuckMinutes),
      Array.isArray(seen) ? seen.map(String) : []
    )
    await orca.storage.set(SEEN_KEY, remember)
    const notice = alarmNotice(fresh)
    if (notice && settings.notifications) await orca.host.call('notifications.show', notice).catch(() => undefined)
  }

  // One reading round at a time across both sources; asking for a round already queued is a no-op.
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

  const timers = [setInterval(() => enqueue(orcaRound), ORCA_EVERY_MS), setInterval(() => enqueue(ghRound), GH_EVERY_MS)]
  enqueue(orcaRound)
  enqueue(ghRound)

  // Agent and workspace changes refresh early instead of waiting for the next tick.
  for (const event of ['agent.status.changed', 'workspace.created', 'workspace.removed'] as const) {
    orca.events.on(event, () => enqueue(orcaRound))
  }
  orca.settings.onDidChange(() => {
    enqueue(orcaRound)
    enqueue(ghRound)
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
