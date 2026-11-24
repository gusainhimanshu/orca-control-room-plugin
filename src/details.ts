// The Details view of the Control Room panel (0.9.0): the tabs Overview, Queue, Office, Flows and Ship,
// drawn as HTML from the rows in src/rows.ts. Strings only, no DOM, so tests run in plain Node.
// Every product group starts collapsed, still listing its running rows and "+N more"; a collapsed group
// with something waiting on you is marked 🟠, with something failing or down 🔴.
import { running, type AgentRow, type AgentState, type ShipRow } from './model'
import { layoutOverview } from './overview'
import { siteGroup, type SiteRow } from './sites'
import { act, agentHtml, esc, flowHtml, needHtml, pill, prHtml, row, runHtml, siteHtml, taskHtml, ul, workerHtml, goTo, openUrl, type Env } from './rows'

export const TABS = ['overview', 'queue', 'office', 'flows', 'ship'] as const
export type TabId = (typeof TABS)[number]
export const asTab = (v: unknown): TabId => (TABS.includes(v as TabId) ? (v as TabId) : 'overview')

/** What the Details view remembers: its tab, and the groups the user opened (false) or closed (true) as 'tab:product'. */
export type DetailsState = { tab: TabId; collapsed: Record<string, boolean> }
export const asCollapsed = (v: unknown): Record<string, boolean> =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'boolean')) : {}

type Alert = { tone: 'warning' | 'danger'; text: string } | null
/** The worse of some alerts. */
const worst = (...a: Alert[]): Alert => a.find((x) => x?.tone === 'danger') ?? a.find((x) => x) ?? null
const MARK = { warning: '🟠', danger: '🔴' } as const

type Group = { tab: TabId; name: string; note: string; alert?: Alert; preview?: string; hidden?: number; body: string }

/** A product group, collapsed until the user opens it. `changed` persists and redraws after a toggle. */
function group(env: Env, st: DetailsState, changed: () => void, g: Group): string {
  const key = `${g.tab}:${g.name}`
  const open = st.collapsed[key] === false
  const marked = !open && g.alert ? g.alert : null
  const desc = [g.note, marked ? `${MARK[marked.tone]} ${marked.text}` : '', !open && g.hidden ? `+${g.hidden} more` : ''].filter(Boolean).join(' · ')
  const toggle = act(env, () => {
    const { [key]: _old, ...rest } = st.collapsed
    st.collapsed = open ? rest : { ...rest, [key]: false }
    changed()
  })
  return `<section class="grp"${marked ? ` data-tone="${marked.tone}"` : ''} data-group="${esc(key)}">
    <button class="grp-h" ${toggle} aria-expanded="${open}"><span class="chev" aria-hidden="true">${open ? '▾' : '▸'}</span><span class="t">${esc(g.name)}</span><span class="d">${esc(desc)}</span></button>
    ${open ? `<div class="grp-b">${g.body}</div>` : g.preview ? `<div class="grp-b">${g.preview}</div>` : ''}</section>`
}

/** A collapsed group's preview: only the running rows, and how many it leaves out. */
function runningOnly<T>(rows: T[], keep: (r: T) => boolean, draw: (rows: T[]) => string) {
  const shown = rows.filter(keep)
  return { preview: shown.length ? draw(shown) : '', hidden: rows.length - shown.length }
}

const warn = (text?: string) => (text ? `<p class="warn-box">${esc(text)}</p>` : '')
const empty = (text: string) => `<p class="said">${esc(text)}</p>`

function overview(env: Env, st: DetailsState, changed: () => void): string {
  const s = env.snap
  if (!s.overview.length) return warn(s.errors.bots) + empty('No bots yet. Bots, the workers they start and their pull requests show here.')
  const { nodes, edges } = layoutOverview(s.overview, s.ship)
  const into = new Map(edges.map((e) => [e.to, e]))
  const diagram = nodes
    .map((n) => {
      const nav = n.nav
      const fn = !nav ? null : 'url' in nav ? openUrl(env, nav.url) : goTo(env, nav.worktreeId, nav.address)
      const edge = into.get(n.id)
      const hook = edge ? `<span class="hook${edge.waiting ? ' w' : ''}">└</span>` : ''
      const label = fn ? `<button class="node" data-tone="${n.tone}" ${act(env, fn)}>${esc(n.label)}</button>` : `<span class="node" data-tone="${n.tone}">${esc(n.label)}</span>`
      return `<div class="dn" style="padding-left:${Math.max(0, n.tier - 1) * 16}px">${hook}${label}${n.sub ? `<span class="sub${n.waiting ? ' w' : ''}">${esc(n.sub)}</span>` : ''}</div>`
    })
    .join('')
  const bots = s.overview.map((b) => {
    const busy = b.workers.filter(running.worker)
    const doing = running.doing(b)
    const preview = (doing ? `<p class="said">Doing now: ${esc(b.doing)}</p>` : '') + ul(busy.map((w) => workerHtml(env, w)))
    const body =
      `<p class="said">Doing now: ${esc(b.doing)}</p><div class="m">${pill([b.needsYou ? `${b.open} open · ${b.needsYou} need you` : `${b.open} open`, b.needsYou ? 'warning' : 'neutral'])}${pill([`${b.workers.length} worker${b.workers.length === 1 ? '' : 's'}`, 'neutral'])}</div>` +
      (b.lastSaid ? `<p class="said">Last said: ${esc(b.lastSaid)}</p>` : '') +
      ul(b.workers.map((w) => workerHtml(env, w)))
    return group(env, st, changed, { tab: 'overview', name: b.name, note: `${b.open} open`, alert: b.needsYou ? { tone: 'warning', text: `${b.needsYou} need you` } : null, preview, hidden: b.workers.length - busy.length, body })
  })
  return warn(s.errors.bots) + `<div class="diagram" role="group" aria-label="Who hands work to whom">${diagram}</div>` + bots.join('')
}

function queue(env: Env, st: DetailsState, changed: () => void): string {
  const s = env.snap
  const needs = s.needsYou.length ? ul(s.needsYou.map((n) => needHtml(env, n))) : empty('Nothing is waiting on you.')
  const open = s.open.length
    ? s.open
        .map((g) => group(env, st, changed, { tab: 'queue', name: g.product, note: `${g.items.length} open`, ...runningOnly(g.items, running.task, (r) => ul(r.map((t) => taskHtml(env, t)))), body: ul(g.items.map((t) => taskHtml(env, t))) }))
        .join('')
    : empty('No open items.')
  return warn(s.errors.bots) + warn(s.errors.runs) + `<h3>Needs you · ${s.needsYou.length}</h3>${needs}<h3>Open work</h3>${open}`
}

const STATE_WORD: Record<AgentState, string> = { working: 'working', waiting: 'waiting on you', errored: 'errored', idle: 'idle' }
function office(env: Env, st: DetailsState, changed: () => void): string {
  const s = env.snap
  if (!s.office.length) return empty('No agents running.')
  return s.office
    .map((g) => {
      const n = (x: AgentState) => g.items.filter((a) => a.state === x).length
      const note = (['working', 'waiting', 'errored', 'idle'] as const).filter((x) => n(x)).map((x) => `${n(x)} ${STATE_WORD[x]}`).join(' · ')
      const alert = worst(n('errored') ? { tone: 'danger', text: `${n('errored')} errored` } : null, n('waiting') ? { tone: 'warning', text: `${n('waiting')} waiting on you` } : null)
      const draw = (rows: AgentRow[]) => ul(rows.map((a) => agentHtml(env, a)))
      return group(env, st, changed, { tab: 'office', name: g.product, note, alert, ...runningOnly(g.items, running.agent, draw), body: draw(g.items) })
    })
    .join('')
}

function flows(env: Env, st: DetailsState, changed: () => void): string {
  const s = env.snap
  if (!s.flows.length) return warn(s.errors.flows) + empty('No messages between agents yet.')
  return (
    warn(s.errors.flows) +
    s.flows
      .map((g) => {
        const waiting = g.items.filter((f) => f.waiting).length
        const draw = (rows: typeof g.items) => ul(rows.map((f) => flowHtml(env, f)))
        return group(env, st, changed, {
          tab: 'flows',
          name: g.product,
          note: `${g.items.length} messages`,
          alert: waiting ? { tone: 'warning', text: `${waiting} waiting on you` } : null,
          ...runningOnly(g.items, (f) => running.flow(f, s.orcaAt), draw),
          body: draw(g.items)
        })
      })
      .join('')
  )
}

const runText = (run: ShipRow['latestRun']) => (!run ? 'No runs' : `${run.name} ${run.result === 'pass' ? 'passed' : run.result === 'fail' ? 'failed' : 'running'}`)
const siteAlert = (rows: SiteRow[]): Alert => {
  const n = (x: string) => rows.filter((r) => r.state === x).length
  return worst(n('down') ? { tone: 'danger', text: `${n('down')} down` } : null, n('degraded') ? { tone: 'warning', text: `${n('degraded')} degraded` } : null)
}
const upNote = (rows: SiteRow[]) => `${rows.filter((r) => r.state === 'up').length} of ${rows.length} up`

function ship(env: Env, st: DetailsState, changed: () => void): string {
  const s = env.snap
  const rows = s.ghAt ? s.ship : []
  const shown = new Set(rows.map((r) => r.product))
  const g = (x: Omit<Group, 'tab'>) => group(env, st, changed, { tab: 'ship', ...x })
  const sitesHtml = (list: SiteRow[]) => ul(list.map((x) => siteHtml(env, x)))
  // Sites with no product (or one without a Ship card) first; bad entries of the setting show inside.
  const groups = new Map<string, SiteRow[]>()
  for (const r of s.sites) {
    const p = siteGroup(r, s.projects)
    if (p && shown.has(p)) continue
    groups.set(p ?? '', [...(groups.get(p ?? '') ?? []), r])
  }
  const plain = groups.get('') ?? []
  groups.delete('')
  const errs = s.siteErrors.map((e) => warn(`Sites to ping: ${e}`)).join('')
  let out = ''
  if (plain.length || s.siteErrors.length) {
    const down = plain.filter(running.site)
    out += g({ name: 'Sites', note: upNote(plain), alert: siteAlert(plain), preview: errs + sitesHtml(down), hidden: plain.length - down.length, body: errs + sitesHtml(plain) })
  }
  for (const [product, list] of groups) {
    const down = list.filter(running.site)
    out += g({ name: product, note: upNote(list), alert: siteAlert(list), preview: sitesHtml(down), hidden: list.length - down.length, body: sitesHtml(list) })
  }
  if (!s.ghAt) return out + empty('Reading GitHub…')
  out += warn(s.errors.gh)
  if (!rows.length) return out + empty('No GitHub repos to watch. Add owner/name repos in Settings, or a GitHub project to Orca.')
  for (const r of rows) {
    const sites = s.sites.filter((x) => siteGroup(x, s.projects) === r.product)
    const run = r.latestRun
    const failing = r.prs.filter((p) => p.checks === 'fail').length
    const alert = worst(run?.result === 'fail' ? { tone: 'danger', text: runText(run) } : null, failing ? { tone: 'danger', text: `${failing} PR${failing === 1 ? '' : 's'} failing` } : null, siteAlert(sites))
    // Collapsed: only a running or failed run, PRs whose checks run or fail or that have changes asked, and sites not up.
    const prs = r.error ? [] : r.prs.filter(running.pr)
    const down = sites.filter(running.site)
    const showRun = running.run(run)
    const shownN = prs.length + down.length + (showRun ? 1 : 0)
    const total = (r.error ? 0 : r.prs.length) + sites.length + (run ? 1 : 0)
    const prBody = r.error ? row(env, null, r.repo, pill([r.error, 'warning'])) : r.prs.length ? r.prs.map((p) => prHtml(env, p)).join('') : row(env, null, `${r.repo} · no open pull requests`, '')
    out += g({
      name: r.product,
      note: `${runText(run)} · ${r.error ? 'unreadable' : `${r.prs.length} open`}`,
      alert,
      preview: shownN ? ul([...(showRun ? [runHtml(env, r)] : []), ...prs.map((p) => prHtml(env, p)), ...down.map((x) => siteHtml(env, x))]) : '',
      hidden: total - shownN,
      body: ul([...(run ? [runHtml(env, r)] : []), prBody, ...sites.map((x) => siteHtml(env, x))])
    })
  }
  return out
}

const LABEL: Record<TabId, string> = { overview: 'Overview', queue: 'Queue', office: 'Office', flows: 'Flows', ship: 'Ship' }
const DRAW: Record<TabId, (env: Env, st: DetailsState, changed: () => void) => string> = { overview, queue, office, flows, ship }

/** The tab bar and the chosen tab's body. Picking a tab or toggling a group calls `changed`. */
export function detailsHtml(env: Env, st: DetailsState, changed: () => void): string {
  const tabs = TABS.map((t) => {
    const label = t === 'queue' ? `Queue · ${env.snap.needsYou.length}` : LABEL[t]
    const on = st.tab === t
    return `<button role="tab" class="tab" id="tab-${t}" data-tab="${t}" aria-selected="${on}" tabindex="${on ? 0 : -1}" ${act(env, () => ((st.tab = t), changed()))}>${esc(label)}</button>`
  }).join('')
  const foot = `<p class="said foot">${env.snap.allowAnswer ? 'Answers decision gates after a confirm' : 'Read-only'}</p>`
  return `<div class="tabs" role="tablist" aria-label="Details">${tabs}</div><div class="tabpanel" role="tabpanel" aria-labelledby="tab-${st.tab}">${DRAW[st.tab](env, st, changed)}</div>${foot}`
}
