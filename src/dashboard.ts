// The Dashboard: a full-page wall of keys in an Orca editor tab. A key opens a drawer of the rows
// behind it on the same page; those rows act like the sidebar's: show a workspace or focus a terminal,
// open a pull request, run or site in the browser (Orca asks first), and answer a decision gate only
// after an inline confirm. The keys and rows come from src/deck.ts; this file only draws.
import { buildDeck, highlighted, isEmpty, keyById, moveFocus, pulses, rowsBehind, type Deck, type Detail, type Dir, type Key, type KeyIcon, type KpiId } from './deck'
import { MAX_RESOLUTION, type NeedRow } from './model'
import { asSnapshot, type Snapshot } from './protocol'

// Lucide outlines (ISC), the set Orca's own icon names come from.
const ICONS: Record<KeyIcon | 'gauge', string> = {
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  agent: '<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2"/>',
  pause: '<circle cx="12" cy="12" r="10"/><path d="M10 15V9"/><path d="M14 15V9"/>',
  error: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  branch: '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  rocket:
    '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  layers:
    '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>'
}
const icon = (name: KeyIcon | 'gauge') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`

const STYLE = `
:root {
  --ok: #15803d; --run: #1d4ed8; --ask: #b45309; --bad: #b91c1c;
  --key: clamp(96px, 7.4vw, 128px); --gap: 12px;
  /* A key's face: lit from above, so lighter at the top. */
  --face: var(--orca-card); --base: color-mix(in oklab, var(--orca-card) 94%, var(--orca-foreground));
  --edge: color-mix(in oklab, var(--orca-card) 70%, var(--orca-foreground));
  --shade: color-mix(in oklab, var(--orca-background) 55%, black);
}
html.dark { --ok: #4ade80; --run: #60a5fa; --ask: #fbbf24; --bad: #f87171;
  --face: color-mix(in oklab, var(--orca-card) 88%, white); --base: var(--orca-card); --edge: color-mix(in oklab, var(--orca-card) 80%, white); --shade: black; }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--orca-background); color: var(--orca-foreground); font-family: var(--orca-font-sans, system-ui), "Segoe UI", system-ui, sans-serif; }
body { padding: 0 clamp(16px, 3vw, 40px) 40px; overflow-x: hidden; }
::selection { background: color-mix(in oklab, var(--run) 30%, transparent); }
header { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 12px; padding: 14px 0 12px; margin-bottom: 8px;
  background: var(--orca-background); border-bottom: 1px solid var(--orca-border); }
header h1 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
header h1 svg { width: 18px; height: 18px; color: var(--orca-muted-foreground); }
header .meta { margin-left: auto; font-size: 12px; color: var(--orca-muted-foreground); font-variant-numeric: tabular-nums; text-align: right; }
header .warn { color: var(--ask); }
section { padding: 16px 0 4px; }
section + section { border-top: 1px solid color-mix(in oklab, var(--orca-border) 60%, transparent); }
h2 { margin: 0 0 10px; font-size: 13px; font-weight: 600; color: var(--orca-muted-foreground); }
.keys { display: flex; flex-wrap: wrap; gap: var(--gap); }
.hint { margin: 10px 0 0; font-size: 12px; color: var(--orca-muted-foreground); min-height: 1.2em; }

.key { --tone: var(--edge); position: relative; width: var(--key); height: var(--key); padding: 10px; border-radius: 14px;
  display: flex; flex-direction: column; justify-content: space-between; text-align: left; cursor: pointer;
  font: inherit; color: var(--orca-card-foreground);
  background: linear-gradient(to bottom, var(--face), var(--base) 70%);
  border: 1.5px solid color-mix(in oklab, var(--tone) 75%, var(--edge));
  box-shadow: inset 0 1px 0 color-mix(in oklab, white 14%, transparent), inset 0 -3px 0 color-mix(in oklab, var(--shade) 22%, transparent),
    0 3px 6px -2px color-mix(in oklab, var(--shade) 45%, transparent);
  transition: transform 120ms cubic-bezier(.2,.8,.2,1), box-shadow 120ms cubic-bezier(.2,.8,.2,1), opacity 160ms ease-out; }
.key.head { width: calc(var(--key) * 2 + var(--gap)); }
.key[data-tone="neutral"] { --tone: var(--edge); }
.key[data-tone="accent"] { --tone: var(--run); }
.key[data-tone="warning"] { --tone: var(--ask); }
.key[data-tone="danger"] { --tone: var(--bad); }
.key[data-tone="success"] { --tone: var(--ok); }
.key[data-tone="warning"], .key[data-tone="danger"] {
  background: linear-gradient(to bottom, color-mix(in oklab, var(--tone) 14%, var(--face)), color-mix(in oklab, var(--tone) 6%, var(--base)) 70%); }
/* Only a product key glows, so the worst product reads first and its keys stay calm. */
.key.head[data-tone="warning"], .key.head[data-tone="danger"] {
  box-shadow: inset 0 -3px 0 color-mix(in oklab, var(--shade) 22%, transparent), 0 3px 6px -2px color-mix(in oklab, var(--shade) 45%, transparent),
    0 0 18px -4px color-mix(in oklab, var(--tone) 60%, transparent); }
.key:hover { border-color: var(--tone); }
.key:active { transform: translateY(2px); box-shadow: inset 0 -1px 0 color-mix(in oklab, var(--shade) 22%, transparent), 0 1px 2px -1px color-mix(in oklab, var(--shade) 45%, transparent); }
.key:focus-visible { outline: 2px solid var(--orca-ring); outline-offset: 3px; }
.key .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; }
.key svg { width: 22px; height: 22px; flex: none; color: var(--tone); }
.key[data-tone="neutral"] svg { color: var(--orca-muted-foreground); }
.key .value { font-size: clamp(20px, 2vw, 28px); font-weight: 650; line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.key.kpi .value { font-size: clamp(28px, 3vw, 40px); }
.key .label, .key .sub { display: block; }
.key .label { font-size: 12.5px; font-weight: 550; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.key.head .label { font-size: 16px; font-weight: 650; letter-spacing: -0.01em; }
.key .sub { font-size: 11px; color: var(--orca-muted-foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.key[data-tone="warning"] .sub, .key[data-tone="danger"] .sub { color: color-mix(in oklab, var(--tone) 70%, var(--orca-card-foreground)); }
/* A pressed KPI dims everything it does not count. */
body.lit .key:not(.on) { opacity: 0.32; }
body.lit .key.on { outline: 2px solid var(--tone); outline-offset: 3px; }
body.lit .key.kpi.on { outline-color: var(--orca-ring); }
/* Only product keys pulse, so a wall with many amber keys stays calm. */
@keyframes pulse { 50% { box-shadow: inset 0 -3px 0 color-mix(in oklab, var(--shade) 22%, transparent), 0 3px 6px -2px color-mix(in oklab, var(--shade) 45%, transparent), 0 0 30px 0 color-mix(in oklab, var(--tone) 55%, transparent); } }
.key.pulse { animation: pulse 2.6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .key, .key.pulse { animation: none; transition: none; } .key:active { transform: none; } }
/* The detail drawer: beside the wall when wide, below it when narrow. */
.layout { display: grid; gap: 24px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 1100px) {
  .layout.with-drawer { grid-template-columns: minmax(0, 1fr) minmax(340px, 420px); }
  .drawer { position: sticky; top: 64px; align-self: start; max-height: calc(100vh - 80px); overflow-y: auto; }
}
.drawer { margin-top: 16px; padding: 16px; border: 1px solid var(--orca-border); border-radius: 14px; background: var(--orca-card); color: var(--orca-card-foreground); }
.drawer[hidden] { display: none; }
.drawer .bar { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 12px; }
.drawer h2 { margin: 0; font-size: 15px; color: var(--orca-card-foreground); }
.drawer .bar p { margin: 2px 0 0; font-size: 12px; color: var(--orca-muted-foreground); }
.drawer .close { margin-left: auto; }
.drawer h3 { margin: 16px 0 6px; font-size: 12px; font-weight: 600; color: var(--orca-muted-foreground); }
.drawer ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.row { display: block; width: 100%; padding: 8px 10px; border-radius: 10px; border: 1px solid color-mix(in oklab, var(--orca-border) 70%, transparent);
  background: none; color: inherit; font: inherit; text-align: left; }
button.row { cursor: pointer; }
button.row:hover { border-color: var(--orca-border); background: color-mix(in oklab, var(--orca-card) 90%, var(--orca-foreground)); }
.row:focus-visible, .drawer button:focus-visible, .drawer input:focus-visible { outline: 2px solid var(--orca-ring); outline-offset: 2px; }
.row .t { display: block; font-size: 13px; font-weight: 550; overflow-wrap: anywhere; }
.row .m { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 4px; font-size: 11.5px; color: var(--orca-muted-foreground); }
.row .q { margin: 4px 0 0; font-size: 12.5px; }
.pill { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 550; border: 1px solid currentColor; }
.pill[data-tone="neutral"] { color: var(--orca-muted-foreground); }
.pill[data-tone="accent"] { color: var(--run); } .pill[data-tone="success"] { color: var(--ok); }
.pill[data-tone="warning"] { color: var(--ask); } .pill[data-tone="danger"] { color: var(--bad); }
.btn { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 8px; border: 1px solid var(--orca-border); background: var(--orca-background); color: var(--orca-foreground); cursor: pointer; }
.btn.go { border-color: var(--run); color: var(--run); }
.btn:disabled { opacity: .5; cursor: default; }
.acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.acts input { flex: 1 1 160px; min-width: 0; font: inherit; font-size: 12px; padding: 4px 8px; border-radius: 8px; border: 1px solid var(--orca-border); background: var(--orca-background); color: var(--orca-foreground); }
.ask { margin-top: 8px; padding: 8px; border-radius: 8px; border: 1px solid var(--ask); }
.said { font-size: 12px; margin: 8px 0 0; }
.key.open { outline: 2px solid var(--orca-ring); outline-offset: 3px; }
.empty { padding: 48px 0; max-width: 46ch; color: var(--orca-muted-foreground); font-size: 14px; line-height: 1.5; }
.empty strong { display: block; color: var(--orca-foreground); font-size: 16px; margin-bottom: 4px; }
`

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
let snap: Snapshot | null = null
let deck: Deck = { kpis: [], rows: [], bots: [] }
let lit: KpiId | null = null
/** Why the first reading has not arrived (the worker refused, or drawing failed), shown instead of waiting forever. */
let loadError = ''
const keysById = new Map<string, Key>()
/** The key whose drawer is open. */
let open: string | null = null
/** What each drawer button does, by its data-act index; rebuilt with the drawer. */
let acts: (() => void)[] = []
// Answering a gate: typed drafts, the answer awaiting confirmation, how sending went.
const drafts = new Map<string, string>()
let pending: { key: string; text: string } | null = null
let sending = false
const outcome = new Map<string, { ok: boolean; text: string }>()

function keyHtml(k: Key, extra = ''): string {
  keysById.set(k.id, k)
  const pulse = pulses(k) && k.head ? ' pulse' : ''
  const tip = [k.label, k.value, k.sub].filter(Boolean).join(' · ')
  return `<button class="key ${extra}${k.head ? ' head' : ''}${pulse}${open === k.id ? ' open' : ''}" data-id="${esc(k.id)}" data-tone="${k.tone}" title="${esc(tip)}. Press for details" aria-label="${esc(tip)}" aria-controls="drawer" aria-expanded="${open === k.id}">
    <span class="top">${icon(k.icon)}${k.value ? `<span class="value">${esc(k.value)}</span>` : ''}</span>
    <span><span class="label">${esc(k.label)}</span>${k.sub ? `<span class="sub">${esc(k.sub)}</span>` : ''}</span></button>`
}

const ago = (at: number) => {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`
}

function meta(): string {
  if (!snap?.orcaAt) return ''
  const errs = Object.values(snap.errors).filter(Boolean)
  return `${errs.length ? `<span class="warn">${errs.length} source${errs.length > 1 ? 's' : ''} unreadable · </span>` : ''}updated ${ago(snap.orcaAt)}`
}

function render(): void {
  const app = document.getElementById('app')!
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.id
  keysById.clear()
  if (!snap?.orcaAt) {
    app.innerHTML = snap?.errors.orca
      ? `<div class="empty"><strong>Orca could not be read</strong>${esc(snap.errors.orca)}</div>`
      : loadError
        ? `<div class="empty"><strong>The Dashboard could not load</strong>${esc(loadError)}</div>`
        : `<div class="empty"><strong>Reading Orca…</strong>The wall fills in after the first reading, within a few seconds.</div>`
    return
  }
  deck = buildDeck(snap)
  const rows = deck.rows.length
    ? deck.rows.map((r) => `<div class="keys" role="group" aria-label="${esc(r.title)}">${r.keys.map((k) => keyHtml(k)).join('')}</div>`).join('<div style="height:12px"></div>')
    : `<div class="empty"><strong>No products yet</strong>Products are your Orca projects. Agents, pull requests and sites show here once a project has any.</div>`
  // A key that went away closes its drawer.
  if (open && !keyById(deck, open)) open = null
  const wall = `
    <section aria-label="Totals"><div class="keys">${deck.kpis.map((k) => keyHtml(k, 'kpi')).join('')}</div>
      <p class="hint" id="hint"></p></section>
    <section aria-label="Products"><h2>Products, worst first</h2>${rows}</section>
    ${deck.bots.length ? `<section aria-label="Bots"><h2>Bots</h2><div class="keys">${deck.bots.map((k) => keyHtml(k)).join('')}</div></section>` : ''}`
  let layout = app.querySelector<HTMLElement>('.layout')
  if (!layout) {
    app.innerHTML = '<div class="layout"><div class="wall"></div><aside class="drawer" id="drawer" aria-label="Details" hidden></aside></div>'
    layout = app.querySelector<HTMLElement>('.layout')!
  }
  layout.querySelector('.wall')!.innerHTML = wall
  const drawer = layout.querySelector<HTMLElement>('.drawer')!
  // Never redraw under someone typing an answer.
  const inDrawer = drawer.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null
  if (inDrawer?.tagName !== 'INPUT') {
    drawDrawer(drawer)
    // Keep focus on the same drawer control across a reading.
    const again = inDrawer?.dataset.act ? drawer.querySelector<HTMLElement>(`[data-act="${inDrawer.dataset.act}"]`) : inDrawer?.id ? document.getElementById(inDrawer.id) : null
    again?.focus({ preventScroll: true })
  }
  layout.classList.toggle('with-drawer', !!open)
  applyLit()
  if (focused) (app.querySelector(`[data-id="${CSS.escape(focused)}"]`) as HTMLElement | null)?.focus()
}

// ---- The drawer: the rows behind the open key ----
type Word = readonly [string, string]
const AGENT_WORD: Record<string, Word> = { working: ['Working', 'accent'], waiting: ['Waiting on you', 'warning'], errored: ['Errored', 'danger'], idle: ['Idle', 'neutral'], done: ['Done', 'success'] }
const CHECK_WORD: Record<string, Word> = { pass: ['Checks pass', 'success'], fail: ['Checks fail', 'danger'], pending: ['Checks running', 'warning'], none: ['No checks', 'neutral'] }
const REVIEW_WORD: Record<string, Word> = { approved: ['Approved', 'success'], changes: ['Changes asked', 'danger'], required: ['Review needed', 'warning'], none: ['No review', 'neutral'] }
const SITE_WORD: Record<string, Word> = { up: ['Up', 'success'], degraded: ['Degraded', 'warning'], down: ['Down', 'danger'] }
const RUN_WORD: Record<string, Word> = { pass: ['CI passed', 'success'], fail: ['CI failed', 'danger'], running: ['CI running', 'warning'] }
const pill = ([word, tone]: Word) => `<span class="pill" data-tone="${tone}">${esc(word)}</span>`

/** Registers what a drawer button does and returns its attribute. */
const act = (fn: () => void) => `data-act="${acts.push(fn) - 1}"`
const goTo = (worktreeId: string | null, address: string | null) => () => {
  if (worktreeId) void orca.plugin.request('navigate', { worktreeId, address }).catch(() => undefined)
}
const openUrl = (u: string) => () => {
  if (/^https?:\/\//i.test(u)) void orca.shell?.openExternal(u).catch(() => undefined)
}
/** A row: a button when it goes somewhere, else plain. */
const row = (fn: (() => void) | null, title: string, meta: string, extra = '') =>
  fn
    ? `<li><button class="row" ${act(fn)}><span class="t">${esc(title)}</span><span class="m">${meta}</span></button>${extra}</li>`
    : `<li><div class="row"><span class="t">${esc(title)}</span><span class="m">${meta}</span>${extra}</div></li>`
const list = (title: string, items: string[]) => (items.length ? `<h3>${esc(title)}</h3><ul>${items.join('')}</ul>` : '')

const plainLabel = (o: string) => o.replace(/ \(recommended\)$/, '')
const openChatTip = (n: NeedRow) =>
  `Opens ${n.from ?? 'the bot'}'s chats. Orca can't open one chat or answer for you from here: switch to ${n.chat ? `the '${n.chat}' chat` : 'the chat that owns this item'} and answer there.`

function needHtml(n: NeedRow): string {
  const answerable = n.kind === 'gate' && !!snap?.allowAnswer
  const openChat = n.kind === 'item' && !!n.worktreeId
  const asked = [n.question, ...n.decisions.filter((d) => d.prompt && d.prompt !== n.question).map((d) => d.prompt)].filter(Boolean)
  const options = n.decisions.flatMap((d) => d.options)
  let body = asked.map((q) => `<p class="q">${esc(q)}</p>`).join('')
  if (!answerable && options.length) body += `<div class="m">${options.map((o) => pill([o, 'neutral'])).join('')}</div>`
  if (answerable) {
    const done = outcome.get(n.key)
    body +=
      pending?.key === n.key
        ? `<div class="ask"><p class="q">Send '${esc(pending.text)}' to the coordinator?</p><div class="acts">
            <button class="btn go" ${sending ? 'disabled' : ''} ${act(() => void confirmGate(n))}>Confirm</button>
            <button class="btn" ${act(() => ((pending = null), redraw()))}>Cancel</button></div></div>`
        : `<div class="acts">${options.map((o) => `<button class="btn" ${act(() => askGate(n.key, plainLabel(o)))}>${esc(o)}</button>`).join('')}</div>
           <div class="acts"><input data-draft="${esc(n.key)}" aria-label="Answer: ${esc(n.title)}" placeholder="Or write a short answer" maxlength="${MAX_RESOLUTION}" value="${esc(drafts.get(n.key) ?? '')}">
            <button class="btn" ${act(() => askGate(n.key, drafts.get(n.key) ?? ''))}>Send</button></div>`
    if (done) body += `<p class="q" style="color:var(${done.ok ? '--ok' : '--bad'})">${esc(done.text)}</p>`
  }
  if (openChat) body += `<div class="acts"><button class="btn" title="${esc(openChatTip(n))}" ${act(goTo(n.worktreeId, n.address))}>Open chat to answer</button></div>`
  const meta = esc(n.from ? `${n.from} · ${n.product}` : n.product)
  // A row holding buttons cannot itself be one.
  return row(answerable || openChat || !n.worktreeId ? null : goTo(n.worktreeId, n.address), n.title, meta, body)
}

function detailHtml(d: Detail): string {
  const shipItems = d.ship.flatMap((r) => [
    ...(r.latestRun ? [row(r.latestRun.url ? openUrl(r.latestRun.url) : null, r.latestRun.name, `${pill(RUN_WORD[r.latestRun.result])}${esc(r.repo)}`)] : []),
    ...(r.error ? [row(null, r.repo, pill([r.error, 'warning']))] : []),
    ...r.prs.map((p) => row(openUrl(p.url), `#${p.number} ${p.title}`, `${p.draft ? pill(['Draft', 'neutral']) : ''}${pill(CHECK_WORD[p.checks])}${pill(REVIEW_WORD[p.review])}`))
  ])
  return [
    ...d.bots.map(
      (b) =>
        `<p class="said">Doing now: ${esc(b.doing)}</p><div class="m">${pill([b.needsYou ? `${b.open} open · ${b.needsYou} need you` : `${b.open} open`, b.needsYou ? 'warning' : 'neutral'])}</div>` +
        (b.lastSaid ? `<p class="said">Last said: ${esc(b.lastSaid)}</p>` : '') +
        list('Workers', b.workers.map((w) => row(w.worktreeId ? goTo(w.worktreeId, w.address) : null, w.label, pill(AGENT_WORD[w.state]))))
    ),
    list('Needs you', d.needs.map(needHtml)),
    list('Agents', d.agents.map((a) => row(goTo(a.worktreeId, a.address), a.title, `${pill(AGENT_WORD[a.state])}${esc(a.workspace)}${a.since ? ` · ${ago(a.since)}` : ''}${a.detail ? ` · ${esc(a.detail)}` : ''}`))),
    list('Pull requests and CI', shipItems),
    list('Sites', d.sites.map((x) => row(openUrl(x.url), x.name, `${pill(SITE_WORD[x.state])}${esc(x.error ?? (x.status ? `HTTP ${x.status}` : ''))} · ${x.ms} ms`))),
    list('Open work', d.tasks.map((t) => row(null, t.title, esc(`${t.status} · ${t.via}`)))),
    list('Recent messages', d.flows.map((f) => row(f.worktreeId ? goTo(f.worktreeId, f.address) : null, f.subject || f.type, `${f.waiting ? pill(['Waiting on you', 'warning']) : ''}${pill([f.type, 'neutral'])}${esc(`${f.from} → ${f.to}`)}${f.line ? ` · ${esc(f.line)}` : ''}`)))
  ].join('')
}

function drawDrawer(drawer: HTMLElement): void {
  const k = snap ? keyById(deck, open) : null
  acts = []
  drawer.hidden = !k
  if (!k || !snap) return void (drawer.innerHTML = '')
  const d = rowsBehind(k.of, snap)
  const title = k.id.startsWith('kpi:') ? `${k.label} · ${k.value}` : k.label
  drawer.innerHTML = `<div class="bar"><div><h2 id="drawer-title" tabindex="-1">${esc(title)}</h2>${k.sub ? `<p>${esc(k.sub)}</p>` : ''}</div>
    <button class="btn close" ${act(closeDrawer)} aria-label="Close details (Esc)">Close</button></div>
    ${isEmpty(d) ? '<p class="said">Nothing behind this key right now.</p>' : detailHtml(d)}`
}

const redraw = () => {
  const drawer = document.getElementById('drawer')
  if (drawer) drawDrawer(drawer)
}

function askGate(key: string, text: string): void {
  if (!text.trim()) return
  pending = { key, text: text.trim() }
  outcome.delete(key)
  redraw()
}

async function confirmGate(n: NeedRow): Promise<void> {
  if (sending || !pending) return
  const text = pending.text
  sending = true
  redraw()
  const r = await orca.plugin
    .request('gate.resolve', { gateId: n.key.slice('gate:'.length), resolution: text })
    .catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
  pending = null
  sending = false
  outcome.set(n.key, { ok: r.ok, text: r.ok ? `Sent '${text}'.` : `Not sent: ${r.error ?? 'unknown error'}` })
  redraw()
}

function openDrawer(k: Key): void {
  open = k.id
  // A total also outlines what counts toward it.
  lit = k.id.startsWith('kpi:') ? k.kpis[0] : null
  render()
  document.getElementById('drawer')?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  document.getElementById('drawer-title')?.focus({ preventScroll: true })
}

function closeDrawer(): void {
  const was = open
  open = null
  lit = null
  render()
  if (was) (document.querySelector(`.key[data-id="${CSS.escape(was)}"]`) as HTMLElement | null)?.focus()
}

function applyLit(): void {
  const on = highlighted(deck, lit)
  document.body.classList.toggle('lit', !!lit)
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('.key'))) el.classList.toggle('on', on.has(el.dataset.id ?? ''))
  const hint = document.getElementById('hint')
  if (hint) hint.textContent = lit ? 'Outlined: what counts toward it. Esc closes the details.' : 'Press any key for what is behind it.'
}

function press(k: Key): void {
  if (open === k.id) closeDrawer()
  else openDrawer(k)
}

function take(next: Snapshot): void {
  const s = asSnapshot(next)
  // A worker that just restarted has read nothing yet: keep the last reading over its empty one.
  if (!s.orcaAt && snap?.orcaAt && !s.errors.orca) return
  if (snap && !s.ghAt && snap.ghAt) Object.assign(s, { ghAt: snap.ghAt, ship: snap.ship })
  if (snap && !s.sitesAt && snap.sitesAt) Object.assign(s, { sitesAt: snap.sitesAt, sites: snap.sites })
  snap = s
  render()
  tick()
}

function fail(why: string): void {
  if (snap?.orcaAt) return
  loadError = why
  render()
}

function tick(): void {
  const m = document.getElementById('meta')
  if (m) m.innerHTML = meta()
}

const DIRS: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }

function start(): void {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)
  document.body.innerHTML = `<header><h1>${icon('gauge')}Control Room</h1><span class="meta" id="meta" aria-live="polite"></span></header><main id="app"></main>`
  render()

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const button = target.closest<HTMLElement>('[data-act]')
    if (button) return acts[Number(button.dataset.act)]?.()
    const el = target.closest<HTMLElement>('.key')
    const k = el && keysById.get(el.dataset.id ?? '')
    if (k) press(k)
  })
  document.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement
    if (el.dataset.draft) drafts.set(el.dataset.draft, el.value)
  })
  document.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement
    if (e.key === 'Enter' && el.dataset?.draft) return askGate(el.dataset.draft, (el as HTMLInputElement).value)
    if (e.key === 'Escape' && (open || lit)) {
      e.preventDefault()
      return closeDrawer()
    }
    const dir = DIRS[e.key]
    // Arrows move between keys; inside the drawer they stay the browser's.
    if (!dir || el.closest?.('.drawer')) return
    const keys = Array.from(document.querySelectorAll<HTMLElement>('.key'))
    if (!keys.length) return
    e.preventDefault()
    const from = keys.indexOf(document.activeElement as HTMLElement)
    if (from < 0) return keys[0].focus()
    const boxes = keys.map((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, w: r.width, h: r.height }
    })
    keys[moveFocus(boxes, from, dir)]?.focus()
  })

  // The file's text is never used, but asking for it is what tells Orca the editor is ready (and themed).
  orca.document?.onDidChange(() => undefined)
  orca.plugin.on('snapshot', take)
  window.addEventListener('error', (e) => fail(e.message))
  void orca.plugin.request('snapshot.get').then(take, (e: unknown) => fail(e instanceof Error ? e.message : String(e)))
  setInterval(tick, 1000)
}

start()
