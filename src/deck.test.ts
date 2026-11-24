// The Dashboard's wall of keys, from invented data.
import { assert, test } from 'orca/testing'
import { activeOnly, botKeys, buildDeck, DAY_MS, isActive, headLine, highlighted, isEmpty, keyById, kpiCounts, moveFocus, productRows, QUIET_ROW, rowsBehind, SITES_ROW, worstTone, type Box } from './deck'
import type { AgentRow, PrRow } from './model'
import { emptySnapshot, type Snapshot } from './protocol'
import type { SiteRow } from './sites'

const agent = (key: string, state: AgentRow['state']): AgentRow => ({
  key,
  title: `Task ${key}`,
  agent: 'claude',
  workspace: 'w',
  state,
  since: 1,
  detail: '',
  worktreeId: `r::${key}`,
  address: `term_${key}`
})
const pr = (number: number, checks: PrRow['checks'], review: PrRow['review'] = 'none'): PrRow => ({
  number,
  title: `Change ${number}`,
  url: `https://github.com/acme/x/pull/${number}`,
  draft: false,
  checks,
  review
})
const site = (name: string, state: SiteRow['state'], product?: string): SiteRow => ({
  name,
  url: `https://${name.toLowerCase()}.example.com/`,
  product,
  state,
  status: state === 'down' ? 503 : 200,
  ms: 10,
  error: null,
  since: 1,
  was: null
})

const snap: Snapshot = {
  ...emptySnapshot(),
  orcaAt: 1,
  projects: ['Alpha', 'Beta', 'Gamma'],
  office: [
    { product: 'Alpha', items: [agent('a1', 'working'), agent('a2', 'idle'), agent('a3', 'idle')] },
    { product: 'Beta', items: [agent('b1', 'waiting'), agent('b2', 'errored')] },
    { product: 'Gamma', items: [agent('g1', 'idle')] }
  ],
  needsYou: [
    { key: 'item:i1', kind: 'item', product: 'Alpha', title: 'Pick a name', from: 'Helper', question: '?', decisions: [], since: 1, worktreeId: null, address: null },
    // Agents waiting on you are drawn as agent keys, not twice.
    { key: 'agent:b1', kind: 'agent', product: 'Beta', title: 'Task b1', from: null, question: '?', decisions: [], since: 1, worktreeId: 'r::b1', address: 'term_b1' }
  ],
  ship: [
    { product: 'Alpha', repo: 'acme/alpha', prs: [pr(1, 'pass'), pr(2, 'pass'), pr(3, 'pending')], latestRun: { name: 'CI', result: 'pass', url: 'https://github.com/acme/alpha/actions/runs/1', at: 1 }, error: null },
    { product: 'Gamma', repo: 'acme/gamma', prs: [pr(4, 'fail'), pr(5, 'pass', 'changes')], latestRun: { name: 'CI', result: 'fail', url: '', at: 1 }, error: null }
  ],
  open: [{ product: 'Alpha', items: [{ key: 't1', title: 'Build', status: 'in progress', via: 'Helper' }] }],
  sites: [site('Shop', 'down'), site('Docs', 'up', 'alpha'), site('Blog', 'up', 'Alpha')]
}

test('KPIs count what waits on you, agents by state, failing PRs and sites down', () => {
  assert.deepEqual(kpiCounts(snap), { needs: 2, working: 1, waiting: 1, errored: 1, prsFailing: 1, sitesDown: 1 })
  const deck = buildDeck(snap, 0)
  assert.deepEqual(
    deck.kpis.map((k) => [k.label, k.value, k.tone]),
    [
      ['Needs you', '2', 'warning'],
      ['Working', '1', 'accent'],
      ['Waiting', '1', 'warning'],
      ['Errored', '1', 'danger'],
      ['PRs failing', '1', 'danger'],
      ['Sites down', '1', 'danger']
    ]
  )
  // A zero stays calm.
  assert.ok(buildDeck(emptySnapshot(), 0).kpis.every((k) => k.tone === 'neutral' && k.value === '0'))
})

test('one row per product, worst first, each led by its product key', () => {
  const rows = productRows(snap)
  // Beta (errored agent) and Gamma (failing PR, CI) and Sites (down) are red: ties by name. Alpha is amber.
  assert.deepEqual(rows.map((r) => [r.title, r.keys[0].tone]), [
    ['Beta', 'danger'],
    ['Gamma', 'danger'],
    [SITES_ROW, 'danger'],
    ['Alpha', 'warning']
  ])
  assert.ok(rows.every((r) => r.keys[0].head && r.keys.slice(1).every((k) => !k.head)))
  // Keys inside a row are worst first too.
  const beta = rows[0].keys.slice(1)
  assert.deepEqual(beta.map((k) => k.tone), ['danger', 'warning'])
  assert.equal(rows[0].keys[0].sub, '1 failing')
})

test('quiet things fold into one summary key per row', () => {
  const alpha = productRows(snap).find((r) => r.title === 'Alpha')!.keys
  const labels = alpha.map((k) => `${k.label}|${k.sub ?? ''}`)
  assert.ok(labels.includes('2 agents|idle'))
  assert.ok(labels.includes('2 PRs|green'))
  assert.ok(labels.includes('2 sites|up'))
  // The running PR, the working agent and the item waiting on you stay their own keys.
  assert.ok(labels.includes('Change 3|checks running'))
  assert.ok(labels.includes('Task a1|working'))
  assert.ok(labels.includes('Pick a name|Helper asks'))
  // Summaries stand for what they fold; leaves for their one row.
  assert.deepEqual(alpha.find((k) => k.label === '2 PRs')!.of, { product: 'Alpha', part: 'prs', ref: undefined })
  assert.deepEqual(alpha.find((k) => k.label === 'Change 3')!.of, { product: 'Alpha', part: 'pr', ref: 'https://github.com/acme/x/pull/3' })
  assert.deepEqual(alpha.find((k) => k.label === 'Task a1')!.of, { product: 'Alpha', part: 'agent', ref: 'a1' })
  const gamma = productRows(snap).find((r) => r.title === 'Gamma')!.keys
  assert.ok(gamma.some((k) => k.sub === 'changes asked' && k.tone === 'warning'))
  // A product with only quiet keys is green; one that reads nothing at all stays neutral.
  const quiet = productRows({ ...emptySnapshot(), office: [{ product: 'Q', items: [agent('q', 'idle')] }] })
  assert.equal(quiet[0].keys[0].tone, 'success')
  assert.equal(quiet[0].keys[0].sub, 'All quiet')
})

test('a pressed KPI outlines exactly the keys that count toward it', () => {
  const deck = buildDeck(snap, 0)
  const ids = (k: Parameters<typeof highlighted>[1]) => [...highlighted(deck, k)].sort()
  assert.deepEqual(ids('sitesDown'), [`${SITES_ROW}:site:Shop`, 'kpi:sitesDown'])
  assert.deepEqual(ids('prsFailing'), ['Gamma:pr:https://github.com/acme/x/pull/4', 'kpi:prsFailing'])
  assert.deepEqual(ids('needs'), ['Alpha:item:i1', 'Beta:agent:b1', 'kpi:needs'])
  assert.equal(highlighted(deck, null).size, 0)
})

test('bot keys: workers count, waiting count, colour by the worst worker', () => {
  const base = { doing: '', open: 0, lastSaid: '', worktreeId: 'bots::b', address: 'orca_session_id:b', prs: [] }
  const w = (state: 'working' | 'waiting' | 'idle' | 'errored' | 'done') => ({ key: state, label: state, state, worktreeId: null, address: null, prs: [] })
  const keys = botKeys([
    { ...base, name: 'Calm', needsYou: 0, workers: [w('idle')] },
    { ...base, name: 'Asks', needsYou: 1, workers: [w('working'), w('waiting')] },
    { ...base, name: 'Broken', needsYou: 0, workers: [w('errored')] }
  ])
  assert.deepEqual(keys.map((k) => [k.label, k.value, k.sub, k.tone]), [
    ['Calm', '1', '1 worker', 'neutral'],
    ['Asks', '2', '2 waiting', 'warning'],
    ['Broken', '1', '1 worker', 'danger']
  ])
  assert.deepEqual(keys[1].kpis, ['needs', 'waiting'])
  assert.deepEqual(keys[0].of, { bot: 'Calm' })
})

test('worst tone and the product line', () => {
  assert.equal(worstTone(['success', 'accent', 'warning']), 'warning')
  assert.equal(worstTone([]), 'neutral')
  assert.equal(headLine([]), 'Nothing to show')
})

test('arrow keys stay inside the grid', () => {
  // Two lines: three keys, then two. 100 px keys, 10 px gaps.
  const b = (x: number, y: number): Box => ({ x, y, w: 100, h: 100 })
  const boxes = [b(0, 0), b(110, 0), b(220, 0), b(0, 110), b(110, 110)]
  assert.equal(moveFocus(boxes, 0, 'left'), 0)
  assert.equal(moveFocus(boxes, 4, 'right'), 4)
  assert.equal(moveFocus(boxes, 2, 'right'), 3) // wraps onto the next line
  assert.equal(moveFocus(boxes, 1, 'down'), 4)
  assert.equal(moveFocus(boxes, 2, 'down'), 4) // nearest key on the line below
  assert.equal(moveFocus(boxes, 0, 'up'), 0)
  assert.equal(moveFocus(boxes, 3, 'down'), 3)
  assert.equal(moveFocus(boxes, 99, 'up'), 1) // a stale index is clamped first
  assert.equal(moveFocus([], 0, 'down'), -1)
})

test('products with nothing to show share one last row', () => {
  const rows = productRows({ ...snap, ship: [...snap.ship, { product: 'Delta', repo: 'acme/delta', prs: [], latestRun: null, error: null }], open: [...snap.open, { product: 'Epsilon', items: [] }] })
  const last = rows[rows.length - 1]
  assert.equal(last.title, QUIET_ROW)
  assert.deepEqual(last.keys.map((k) => [k.label, k.tone, k.sub]), [
    ['Delta', 'neutral', 'Nothing to show'],
    ['Epsilon', 'neutral', 'Nothing to show']
  ])
  assert.ok(rows.slice(0, -1).every((r) => r.keys.length > 1))
})

test('rows behind a total: the matching rows from every product', () => {
  const deck = buildDeck(snap, 0)
  const behind = (id: string) => rowsBehind(keyById(deck, id)!.of, snap)
  assert.deepEqual(behind('kpi:needs').needs.map((n) => n.key), ['item:i1', 'agent:b1'])
  assert.deepEqual(behind('kpi:working').agents.map((a) => a.key), ['a1'])
  assert.deepEqual(behind('kpi:errored').agents.map((a) => a.key), ['b2'])
  const failing = behind('kpi:prsFailing')
  assert.deepEqual(failing.ship.map((r) => [r.repo, r.prs.map((p) => p.number), r.latestRun]), [['acme/gamma', [4], null]])
  assert.deepEqual(behind('kpi:sitesDown').sites.map((x) => x.name), ['Shop'])
  assert.equal(keyById(deck, 'nope'), null)
  assert.equal(keyById(deck, null), null)
})

test("rows behind a product key: its agents, items, PRs, CI, sites, open work and messages", () => {
  const s: Snapshot = { ...snap, flows: [{ product: 'Alpha', items: [{ key: 'm1', from: 'a', to: 'b', type: 'status', subject: 'Hi', line: '', waiting: false, at: 1, worktreeId: null, address: null }] }] }
  const d = rowsBehind(keyById(buildDeck(s, 0), 'Alpha:head')!.of, s)
  assert.deepEqual(d.agents.map((a) => a.key), ['a1', 'a2', 'a3'])
  assert.deepEqual(d.needs.map((n) => n.key), ['item:i1'])
  assert.deepEqual(d.ship.map((r) => [r.prs.length, r.latestRun?.result]), [[3, 'pass']])
  assert.deepEqual(d.sites.map((x) => x.name), ['Docs', 'Blog'])
  assert.deepEqual(d.tasks.map((t) => t.key), ['t1'])
  assert.deepEqual(d.flows.map((f) => f.key), ['m1'])
  // An agent waiting on you is an agent row, not a second needs-you row.
  const beta = rowsBehind({ product: 'Beta', part: 'all' }, snap)
  assert.deepEqual([beta.needs.length, beta.agents.length], [0, 2])
  // Sites with no product belong to the Sites row.
  assert.deepEqual(rowsBehind({ product: SITES_ROW, part: 'all' }, snap).sites.map((x) => x.name), ['Shop'])
})

test('rows behind a summary key are what it folded; behind a leaf, its one row', () => {
  const alpha = productRows(snap).find((r) => r.title === 'Alpha')!.keys
  const behind = (label: string) => rowsBehind(alpha.find((k) => k.label === label)!.of, snap)
  assert.deepEqual(behind('2 agents').agents.map((a) => a.key), ['a2', 'a3'])
  assert.deepEqual(behind('2 PRs').ship[0].prs.map((p) => p.number), [1, 2])
  assert.deepEqual(behind('2 sites').sites.map((x) => x.name), ['Docs', 'Blog'])
  assert.deepEqual(behind('Open items').tasks.map((t) => t.key), ['t1'])
  assert.deepEqual(behind('Change 3').ship[0].prs.map((p) => p.number), [3])
  assert.deepEqual(behind('Task a1').agents.map((a) => a.key), ['a1'])
  assert.deepEqual(behind('Pick a name').needs.map((n) => n.key), ['item:i1'])
  const run = behind('CI')
  assert.deepEqual([run.ship[0].prs.length, run.ship[0].latestRun?.result], [0, 'pass'])
  // A leaf whose row went away lists nothing.
  assert.ok(isEmpty(rowsBehind({ product: 'Alpha', part: 'agent', ref: 'gone' }, snap)))
})

test('rows behind a bot key: the bot, the items it asks, its open work', () => {
  const bot = { name: 'Helper', doing: 'Build', open: 1, needsYou: 1, lastSaid: 'Done.', worktreeId: null, address: null, workers: [], prs: [] }
  const s: Snapshot = { ...snap, overview: [bot] }
  const d = rowsBehind(keyById(buildDeck(s, 0), 'bot:Helper')!.of, s)
  assert.deepEqual(d.bots.map((b) => b.lastSaid), ['Done.'])
  assert.deepEqual(d.needs.map((n) => n.key), ['item:i1'])
  assert.deepEqual(d.tasks.map((t) => t.key), ['t1'])
})

test('a project is active when a workspace had activity within the days, the boundary included', () => {
  const now = 100 * DAY_MS
  assert.equal(isActive(now - 15 * DAY_MS, now, 15), true)
  assert.equal(isActive(now - 15 * DAY_MS - 1, now, 15), false)
  assert.equal(isActive(now, now, 15), true)
  // No workspace, no activity: inactive.
  assert.equal(isActive(undefined, now, 15), false)
})

test('the Dashboard shows only active projects; Needs you still counts every question', () => {
  const now = 100 * DAY_MS
  // Alpha active on the boundary, Beta quiet for 16 days, Gamma and Zeta have no workspaces.
  const s: Snapshot = { ...snap, projects: [...snap.projects, 'Zeta'], activeDays: 15, lastActive: { Alpha: now - 15 * DAY_MS, Beta: now - 16 * DAY_MS } }
  assert.deepEqual(activeOnly(s, now).hidden, ['Beta', 'Gamma', 'Zeta'])
  const deck = buildDeck(s, now)
  assert.equal(deck.hidden, 3)
  // Beta's waiting and errored agents and Gamma's failing PR leave the totals; Beta's ask stays in Needs you.
  assert.deepEqual(Object.fromEntries(deck.kpis.map((k) => [k.label, k.value])), { 'Needs you': '2', Working: '1', Waiting: '0', Errored: '0', 'PRs failing': '0', 'Sites down': '1' })
  // Sites with no product are no Orca project: their row stays. No Nothing-to-show row for Zeta.
  assert.deepEqual(deck.rows.map((r) => r.title).sort(), ['Alpha', SITES_ROW])
  assert.deepEqual(rowsBehind({ kpi: 'needs' }, activeOnly(s, now).view).needs.map((n) => n.key), ['item:i1', 'agent:b1'])
  // Off (0, as an older snapshot reads) hides nothing.
  assert.equal(buildDeck({ ...s, activeDays: 0 }, now).hidden, 0)
})
