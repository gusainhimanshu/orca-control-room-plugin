// The Overview: who hands work to whom. Pure: `buildOverview` turns what the worker already reads
// (bot items and their links, workers, agents, the inbox) into bots -> workers -> pull requests;
// `layoutOverview` places that as nodes on tiers and rows, with edges, for the panel to draw.
import type { AgentRow, AgentState, BotItems, Group, RawMessage, RawWorker, ShipRow } from './model'

export type WorkerState = AgentState | 'done'
export type PrRef = { ref: string; title: string; url: string | null; state: string; checks: string }
export type OverviewWorker = {
  key: string
  label: string
  state: WorkerState
  worktreeId: string | null
  address: string | null
  prs: PrRef[]
}
export type OverviewBot = {
  name: string
  /** The in-progress item, else what waits on you, else nothing. */
  doing: string
  open: number
  needsYou: number
  /** First line of the last thing the bot said, or ''. */
  lastSaid: string
  worktreeId: string | null
  address: string | null
  workers: OverviewWorker[]
  /** Pull requests its items link with no worker of theirs to hang them on. */
  prs: PrRef[]
}

const CLOSED = new Set(['completed', 'failed', 'cancelled', 'canceled', 'abandoned', 'done'])
const SETTLED = new Set([...CLOSED, 'settled', 'stopped', 'released'])

const firstLine = (s: string | null | undefined, max = 140) => {
  const line = (s ?? '').trim().split(/\r?\n/)[0].trim()
  return line.length > max ? line.slice(0, max - 1) + '…' : line
}

export type OverviewInput = {
  items: BotItems[]
  workers: RawWorker[]
  office: Group<AgentRow>[]
  /** Newest first, as the inbox prints them. */
  messages: RawMessage[]
  taskTitles: Map<string, string>
}

export function buildOverview(input: OverviewInput): OverviewBot[] {
  const agents = new Map(input.office.flatMap((g) => g.items.map((a) => [a.address, a] as const)))
  const byDispatch = new Map(input.workers.filter((w) => w.dispatchId).map((w) => [w.dispatchId!, w]))

  return input.items.map(({ bot, items }) => {
    const open = items.filter((i) => !CLOSED.has((i.status ?? '').toLowerCase()))
    const chats = new Set(open.map((i) => i.chat?.id).filter((id): id is string => !!id).map((id) => `orca_session_id:${id}`))
    const chatAgent = [...chats].map((a) => agents.get(a)).find((a) => a)
    const workers = new Map<string, OverviewWorker>()
    const prs: PrRef[] = []

    const addWorker = (dispatchId: string, label?: string, linkState?: string) => {
      const known = workers.get(dispatchId)
      if (known) return known
      const w = byDispatch.get(dispatchId)
      const agent = w?.terminal ? agents.get(w.terminal) : undefined
      const state: WorkerState = agent?.state ?? (SETTLED.has((linkState ?? '').toLowerCase()) ? 'done' : 'idle')
      const row: OverviewWorker = {
        key: dispatchId,
        label: label || (w?.taskId && input.taskTitles.get(w.taskId)) || 'worker',
        state,
        worktreeId: w?.workspace ?? null,
        address: w?.terminal ?? null,
        prs: []
      }
      workers.set(dispatchId, row)
      return row
    }

    for (const item of open) {
      const mine: OverviewWorker[] = []
      for (const l of item.links ?? []) {
        const id = l.latest || l.ref
        if (l.kind === 'dispatch' && id) mine.push(addWorker(id, l.title, l.state))
      }
      for (const l of item.links ?? []) {
        const ref = l.pr?.ref ?? (l.kind === 'pr' ? l.ref : undefined)
        if (!ref) continue
        const pr = { ref, title: l.pr?.title ?? '', url: l.pr?.url ?? null, state: l.pr?.state ?? 'open', checks: l.pr?.checks ?? '' }
        // The item's latest worker opened it, as far as the links tell; else it hangs off the bot.
        const owner = mine[mine.length - 1]
        const list = owner ? owner.prs : prs
        if (!list.some((p) => p.ref === ref)) list.push(pr)
      }
    }
    // Mail the bot sent to a Dispatch also means it handed that worker work.
    for (const m of input.messages) {
      if (m.from && chats.has(m.from) && m.to?.startsWith('dispatch:')) addWorker(m.to.slice('dispatch:'.length))
    }

    const said = input.messages.find((m) => m.from && chats.has(m.from))
    const inProgress = open.find((i) => (i.status ?? '').toLowerCase() === 'in_progress')
    const waiting = open.filter((i) => (i.status ?? '').toLowerCase() === 'needs_you')
    return {
      name: bot,
      doing: inProgress?.title ?? (waiting[0] ? `Waiting on you: ${waiting[0].title ?? ''}`.trim() : 'Nothing open'),
      open: open.length,
      needsYou: waiting.length,
      lastSaid: (chatAgent?.state !== 'waiting' && chatAgent?.detail) || firstLine(said?.body) || firstLine(said?.subject),
      worktreeId: chatAgent?.worktreeId ?? null,
      address: chatAgent?.address ?? null,
      workers: [...workers.values()],
      prs
    }
  })
}

// ---- Layout ----
export type NodeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
export type OverviewNode = {
  id: string
  kind: 'owner' | 'bot' | 'worker' | 'pr'
  label: string
  sub: string
  /** Depth: 0 owner, 1 bots, 2 workers (and a bot's own PRs), 3 a worker's PRs. */
  tier: number
  /** Top-to-bottom position; every node has its own row. */
  row: number
  tone: NodeTone
  /** Waiting on the owner: drawn amber. */
  waiting: boolean
  nav: { worktreeId: string; address: string | null } | { url: string } | null
}
export type OverviewEdge = { from: string; to: string; waiting: boolean }

const WORKER_TONE: Record<WorkerState, NodeTone> = { waiting: 'warning', errored: 'danger', working: 'accent', idle: 'neutral', done: 'neutral' }
const WORKER_WORD: Record<WorkerState, string> = { waiting: 'waiting on you', errored: 'errored', working: 'working', idle: 'idle', done: 'done' }

/** CI tone of a pull request: what its item link says, else the Ship board's reading. */
export function prTone(pr: PrRef, ship: ShipRow[]): { tone: NodeTone; word: string } {
  if (pr.state && pr.state !== 'open') return { tone: 'neutral', word: pr.state }
  let c = pr.checks.toLowerCase()
  if (!c) {
    const m = /^([^#\s]+)#(\d+)$/.exec(pr.ref)
    const row = m && ship.find((r) => r.repo.toLowerCase() === m[1].toLowerCase())?.prs.find((p) => p.number === Number(m[2]))
    c = row ? { pass: 'success', fail: 'failure', pending: 'pending', none: '' }[row.checks] : ''
  }
  if (c === 'success') return { tone: 'success', word: 'checks pass' }
  if (c === 'pending') return { tone: 'warning', word: 'checks running' }
  if (c) return { tone: 'danger', word: 'checks fail' }
  return { tone: 'neutral', word: 'no checks' }
}

export function layoutOverview(bots: OverviewBot[], ship: ShipRow[]): { nodes: OverviewNode[]; edges: OverviewEdge[] } {
  const nodes: OverviewNode[] = []
  const edges: OverviewEdge[] = []
  const add = (n: Omit<OverviewNode, 'row'>, parent: string | null) => {
    nodes.push({ ...n, row: nodes.length })
    if (parent) edges.push({ from: parent, to: n.id, waiting: n.waiting })
  }
  const waitingAll = bots.reduce((sum, b) => sum + b.needsYou, 0)
  add({ id: 'owner', kind: 'owner', label: 'You', sub: waitingAll ? `${waitingAll} waiting on you` : '', tier: 0, tone: waitingAll ? 'warning' : 'neutral', waiting: waitingAll > 0, nav: null }, null)
  const prNode = (pr: PrRef, parent: string, tier: number) => {
    const { tone, word } = prTone(pr, ship)
    add({ id: `pr:${parent}:${pr.ref}`, kind: 'pr', label: pr.ref, sub: [word, pr.title].filter(Boolean).join(' · '), tier, tone, waiting: false, nav: pr.url ? { url: pr.url } : null }, parent)
  }
  for (const b of bots) {
    const id = `bot:${b.name}`
    add(
      {
        id,
        kind: 'bot',
        label: b.name,
        sub: b.needsYou ? `${b.needsYou} waiting on you` : `${b.open} open`,
        tier: 1,
        tone: b.needsYou ? 'warning' : b.workers.some((w) => w.state === 'working') ? 'accent' : 'neutral',
        waiting: b.needsYou > 0,
        nav: b.worktreeId ? { worktreeId: b.worktreeId, address: b.address } : null
      },
      'owner'
    )
    for (const w of b.workers) {
      const wid = `worker:${b.name}:${w.key}`
      add(
        { id: wid, kind: 'worker', label: w.label, sub: WORKER_WORD[w.state], tier: 2, tone: WORKER_TONE[w.state], waiting: w.state === 'waiting', nav: w.worktreeId ? { worktreeId: w.worktreeId, address: w.address } : null },
        id
      )
      for (const pr of w.prs) prNode(pr, wid, 3)
    }
    for (const pr of b.prs) prNode(pr, id, 2)
  }
  return { nodes, edges }
}
