// The Dashboard as a wall of keys: pure functions from a Snapshot to rows of keys. No I/O, no clock
// beyond the `now` passed in, no DOM: src/dashboard.ts draws what these return.
import type { AgentState, Checks, PrRow, ShipRow } from './model'
import type { OverviewBot } from './overview'
import type { Snapshot } from './protocol'
import { siteGroup, type SiteRow } from './sites'

/** neutral: nothing to say · accent: working · warning: needs you · danger: failing or down · success: all good. */
export type KeyTone = 'neutral' | 'accent' | 'warning' | 'danger' | 'success'
export type KpiId = 'needs' | 'working' | 'waiting' | 'errored' | 'prsFailing' | 'sitesDown'
/** Names from Orca's icon set; src/dashboard.ts draws each one. */
export type KeyIcon = 'flag' | 'agent' | 'pause' | 'error' | 'branch' | 'globe' | 'folder' | 'bot' | 'rocket' | 'check' | 'layers'
export type KeyAction = { nav: { worktreeId: string; address: string | null } } | { url: string } | null
export type Key = {
  id: string
  icon: KeyIcon
  /** Short, two lines at most on the key. */
  label: string
  /** The big number or word on the key, when it has one. */
  value?: string
  /** A small line under the label, and the key's tooltip with the label. */
  sub?: string
  tone: KeyTone
  /** The KPI keys that outline this one when pressed. */
  kpis: KpiId[]
  /** What pressing it does; null keys only show (summaries). */
  action: KeyAction
  /** A product key: the first, larger key of its row. */
  head?: boolean
}
export type DeckRow = { id: string; title: string; keys: Key[] }
export type Deck = { kpis: Key[]; rows: DeckRow[]; bots: Key[] }

/** Lower is worse: rows and their heads sort by it. */
export const TONE_RANK: Record<KeyTone, number> = { danger: 0, warning: 1, accent: 2, neutral: 3, success: 4 }
export const worstTone = (tones: KeyTone[]): KeyTone =>
  tones.length ? tones.reduce((a, b) => (TONE_RANK[b] < TONE_RANK[a] ? b : a)) : 'neutral'
/** Amber and red keys pulse (CSS turns it off under reduced motion). */
export const pulses = (k: Pick<Key, 'tone'>) => k.tone === 'warning' || k.tone === 'danger'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const nav = (worktreeId: string | null, address: string | null): KeyAction => (worktreeId ? { nav: { worktreeId, address } } : null)
const url = (u: string | null | undefined): KeyAction => (u && /^https?:\/\//i.test(u) ? { url: u } : null)

// ---- KPIs ----
export type Kpis = Record<KpiId, number>

export const prFailing = (p: Pick<PrRow, 'checks'>) => p.checks === 'fail'

export function kpiCounts(s: Snapshot): Kpis {
  const agents = s.office.flatMap((g) => g.items)
  const count = (state: AgentState) => agents.filter((a) => a.state === state).length
  return {
    needs: s.needsYou.length,
    working: count('working'),
    waiting: count('waiting'),
    errored: count('errored'),
    prsFailing: s.ship.flatMap((r) => r.prs).filter(prFailing).length,
    sitesDown: s.sites.filter((x) => x.state === 'down').length
  }
}

const KPI_KEYS: { id: KpiId; label: string; icon: KeyIcon; tone: KeyTone }[] = [
  { id: 'needs', label: 'Needs you', icon: 'flag', tone: 'warning' },
  { id: 'working', label: 'Working', icon: 'agent', tone: 'accent' },
  { id: 'waiting', label: 'Waiting', icon: 'pause', tone: 'warning' },
  { id: 'errored', label: 'Errored', icon: 'error', tone: 'danger' },
  { id: 'prsFailing', label: 'PRs failing', icon: 'branch', tone: 'danger' },
  { id: 'sitesDown', label: 'Sites down', icon: 'globe', tone: 'danger' }
]

/** The top row. A zero stays calm (neutral); a count takes its KPI's colour. */
export function kpiKeys(k: Kpis): Key[] {
  return KPI_KEYS.map((d) => ({
    id: `kpi:${d.id}`,
    icon: d.icon,
    label: d.label,
    value: String(k[d.id]),
    tone: k[d.id] > 0 ? d.tone : 'neutral',
    kpis: [d.id],
    action: null
  }))
}

// ---- One row per product ----
const AGENT: Record<AgentState, { tone: KeyTone; icon: KeyIcon; word: string; kpis: KpiId[] }> = {
  waiting: { tone: 'warning', icon: 'pause', word: 'waiting on you', kpis: ['waiting', 'needs'] },
  errored: { tone: 'danger', icon: 'error', word: 'errored', kpis: ['errored'] },
  working: { tone: 'accent', icon: 'agent', word: 'working', kpis: ['working'] },
  idle: { tone: 'neutral', icon: 'agent', word: 'idle', kpis: [] }
}
const PR: Record<Checks, { tone: KeyTone; word: string }> = {
  fail: { tone: 'danger', word: 'checks fail' },
  pending: { tone: 'accent', word: 'checks running' },
  pass: { tone: 'success', word: 'checks pass' },
  none: { tone: 'neutral', word: 'no checks' }
}
const SITE: Record<SiteRow['state'], KeyTone> = { down: 'danger', degraded: 'warning', up: 'success' }
const RUN: Record<'pass' | 'fail' | 'running', KeyTone> = { pass: 'success', fail: 'danger', running: 'accent' }

/** Sites not filed under a product share this row. */
export const SITES_ROW = 'Sites'

/** A product's keys, worst first, with the quiet ones (idle agents, green PRs, sites up) folded into one summary key each. */
export function productKeys(product: string, s: Snapshot, sites: SiteRow[]): Key[] {
  const keys: Key[] = []
  const id = (k: string) => `${product}:${k}`

  // Bot items and gates waiting on you; agents waiting on you come with the agents below.
  for (const n of s.needsYou.filter((x) => x.product === product && x.kind !== 'agent')) {
    keys.push({ id: id(n.key), icon: 'flag', label: n.title, sub: n.from ? `${n.from} asks` : 'Decision gate', tone: 'warning', kpis: ['needs'], action: nav(n.worktreeId, n.address) })
  }
  const agents = s.office.find((g) => g.product === product)?.items ?? []
  for (const a of agents.filter((x) => x.state !== 'idle')) {
    const d = AGENT[a.state]
    keys.push({ id: id(`agent:${a.key}`), icon: d.icon, label: a.title, sub: d.word, tone: d.tone, kpis: d.kpis, action: nav(a.worktreeId, a.address) })
  }
  const idle = agents.filter((x) => x.state === 'idle').length
  if (idle) keys.push({ id: id('idle'), icon: 'agent', label: plural(idle, 'agent'), value: String(idle), sub: 'idle', tone: 'neutral', kpis: [], action: null })

  const ship = s.ship.filter((r) => r.product === product)
  const prs = ship.flatMap((r) => r.prs)
  for (const p of prs.filter((x) => x.checks === 'fail' || x.checks === 'pending' || x.review === 'changes')) {
    const changes = p.review === 'changes' && p.checks !== 'fail'
    keys.push({
      id: id(`pr:${p.url}`),
      icon: 'branch',
      label: p.title,
      value: `#${p.number}`,
      sub: changes ? 'changes asked' : PR[p.checks].word,
      tone: changes ? 'warning' : PR[p.checks].tone,
      kpis: prFailing(p) ? ['prsFailing'] : [],
      action: url(p.url)
    })
  }
  const quiet = prs.filter((x) => !(x.checks === 'fail' || x.checks === 'pending' || x.review === 'changes'))
  if (quiet.length) {
    const green = quiet.every((x) => x.checks === 'pass')
    keys.push({ id: id('prs'), icon: 'branch', label: plural(quiet.length, 'PR'), value: String(quiet.length), sub: green ? 'green' : 'nothing failing', tone: green ? 'success' : 'neutral', kpis: [], action: null })
  }
  for (const r of ship) keys.push(...runKey(product, r))

  for (const x of sites.filter((y) => y.state !== 'up')) {
    keys.push({ id: id(`site:${x.name}`), icon: 'globe', label: x.name, sub: x.state === 'down' ? 'down' : 'degraded', tone: SITE[x.state], kpis: x.state === 'down' ? ['sitesDown'] : [], action: url(x.url) })
  }
  const up = sites.filter((y) => y.state === 'up')
  if (up.length === 1) keys.push({ id: id(`site:${up[0].name}`), icon: 'globe', label: up[0].name, sub: 'up', tone: 'success', kpis: [], action: url(up[0].url) })
  else if (up.length) keys.push({ id: id('sites'), icon: 'globe', label: plural(up.length, 'site'), value: String(up.length), sub: 'up', tone: 'success', kpis: [], action: null })

  const open = s.open.find((g) => g.product === product)?.items.length ?? 0
  if (open) keys.push({ id: id('open'), icon: 'layers', label: 'Open items', value: String(open), tone: 'neutral', kpis: [], action: null })

  return keys.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone])
}

function runKey(product: string, r: ShipRow): Key[] {
  const id = `${product}:run:${r.repo}`
  if (r.error) return [{ id, icon: 'rocket', label: r.repo, sub: 'GitHub unreadable', tone: 'danger', kpis: [], action: null }]
  if (!r.latestRun) return []
  const run = r.latestRun
  const word = { pass: 'CI passed', fail: 'CI failed', running: 'CI running' }[run.result]
  return [{ id, icon: 'rocket', label: run.name, sub: word, tone: RUN[run.result], kpis: [], action: url(run.url) }]
}

/** What a product key says under its name: the worst thing, in words. */
export function headLine(keys: Key[]): string {
  const n = (t: KeyTone) => keys.filter((k) => k.tone === t && !k.head).length
  if (n('danger')) return `${n('danger')} failing`
  if (n('warning')) return `${n('warning')} need${n('warning') === 1 ? 's' : ''} you`
  if (n('accent')) return `${n('accent')} working`
  return keys.length ? 'All quiet' : 'Nothing to show'
}

/** Every product with something to show, worst first; ties by name. Sites with no product get a row of their own. */
export function productRows(s: Snapshot): DeckRow[] {
  const sitesOf = new Map<string, SiteRow[]>()
  for (const x of s.sites) {
    const g = siteGroup(x, s.projects) ?? SITES_ROW
    sitesOf.set(g, [...(sitesOf.get(g) ?? []), x])
  }
  const names = new Set([
    ...s.office.map((g) => g.product),
    ...s.ship.map((r) => r.product),
    ...s.open.map((g) => g.product),
    ...s.needsYou.map((n) => n.product),
    ...sitesOf.keys()
  ])
  const rows = [...names].map((product) => {
    const keys = productKeys(product, s, sitesOf.get(product) ?? [])
    const tone = worstTone(keys.map((k) => k.tone))
    const head: Key = {
      id: `${product}:head`,
      icon: product === SITES_ROW ? 'globe' : 'folder',
      label: product,
      sub: headLine(keys),
      // A product whose keys are all neutral or green reads as green: nothing wrong.
      tone: keys.length && TONE_RANK[tone] >= TONE_RANK.neutral ? 'success' : tone,
      kpis: [],
      action: null,
      head: true
    }
    return { id: product, title: product, keys: [head, ...keys] }
  })
  rows.sort((a, b) => TONE_RANK[a.keys[0].tone] - TONE_RANK[b.keys[0].tone] || a.title.localeCompare(b.title))
  // Products with nothing to show share one last row of bare product keys, so they take no space of their own.
  const bare = rows.filter((r) => r.keys.length === 1)
  const full = rows.filter((r) => r.keys.length > 1)
  return bare.length ? [...full, { id: QUIET_ROW, title: QUIET_ROW, keys: bare.map((r) => r.keys[0]) }] : full
}

/** The last row: products with nothing running, open or failing. */
export const QUIET_ROW = 'Nothing to show'

// ---- Bots ----
export function botKeys(bots: OverviewBot[]): Key[] {
  return bots.map((b) => {
    const waiting = b.workers.filter((w) => w.state === 'waiting').length
    const errored = b.workers.some((w) => w.state === 'errored')
    const working = b.workers.some((w) => w.state === 'working')
    const tone: KeyTone = errored ? 'danger' : waiting || b.needsYou ? 'warning' : working ? 'accent' : 'neutral'
    const asks = waiting + b.needsYou
    return {
      id: `bot:${b.name}`,
      icon: 'bot' as const,
      label: b.name,
      value: String(b.workers.length),
      sub: asks ? `${asks} waiting` : plural(b.workers.length, 'worker'),
      tone,
      kpis: [...(b.needsYou ? ['needs' as const] : []), ...(waiting ? ['waiting' as const] : [])],
      action: nav(b.worktreeId, b.address)
    }
  })
}

export function buildDeck(s: Snapshot): Deck {
  return { kpis: kpiKeys(kpiCounts(s)), rows: productRows(s), bots: botKeys(s.overview) }
}

/** Ids of the keys a pressed KPI outlines: every key that counts toward it, the KPI key included. */
export function highlighted(deck: Deck, kpi: KpiId | null): Set<string> {
  if (!kpi) return new Set()
  const all = [...deck.kpis, ...deck.rows.flatMap((r) => r.keys), ...deck.bots]
  return new Set(all.filter((k) => k.kpis.includes(kpi)).map((k) => k.id))
}

// ---- Keyboard ----
export type Dir = 'left' | 'right' | 'up' | 'down'
export type Box = { x: number; y: number; w: number; h: number }

/**
 * The key focus moves to from `from`, given every key's box in reading order. Left and right step
 * through reading order (wrapping onto the next line), up and down take the nearest key on the
 * closest line above or below. At an edge focus stays where it is.
 */
export function moveFocus(boxes: Box[], from: number, dir: Dir): number {
  if (!boxes.length) return -1
  const at = Math.min(Math.max(from, 0), boxes.length - 1)
  if (dir === 'left') return Math.max(at - 1, 0)
  if (dir === 'right') return Math.min(at + 1, boxes.length - 1)
  const me = boxes[at]
  const cx = (b: Box) => b.x + b.w / 2
  const cy = (b: Box) => b.y + b.h / 2
  const sign = dir === 'down' ? 1 : -1
  let best = at
  let bestScore = Infinity
  boxes.forEach((b, i) => {
    const dy = (cy(b) - cy(me)) * sign
    if (dy <= me.h / 2) return
    // The closest line first, then the closest column on it.
    const score = dy * 10_000 + Math.abs(cx(b) - cx(me))
    if (score < bestScore) {
      bestScore = score
      best = i
    }
  })
  return best
}
