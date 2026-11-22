// Pure functions from raw CLI JSON to what the panel draws. No I/O, no clock: tests feed invented data.

// ---- Raw shapes (only the fields we read; everything optional because the CLI may change) ----
export type RawRepo = { id: string; displayName?: string; path?: string; gitRemoteIdentity?: { canonicalKey?: string } | null }
export type RawAgent = {
  paneKey: string
  address?: string
  state?: string
  agentType?: string
  stateStartedAt?: number
  conversationName?: string | null
  taskTitle?: string | null
  displayName?: string | null
  toolName?: string | null
  lastAssistantMessage?: string | null
  mainAgent?: { outcome?: string } | null
}
export type RawWorktree = { worktreeId: string; repoId?: string; repo?: string; displayName?: string; agents?: RawAgent[] }
export type RawRun = { id: string; objective?: string; legacy?: boolean }
export type RawTask = { id: string; status?: string; title?: string; dispatchId?: string }
export type RawGate = { id: string; taskId?: string; question?: string; options?: unknown; status?: string; createdAt?: number }
export type RawWorker = { taskId?: string; dispatchId?: string; workspace?: string; terminal?: string }
/** One row of `orca orchestration inbox --json` (concise view: body already cut to 200 characters). */
export type RawMessage = {
  id: string
  type?: string
  from?: string
  to?: string
  subject?: string
  handled?: boolean
  body?: string
  payload?: { taskId?: string; dispatchId?: string } | null
}
export type RawDecision = { question?: string; replies?: { label?: string; recommended?: boolean }[] }
export type RawItemLink = { kind?: string; ref?: string; latest?: string; pr?: { ref?: string; worktreeId?: string } | null }
/** One row of `orca bot item list --json` (status words as --json prints them: needs_you, in_progress, ...). */
export type RawItem = {
  uid: string
  number?: number
  title?: string
  status?: string
  question?: { text?: string; gist?: string; decisions?: RawDecision[] } | null
  links?: RawItemLink[]
  /** The bot chat the item lives in; its agent's address is `orca_session_id:<id>`. */
  chat?: { id?: string } | null
  lastActivityAt?: number
  updatedAt?: number
}
export type BotItems = { bot: string; items: RawItem[] }
export type RawCheck = { status?: string; conclusion?: string; state?: string }
export type RawPr = {
  number: number
  title: string
  url: string
  isDraft?: boolean
  reviewDecision?: string | null
  statusCheckRollup?: RawCheck[] | null
}
export type RawWorkflowRun = { status?: string; conclusion?: string; name?: string; workflowName?: string; url?: string; createdAt?: string }

// ---- View model ----
export type AgentState = 'working' | 'waiting' | 'idle' | 'errored'
export type AgentRow = {
  key: string
  title: string
  agent: string
  workspace: string
  state: AgentState
  since: number
  detail: string
  worktreeId: string
  address: string
}
export type Group<T> = { product: string; items: T[] }
export type Decision = { prompt: string; options: string[] }
export type NeedRow = {
  key: string
  kind: 'item' | 'gate' | 'agent'
  product: string
  title: string
  /** Who asks: the bot's name, or null for an agent or a Run's gate. */
  from: string | null
  question: string
  decisions: Decision[]
  since: number | null
  worktreeId: string | null
  address: string | null
}
/** `via`: the bot that owns the item, or the Run's objective. */
export type TaskRow = { key: string; title: string; status: string; via: string }
/** One inter-agent message. `line` is only the body's first line, cut short; full bodies are never kept. */
export type FlowRow = {
  key: string
  from: string
  to: string
  type: string
  subject: string
  line: string
  /** An unanswered question or escalation. */
  waiting: boolean
  worktreeId: string | null
  address: string | null
}
export type Checks = 'pass' | 'fail' | 'pending' | 'none'
export type Review = 'approved' | 'changes' | 'required' | 'none'
export type PrRow = { number: number; title: string; url: string; draft: boolean; checks: Checks; review: Review }
export type ShipRow = {
  product: string
  repo: string
  prs: PrRow[]
  latestRun: { name: string; result: 'pass' | 'fail' | 'running'; url: string; at: number } | null
  error: string | null
}

const OTHER = 'Other'

/** repoId -> product name. */
export function productNames(repos: RawRepo[]): Map<string, string> {
  return new Map(repos.map((r) => [r.id, r.displayName || r.path || r.id]))
}

/** "owner/name" for each GitHub-backed project. */
export function githubRepos(repos: RawRepo[]): { product: string; repo: string }[] {
  const out: { product: string; repo: string }[] = []
  for (const r of repos) {
    const key = r.gitRemoteIdentity?.canonicalKey ?? ''
    const m = /^github\.com\/([^/]+\/[^/]+)$/i.exec(key)
    if (m) out.push({ product: r.displayName || m[1], repo: m[1] })
  }
  return out
}

export function agentState(a: RawAgent): AgentState {
  if (a.mainAgent?.outcome === 'failure') return 'errored'
  if (a.state === 'working') return 'working'
  if (a.state === 'blocked' || a.state === 'waiting') return 'waiting'
  return 'idle'
}

const firstLine = (s: string | null | undefined, max = 140) => {
  const line = (s ?? '').trim().split(/\r?\n/)[0].trim()
  return line.length > max ? line.slice(0, max - 1) + '…' : line
}

/** Agents that still have a terminal or chat to go to, grouped by product. */
export function buildOffice(worktrees: RawWorktree[], products: Map<string, string>): Group<AgentRow>[] {
  const rows: (AgentRow & { product: string })[] = []
  for (const w of worktrees) {
    for (const a of w.agents ?? []) {
      // No address means a finished session Orca only remembers: nothing to focus, nothing to watch.
      if (!a.address) continue
      const state = agentState(a)
      rows.push({
        key: a.paneKey,
        product: (w.repoId && products.get(w.repoId)) || w.repo || OTHER,
        title: a.conversationName || a.taskTitle || a.displayName || a.agentType || 'Agent',
        agent: a.agentType ?? 'agent',
        workspace: w.displayName ?? '',
        state,
        since: a.stateStartedAt ?? 0,
        detail: state === 'waiting' && a.toolName ? `Wants to use ${a.toolName}` : firstLine(a.lastAssistantMessage),
        worktreeId: w.worktreeId,
        address: a.address
      })
    }
  }
  const order: Record<AgentState, number> = { waiting: 0, errored: 1, working: 2, idle: 3 }
  rows.sort((x, y) => order[x.state] - order[y.state] || y.since - x.since)
  return groupBy(rows, (r) => r.product).map((g) => ({
    product: g.product,
    items: g.items.map(({ product: _p, ...row }) => row)
  }))
}

const CLOSED_GATE = new Set(['resolved', 'answered', 'closed', 'cancelled', 'canceled', 'denied', 'expired'])
const CLOSED = new Set(['completed', 'failed', 'cancelled', 'canceled', 'abandoned', 'done'])
const STATUS_WORD: Record<string, string> = { needs_you: 'needs you', in_progress: 'in progress' }

export type RunData = { run: RawRun; tasks: RawTask[]; gates: RawGate[] }
export type QueueInput = {
  items: BotItems[]
  runs: RunData[]
  workers: RawWorker[]
  products: Map<string, string>
  /** "owner/name" (lowercase) -> product, for items that link a pull request. */
  repoProducts: Map<string, string>
  office: Group<AgentRow>[]
}

const repoIdOf = (worktreeId?: string | null) => worktreeId?.split('::')[0] ?? ''

/** A bot item's product: the workspace, Dispatch or repo its links point at. */
function itemProduct(item: RawItem, input: QueueInput, byDispatch: Map<string, string>): string | null {
  for (const l of item.links ?? []) {
    const fromWorktree = input.products.get(repoIdOf(l.pr?.worktreeId))
    if (fromWorktree) return fromWorktree
    for (const ref of [l.ref, l.latest]) if (ref && byDispatch.has(ref)) return byDispatch.get(ref)!
    const prRef = l.pr?.ref ?? (l.kind === 'pr' ? l.ref : undefined) ?? ''
    const repo = /^([^/#\s]+\/[^/#\s]+)#\d+$/.exec(prRef)?.[1]?.toLowerCase()
    if (repo && input.repoProducts.has(repo)) return input.repoProducts.get(repo)!
  }
  return null
}

function itemDecisions(q: RawItem['question']): Decision[] {
  return (q?.decisions ?? []).map((d) => ({
    prompt: d.question ?? '',
    options: (d.replies ?? []).map((r) => `${r.label ?? ''}${r.recommended ? ' (recommended)' : ''}`)
  }))
}

/** taskId -> product and dispatchId -> product, from the workspace each worker runs in. */
function workerProducts(workers: RawWorker[], products: Map<string, string>) {
  const byTask = new Map<string, string>()
  const byDispatch = new Map<string, string>()
  for (const w of workers) {
    const name = products.get(repoIdOf(w.workspace))
    if (!name) continue
    if (w.taskId) byTask.set(w.taskId, name)
    if (w.dispatchId) byDispatch.set(w.dispatchId, name)
  }
  return { byTask, byDispatch }
}

export function buildQueue(input: QueueInput): { needsYou: NeedRow[]; open: Group<TaskRow>[] } {
  const { products } = input
  const needsYou: NeedRow[] = []
  const open: (TaskRow & { product: string })[] = []
  const { byTask, byDispatch } = workerProducts(input.workers, products)

  // Bot items are the owner's queue.
  const itemDispatches = new Set<string>()
  const agents = new Map(input.office.flatMap((g) => g.items.map((a) => [a.address, a] as const)))
  for (const { bot, items } of input.items) {
    const mapped = items.map((i) => itemProduct(i, input, byDispatch))
    // An item that links nothing belongs to the product the bot's other items work in.
    const botProduct = mostCommon(mapped.filter((p): p is string => !!p)) ?? OTHER
    items.forEach((item, at) => {
      for (const l of item.links ?? []) {
        if (l.kind === 'dispatch') [l.ref, l.latest].forEach((r) => r && itemDispatches.add(r))
      }
      const status = (item.status ?? '').toLowerCase()
      if (CLOSED.has(status)) return
      const product = mapped[at] ?? botProduct
      const title = item.title || `#${item.number ?? item.uid}`
      if (status === 'needs_you') {
        const q = item.question
        // The bot's chat, when Orca shows it as an agent: pressing the item (or an option) goes there.
        const chat = item.chat?.id ? agents.get(`orca_session_id:${item.chat.id}`) : undefined
        needsYou.push({
          key: `item:${item.uid}`,
          kind: 'item',
          product,
          title,
          from: bot,
          question: firstLine(q?.gist || q?.text, 300),
          decisions: itemDecisions(q),
          since: item.lastActivityAt ?? item.updatedAt ?? null,
          worktreeId: chat?.worktreeId ?? null,
          address: chat?.address ?? null
        })
      } else {
        open.push({ key: `item:${item.uid}`, product, title, status: STATUS_WORD[status] ?? status, via: bot })
      }
    })
  }

  // Orchestration Runs add decision gates, and tasks no bot item already tracks.
  for (const { run, tasks, gates } of input.runs) {
    const runProduct = mostCommon(tasks.map((t) => byTask.get(t.id)).filter((p): p is string => !!p))
    const productOf = (taskId?: string) => (taskId && byTask.get(taskId)) || runProduct || OTHER
    const titles = new Map(tasks.map((t) => [t.id, t.title ?? t.id]))
    for (const g of gates) {
      if (CLOSED_GATE.has((g.status ?? '').toLowerCase())) continue
      const options = Array.isArray(g.options) ? g.options.map(String) : []
      needsYou.push({
        key: `gate:${g.id}`,
        kind: 'gate',
        product: productOf(g.taskId),
        title: (g.taskId && titles.get(g.taskId)) || run.objective || 'Decision',
        from: null,
        question: g.question ?? '',
        decisions: options.length ? [{ prompt: '', options }] : [],
        since: g.createdAt ?? null,
        worktreeId: null,
        address: null
      })
    }
    for (const t of tasks) {
      const status = (t.status ?? '').toLowerCase()
      if (CLOSED.has(status) || (t.dispatchId && itemDispatches.has(t.dispatchId))) continue
      open.push({ key: `task:${t.id}`, product: productOf(t.id), title: t.title ?? t.id, status, via: run.objective ?? run.id })
    }
  }

  for (const g of input.office) {
    for (const a of g.items) {
      if (a.state !== 'waiting') continue
      needsYou.push({
        key: `agent:${a.key}`,
        kind: 'agent',
        product: g.product,
        title: a.title,
        from: null,
        question: a.detail || 'Waiting for your answer',
        decisions: [],
        since: a.since,
        worktreeId: a.worktreeId,
        address: a.address
      })
    }
  }
  needsYou.sort((x, y) => (x.since ?? 0) - (y.since ?? 0))
  return {
    needsYou,
    open: groupBy(open, (t) => t.product).map((g) => ({
      product: g.product,
      items: g.items.map(({ product: _p, ...row }) => row)
    }))
  }
}

// ---- Answering a decision gate from the panel ----
export const MAX_RESOLUTION = 2_000

/**
 * Why a `gate.resolve` request must not be sent, or null when it may: the setting allows it, the gate
 * is one the owner sees as waiting right now, and the answer is non-empty text of sane length.
 */
export function resolveRefusal(needsYou: NeedRow[], allowed: boolean, gateId: unknown, resolution: unknown): string | null {
  if (!allowed) return 'Answering from the panel is turned off in Settings.'
  if (typeof gateId !== 'string' || !needsYou.some((n) => n.kind === 'gate' && n.key === `gate:${gateId}`))
    return 'That decision is no longer waiting on you.'
  if (typeof resolution !== 'string' || !resolution.trim()) return 'Write an answer first.'
  if (resolution.length > MAX_RESOLUTION) return `Keep the answer under ${MAX_RESOLUTION} characters.`
  return null
}

// ---- Flows: recent inter-agent messages ----
const ASKS = new Set(['question', 'escalation'])
const dispatchOf = (handle?: string) => (handle?.startsWith('dispatch:') ? handle.slice('dispatch:'.length) : undefined)

/** Recent messages, newest first (the inbox's own order), grouped by the product their task works in. */
export function buildFlows(
  messages: RawMessage[],
  workers: RawWorker[],
  products: Map<string, string>,
  taskTitles: Map<string, string>
): Group<FlowRow>[] {
  const { byTask, byDispatch } = workerProducts(workers, products)
  const byTerminal = new Map(workers.filter((w) => w.terminal).map((w) => [w.terminal!, w]))
  const byDispatchWorker = new Map(workers.filter((w) => w.dispatchId).map((w) => [w.dispatchId!, w]))
  const workerOf = (handle?: string) =>
    (handle && byTerminal.get(handle)) || byDispatchWorker.get(dispatchOf(handle) ?? '') || undefined
  const label = (handle?: string) => {
    const h = handle ?? ''
    const w = workerOf(h)
    if (w) return (w.taskId && taskTitles.get(w.taskId)) || 'worker'
    if (h.startsWith('run:')) return 'coordinator'
    if (h.startsWith('dispatch:') || h.startsWith('structworker_')) return 'worker'
    if (h.startsWith('orca_session_id:bot-')) return 'bot'
    return h ? 'agent' : '?'
  }
  const rows = messages.map((m) => {
    const p = m.payload ?? {}
    const dispatch = p.dispatchId ?? dispatchOf(m.to)
    const target = workerOf(m.from) ?? workerOf(m.to) ?? (dispatch ? byDispatchWorker.get(dispatch) : undefined)
    const type = m.type ?? 'message'
    return {
      key: m.id,
      product:
        (dispatch && byDispatch.get(dispatch)) ||
        (p.taskId && byTask.get(p.taskId)) ||
        (target && products.get(repoIdOf(target.workspace))) ||
        OTHER,
      from: label(m.from),
      to: label(m.to),
      type,
      subject: firstLine(m.subject, 120),
      line: firstLine(m.body, 120),
      waiting: ASKS.has(type) && !m.handled,
      worktreeId: target?.workspace ?? null,
      address: target?.terminal ?? null
    }
  })
  return groupBy(rows, (r) => r.product).map((g) => ({
    product: g.product,
    items: g.items.map(({ product: _p, ...row }) => row)
  }))
}

const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'])

export function checksState(rollup: RawCheck[] | null | undefined): Checks {
  if (!rollup?.length) return 'none'
  let pending = false
  for (const c of rollup) {
    if (FAILED.has((c.conclusion ?? c.state ?? '').toUpperCase())) return 'fail'
    const done = c.status ? c.status.toUpperCase() === 'COMPLETED' : !['PENDING', 'EXPECTED'].includes((c.state ?? '').toUpperCase())
    if (!done) pending = true
  }
  return pending ? 'pending' : 'pass'
}

export function reviewState(decision: string | null | undefined): Review {
  switch ((decision ?? '').toUpperCase()) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes'
    case 'REVIEW_REQUIRED':
      return 'required'
    default:
      return 'none'
  }
}

export function buildShipRow(
  product: string,
  repo: string,
  prs: RawPr[] | null,
  runs: RawWorkflowRun[] | null,
  error: string | null
): ShipRow {
  const run = runs?.[0]
  return {
    product,
    repo,
    error,
    prs: (prs ?? []).map((p) => ({
      number: p.number,
      title: p.title,
      url: p.url,
      draft: !!p.isDraft,
      checks: checksState(p.statusCheckRollup),
      review: reviewState(p.reviewDecision)
    })),
    latestRun: run
      ? {
          name: run.workflowName || run.name || 'Workflow',
          result: run.status !== 'completed' ? 'running' : run.conclusion === 'success' ? 'pass' : 'fail',
          url: run.url ?? '',
          at: run.createdAt ? Date.parse(run.createdAt) : 0
        }
      : null
  }
}

// ---- Stuck-agent alarm ----
export type Alarm = { key: string; text: string }

/** Every agent that is stuck right now; `key` names the event so it is announced once. */
export function stuckAlarms(office: Group<AgentRow>[], now: number, thresholdMinutes: number): Alarm[] {
  const limit = thresholdMinutes * 60_000
  const out: Alarm[] = []
  for (const g of office) {
    for (const a of g.items) {
      const long = a.since > 0 && now - a.since >= limit
      const label = `${a.title} (${g.product})`
      if (a.state === 'errored') out.push({ key: `${a.key}:errored:${a.since}`, text: `${label} errored` })
      else if (a.state === 'waiting' && long) out.push({ key: `${a.key}:waiting:${a.since}`, text: `${label} is waiting on you` })
      else if (a.state === 'idle' && long) out.push({ key: `${a.key}:idle:${a.since}`, text: `${label} is idle` })
    }
  }
  return out
}

/** Alarms not announced before, and the keys to remember (only current ones, so storage stays small). */
export function freshAlarms(current: Alarm[], seen: readonly string[]): { fresh: Alarm[]; remember: string[] } {
  const known = new Set(seen)
  return { fresh: current.filter((a) => !known.has(a.key)), remember: current.map((a) => a.key) }
}

export function alarmNotice(fresh: Alarm[]): { title: string; body: string } | null {
  if (!fresh.length) return null
  if (fresh.length === 1) return { title: 'Agent needs a look', body: fresh[0].text }
  const shown = fresh.slice(0, 4).map((a) => a.text)
  if (fresh.length > 4) shown.push(`and ${fresh.length - 4} more`)
  return { title: `${fresh.length} agents need a look`, body: shown.join('\n') }
}

// ---- helpers ----
function groupBy<T>(rows: T[], key: (row: T) => string): Group<T>[] {
  const map = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    map.set(k, [...(map.get(k) ?? []), r])
  }
  return [...map].map(([product, items]) => ({ product, items })).sort((a, b) => a.product.localeCompare(b.product))
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: string | null = null
  for (const [v, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = v
  return best
}
