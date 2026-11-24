// The HTML rows both sidebar views draw: the drawer behind a key (src/dashboard.ts) and the Details
// tabs (src/details.ts). Strings only, no DOM: a button carries `data-act="<n>"` and `env.acts[n]` is
// what it does, so tests run them in plain Node. Rows only navigate or open a link (Orca asks first);
// the one write, answering a decision gate, happens only after an inline Confirm.
import type { Detail } from './deck'
import { MAX_RESOLUTION, type NeedRow } from './model'
import type { Snapshot } from './protocol'

/** Answering a gate: typed drafts, the answer awaiting confirmation, how sending went. */
export type GateState = { drafts: Map<string, string>; pending: { key: string; text: string } | null; sending: boolean; outcome: Map<string, { ok: boolean; text: string }> }
export const gateState = (): GateState => ({ drafts: new Map(), pending: null, sending: false, outcome: new Map() })

export type Env = {
  snap: Snapshot
  /** What each `data-act` button does; cleared before each draw. */
  acts: (() => void)[]
  gate: GateState
  navigate: (worktreeId: string, address: string | null) => void
  openUrl: (url: string) => void
  resolveGate: (gateId: string, resolution: string) => Promise<{ ok: boolean; error?: string }>
  /** Draws again after a gate step. */
  redraw: () => void
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
export const ago = (at: number) => {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`
}

export type Word = readonly [string, string]
export const AGENT_WORD: Record<string, Word> = { working: ['Working', 'accent'], waiting: ['Waiting on you', 'warning'], errored: ['Errored', 'danger'], idle: ['Idle', 'neutral'], done: ['Done', 'success'] }
export const CHECK_WORD: Record<string, Word> = { pass: ['Checks pass', 'success'], fail: ['Checks fail', 'danger'], pending: ['Checks running', 'warning'], none: ['No checks', 'neutral'] }
export const REVIEW_WORD: Record<string, Word> = { approved: ['Approved', 'success'], changes: ['Changes asked', 'danger'], required: ['Review needed', 'warning'], none: ['No review', 'neutral'] }
export const SITE_WORD: Record<string, Word> = { up: ['Up', 'success'], degraded: ['Degraded', 'warning'], down: ['Down', 'danger'] }
export const RUN_WORD: Record<string, Word> = { pass: ['CI passed', 'success'], fail: ['CI failed', 'danger'], running: ['CI running', 'warning'] }
export const pill = ([word, tone]: Word) => `<span class="pill" data-tone="${tone}">${esc(word)}</span>`

/** Registers what a button does and returns its attribute. */
export const act = (env: Env, fn: () => void) => `data-act="${env.acts.push(fn) - 1}"`
export const goTo = (env: Env, worktreeId: string | null, address: string | null) => () => {
  if (worktreeId) env.navigate(worktreeId, address)
}
export const openUrl = (env: Env, u: string) => () => {
  if (/^https?:\/\//i.test(u)) env.openUrl(u)
}
/** A row: a button when it goes somewhere, else plain. */
export const row = (env: Env, fn: (() => void) | null, title: string, meta: string, extra = '') =>
  fn
    ? `<li><button class="row" ${act(env, fn)}><span class="t">${esc(title)}</span><span class="m">${meta}</span></button>${extra}</li>`
    : `<li><div class="row"><span class="t">${esc(title)}</span><span class="m">${meta}</span>${extra}</div></li>`
export const list = (title: string, items: string[]) => (items.length ? `<h3>${esc(title)}</h3><ul>${items.join('')}</ul>` : '')
export const ul = (items: string[]) => (items.length ? `<ul>${items.join('')}</ul>` : '')

const plainLabel = (o: string) => o.replace(/ \(recommended\)$/, '')
/** Orca can show the bot's workspace but not switch to one of its chats, so the tooltip names the chat to pick. */
const openChatTip = (n: NeedRow) =>
  `Opens ${n.from ?? 'the bot'}'s chats. Orca can't open one chat or answer for you from here: switch to ${n.chat ? `the '${n.chat}' chat` : 'the chat that owns this item'} and answer there.`

/** Step 1: pick an option or type an answer; nothing is sent here. */
export function askGate(env: Env, key: string, text: string): void {
  if (!text.trim()) return
  env.gate.pending = { key, text: text.trim() }
  env.gate.outcome.delete(key)
  env.redraw()
}

/** Step 2: the owner confirmed; send it once. */
export async function confirmGate(env: Env, n: NeedRow): Promise<void> {
  const g = env.gate
  if (g.sending || !g.pending) return
  const text = g.pending.text
  g.sending = true
  env.redraw()
  const r = await env.resolveGate(n.key.slice('gate:'.length), text).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
  g.pending = null
  g.sending = false
  g.outcome.set(n.key, { ok: r.ok, text: r.ok ? `Sent '${text}'.` : `Not sent: ${r.error ?? 'unknown error'}` })
  env.redraw()
}

export function needHtml(env: Env, n: NeedRow): string {
  const g = env.gate
  const answerable = n.kind === 'gate' && env.snap.allowAnswer
  const openChat = n.kind === 'item' && !!n.worktreeId
  const asked = [n.question, ...n.decisions.filter((d) => d.prompt && d.prompt !== n.question).map((d) => d.prompt)].filter(Boolean)
  const options = n.decisions.flatMap((d) => d.options)
  let body = asked.map((q) => `<p class="q">${esc(q)}</p>`).join('')
  if (!answerable && options.length) body += `<div class="m">${options.map((o) => pill([o, 'neutral'])).join('')}</div>`
  if (answerable) {
    const done = g.outcome.get(n.key)
    body +=
      g.pending?.key === n.key
        ? `<div class="ask"><p class="q">Send '${esc(g.pending.text)}' to the coordinator?</p><div class="acts">
            <button class="btn go" ${g.sending ? 'disabled' : ''} ${act(env, () => void confirmGate(env, n))}>Confirm</button>
            <button class="btn" ${act(env, () => ((g.pending = null), env.redraw()))}>Cancel</button></div></div>`
        : `<div class="acts">${options.map((o) => `<button class="btn" ${act(env, () => askGate(env, n.key, plainLabel(o)))}>${esc(o)}</button>`).join('')}</div>
           <div class="acts"><input data-draft="${esc(n.key)}" aria-label="Answer: ${esc(n.title)}" placeholder="Or write a short answer" maxlength="${MAX_RESOLUTION}" value="${esc(g.drafts.get(n.key) ?? '')}">
            <button class="btn" ${act(env, () => askGate(env, n.key, g.drafts.get(n.key) ?? ''))}>Send</button></div>`
    if (done) body += `<p class="q" style="color:var(${done.ok ? '--ok' : '--bad'})">${esc(done.text)}</p>`
  }
  if (openChat) body += `<div class="acts"><button class="btn" title="${esc(openChatTip(n))}" ${act(env, goTo(env, n.worktreeId, n.address))}>Open chat to answer</button></div>`
  const meta = esc(n.from ? `${n.from} · ${n.product}` : n.product) + (n.since ? ` · ${ago(n.since)}` : '')
  // A row holding buttons cannot itself be one.
  return row(env, answerable || openChat || !n.worktreeId ? null : goTo(env, n.worktreeId, n.address), n.title, meta, body)
}

// One renderer per kind of row, shared by the drawer and the Details tabs.
export const agentHtml = (env: Env, a: Detail['agents'][number]) =>
  row(env, goTo(env, a.worktreeId, a.address), a.title, `${pill(AGENT_WORD[a.state])}${esc(a.workspace)}${a.since ? ` · ${ago(a.since)}` : ''}${a.detail ? ` · ${esc(a.detail)}` : ''}`)
export const prHtml = (env: Env, p: Detail['ship'][number]['prs'][number]) =>
  row(env, openUrl(env, p.url), `#${p.number} ${p.title}`, `${p.draft ? pill(['Draft', 'neutral']) : ''}${pill(CHECK_WORD[p.checks])}${pill(REVIEW_WORD[p.review])}`)
export const runHtml = (env: Env, r: Detail['ship'][number]) =>
  r.latestRun ? row(env, r.latestRun.url ? openUrl(env, r.latestRun.url) : null, r.latestRun.name, `${pill(RUN_WORD[r.latestRun.result])}${esc(r.repo)}`) : ''
export const siteHtml = (env: Env, x: Detail['sites'][number]) =>
  row(env, openUrl(env, x.url), x.name, `${pill(SITE_WORD[x.state])}${esc(x.error ?? (x.status ? `HTTP ${x.status}` : ''))} · ${x.ms} ms${x.since ? ` · since ${ago(x.since)}` : ''}`)
export const taskHtml = (env: Env, t: Detail['tasks'][number]) => row(env, null, t.title, esc(`${t.status} · ${t.via}`))
export const flowHtml = (env: Env, f: Detail['flows'][number]) =>
  row(env, f.worktreeId ? goTo(env, f.worktreeId, f.address) : null, f.subject || f.type, `${f.waiting ? pill(['Waiting on you', 'warning']) : ''}${pill([f.type, 'neutral'])}${esc(`${f.from} → ${f.to}`)}${f.line ? ` · ${esc(f.line)}` : ''}`)
export const workerHtml = (env: Env, w: Detail['bots'][number]['workers'][number]) => row(env, w.worktreeId ? goTo(env, w.worktreeId, w.address) : null, w.label, pill(AGENT_WORD[w.state]))

/** Orca can't switch to one bot chat from a plugin (bot chats have no terminal), so the home shows the chat open there last. */
export const homeTip = (bot: string) => `Shows ${bot}'s home workspace in Orca. Orca opens the chat that was open there last; pick Home in its chat list for the Home Chat.`
export const homeHtml = (env: Env, b: Detail['bots'][number]) =>
  b.home ? `<div class="acts"><button class="btn" title="${esc(homeTip(b.name))}" ${act(env, goTo(env, b.home, null))}>Open ${esc(b.name)}'s home</button></div>` : ''

/** The drawer's body: every kind of row behind one key. */
export function detailHtml(env: Env, d: Detail): string {
  const shipItems = d.ship.flatMap((r) => [...(r.latestRun ? [runHtml(env, r)] : []), ...(r.error ? [row(env, null, r.repo, pill([r.error, 'warning']))] : []), ...r.prs.map((p) => prHtml(env, p))])
  return [
    ...d.bots.map(
      (b) =>
        homeHtml(env, b) +
        `<p class="said">Doing now: ${esc(b.doing)}</p><div class="m">${pill([b.needsYou ? `${b.open} open · ${b.needsYou} need you` : `${b.open} open`, b.needsYou ? 'warning' : 'neutral'])}</div>` +
        (b.lastSaid ? `<p class="said">Last said: ${esc(b.lastSaid)}</p>` : '') +
        list('Workers', b.workers.map((w) => workerHtml(env, w)))
    ),
    list('Needs you', d.needs.map((n) => needHtml(env, n))),
    list('Agents', d.agents.map((a) => agentHtml(env, a))),
    list('Pull requests and CI', shipItems),
    list('Sites', d.sites.map((x) => siteHtml(env, x))),
    list('Open work', d.tasks.map((t) => taskHtml(env, t))),
    list('Recent messages', d.flows.map((f) => flowHtml(env, f)))
  ].join('')
}
