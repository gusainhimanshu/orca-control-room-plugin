// The Details view of the Control Room panel, from invented data, in plain Node: buttons carry
// `data-act` and pressing one runs `env.acts[n]`, as the panel's click handler does.
import { assert, test } from 'orca/testing'
import { asCollapsed, asTab, detailsHtml, type DetailsState, type TabId } from './details'
import type { AgentRow } from './model'
import { emptySnapshot, type Snapshot } from './protocol'
import { gateState, takeSnap, type Env } from './rows'

const snap: Snapshot = {
  ...emptySnapshot(),
  orcaAt: Date.now(),
  ghAt: Date.now(),
  needsYou: [
    {
      key: 'item:i1',
      kind: 'item',
      product: 'Alpha',
      title: 'Review it',
      from: 'Helper',
      question: 'Merge now?',
      decisions: [{ prompt: 'Merge now?', options: ['yes (recommended)', 'no'] }],
      since: null,
      worktreeId: null,
      address: null
    }
  ],
  open: [{ product: 'Alpha', items: [{ key: 'task:t1', title: 'Build it', status: 'in progress', via: 'Helper' }] }],
  office: [
    {
      product: 'Alpha',
      items: [{ key: 'p1', title: 'Fix login', agent: 'claude', workspace: 'main', state: 'working', since: 0, detail: '', worktreeId: 'r1::/w', address: 'term_1' }]
    }
  ],
  flows: [
    {
      product: 'Alpha',
      items: [{ key: 'm1', from: 'Paint the door', to: 'coordinator', type: 'question', subject: 'Which colour?', line: 'Red or blue?', waiting: true, at: 0, worktreeId: 'r1::/w', address: 'structworker_1' }]
    }
  ],
  ship: [{ product: 'Alpha', repo: 'acme/alpha', prs: [], latestRun: null, error: null }],
  sitesAt: Date.now(),
  sites: [{ name: 'Shop', url: 'https://shop.example.com/', state: 'down', status: 503, ms: 42, error: null, since: 0, was: 'up' }],
  siteErrors: ['"oops": write it as Name=https://url'],
  projects: ['Alpha'],
  allowAnswer: true
}

const gate = {
  key: 'gate:g1',
  kind: 'gate' as const,
  product: 'Alpha',
  title: 'Ship it',
  from: null,
  question: 'Deploy now?',
  decisions: [{ prompt: '', options: ['deploy', 'wait'] }],
  since: null,
  worktreeId: null,
  address: null
}

const decode = (s: string) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
const textOf = (html: string) => decode(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim()

/** The Details view over `s`, recording what its rows ask of Orca. */
function details(s: Snapshot, st: Partial<DetailsState> = {}, answer: () => { ok: boolean; error?: string } = () => ({ ok: true })) {
  const navigated: unknown[] = []
  const opened: string[] = []
  const sent: unknown[] = []
  const state: DetailsState = { tab: 'queue', collapsed: {}, ...st }
  let html = ''
  let saves = 0
  const env: Env = {
    snap: s,
    acts: [],
    gate: gateState(),
    navigate: (worktreeId, address) => navigated.push({ worktreeId, address }),
    openUrl: (url) => opened.push(url),
    resolveGate: async (gateId, resolution) => (sent.push({ gateId, resolution }), answer()),
    redraw: () => draw()
  }
  const draw = () => {
    env.acts = []
    html = detailsHtml(env, state, () => (saves++, draw()))
  }
  draw()
  const buttons = () => [...html.matchAll(/<button([^>]*)data-act="(\d+)"([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ attrs: decode(m[1] + m[3]), n: Number(m[2]), text: textOf(m[4]) }))
  const button = (text: string | RegExp) => buttons().find((b) => (typeof text === 'string' ? b.text === text || b.text.startsWith(`${text} `) : text.test(b.text)))
  return {
    env,
    state,
    navigated,
    opened,
    sent,
    saves: () => saves,
    text: () => textOf(html),
    has: (t: string) => textOf(html).includes(t),
    buttons,
    button,
    async press(text: string | RegExp) {
      const b = button(text)
      assert.ok(b, `no button ${text} in: ${textOf(html)}`)
      env.acts[b.n]()
      await new Promise((r) => setTimeout(r, 0))
    },
    tab: (t: TabId) => ((state.tab = t), draw()),
    /** A group header: whether it is open, its description, and its 🟠/🔴 outline. */
    group(key: string) {
      const m = html.match(new RegExp(`<section class="grp"( data-tone="(\\w+)")? data-group="${key}">\\s*<button class="grp-h" data-act="\\d+" aria-expanded="(\\w+)">[\\s\\S]*?<span class="d">([^<]*)</span>`))
      assert.ok(m, `no group ${key}`)
      return { open: m[3] === 'true', description: decode(m[4]), tone: m[2] ?? null }
    }
  }
}

test('shows the queue, office, flows and ship tabs; rows navigate or open their link', async () => {
  const v = details(snap, { collapsed: { 'ship:Alpha': false, 'office:Alpha': false, 'flows:Alpha': false } })
  assert.deepEqual(v.buttons().filter((b) => b.attrs.includes('role="tab"')).map((b) => b.text), ['Overview', 'Queue · 1', 'Office', 'Flows', 'Ship'])
  assert.ok(v.has('Merge now?'))
  // Options are labels, not answer buttons.
  assert.ok(v.has('yes (recommended)'))
  assert.equal(v.buttons().filter((b) => /^(yes|no)/.test(b.text)).length, 0)
  assert.ok(v.has('Helper · Alpha'))
  assert.ok(v.has('Build it'))

  v.tab('office')
  await v.press('Fix login')
  assert.deepEqual(v.navigated, [{ worktreeId: 'r1::/w', address: 'term_1' }])

  v.tab('flows')
  assert.ok(v.has('Paint the door → coordinator'))
  assert.ok(v.has('Waiting on you'))
  assert.ok(v.has('Red or blue?'))
  await v.press('Which colour?')
  assert.deepEqual(v.navigated[1], { worktreeId: 'r1::/w', address: 'structworker_1' })

  v.tab('ship')
  assert.ok(v.has('acme/alpha · no open pull requests'))
  assert.ok(v.has('Down'))
  assert.ok(v.has('HTTP 503 · 42 ms'))
  assert.ok(v.has('Sites to ping: "oops": write it as Name=https://url'))
  await v.press('Shop')
  assert.deepEqual(v.opened, ['https://shop.example.com/'])
})

test('pressing a tab picks it and is remembered', async () => {
  const v = details(snap)
  await v.press('Office')
  assert.equal(v.state.tab, 'office')
  assert.equal(v.saves(), 1)
  assert.ok(v.buttons().find((b) => b.text === 'Office')?.attrs.includes('aria-selected="true"'))
  assert.equal(asTab('ship'), 'ship')
  assert.equal(asTab('dashboard'), 'overview')
  assert.equal(asTab(7), 'overview')
})

test('Overview: the diagram puts bots under you and workers under bots; pressing a node navigates', async () => {
  const s: Snapshot = {
    ...snap,
    overview: [
      {
        name: 'Helper',
        doing: 'Build login',
        open: 2,
        needsYou: 1,
        lastSaid: 'Opened the PR.',
        worktreeId: null,
        address: null,
        workers: [{ key: 'ctx_a', label: 'Login worker', state: 'working', worktreeId: 'r1::/a', address: 'structworker_a', prs: [] }],
        prs: []
      }
    ]
  }
  const v = details(s, { tab: 'overview' })
  assert.ok(v.has('You'))
  assert.equal(v.group('overview:Helper').description, '2 open · 🟠 1 need you · +1 more')
  assert.equal(v.group('overview:Helper').tone, 'warning')
  // Collapsed, the card shows what the bot is doing now; opened, everything.
  assert.ok(v.has('Doing now: Build login'))
  assert.ok(!v.has('Last said: Opened the PR.'))
  await v.press(/^▸ Helper/)
  assert.ok(v.has('Last said: Opened the PR.'))
  await v.press(/^Login worker Working$/)
  assert.deepEqual(v.navigated, [{ worktreeId: 'r1::/a', address: 'structworker_a' }])
})

test('a gate option asks for confirmation first; Cancel sends nothing; Confirm sends it once', async () => {
  const v = details({ ...snap, needsYou: [gate] })
  await v.press('deploy')
  assert.ok(v.has("Send 'deploy' to the coordinator?"))
  assert.deepEqual(v.sent, [])
  await v.press('Cancel')
  assert.ok(!v.has("Send 'deploy' to the coordinator?"))
  assert.deepEqual(v.sent, [])

  await v.press('wait')
  // A double click on Confirm sends it once.
  const confirm = v.env.acts[v.button('Confirm')!.n]
  confirm()
  confirm()
  await new Promise((r) => setTimeout(r, 0))
  assert.deepEqual(v.sent, [{ gateId: 'g1', resolution: 'wait' }])
  assert.ok(v.has("Sent 'wait'."))
})

test('a typed gate answer also needs confirming, and a refusal shows inline', async () => {
  const v = details({ ...snap, needsYou: [gate] }, {}, () => ({ ok: false, error: 'gate already resolved' }))
  v.env.gate.drafts.set('gate:g1', '  after lunch  ')
  await v.press('Send')
  assert.deepEqual(v.sent, [])
  await v.press('Confirm')
  assert.deepEqual(v.sent, [{ gateId: 'g1', resolution: 'after lunch' }])
  assert.ok(v.has('Not sent: gate already resolved'))
})

test('with answering turned off, a gate shows its options as labels and nothing can be sent', () => {
  const v = details({ ...snap, allowAnswer: false, needsYou: [gate] })
  assert.ok(v.has('deploy'))
  assert.equal(v.buttons().filter((b) => /deploy|wait|Send|Confirm/.test(b.text)).length, 0)
  assert.ok(v.has('Read-only'))
})

test("a bot item without a known home falls back to the chat's workspace, names the chat and shows the callout; nothing is sent", async () => {
  const item = { ...snap.needsYou[0], worktreeId: 'f::/bots', address: 'orca_session_id:bot-chat-1', chat: 'Planning' }
  const v = details({ ...snap, needsYou: [item] })
  assert.ok(v.has('no'))
  assert.equal(v.buttons().filter((b) => /^(no|yes)/.test(b.text)).length, 0)
  const open = v.button("Open 'Planning' to answer")
  assert.ok(open)
  assert.match(open.attrs, /'Planning' in its chat list/)
  assert.ok(!v.has('Now click'))
  await v.press("Open 'Planning' to answer")
  assert.deepEqual(v.navigated, [{ worktreeId: 'f::/bots', address: 'orca_session_id:bot-chat-1' }])
  assert.ok(v.has("Now click the 'Planning' chat in Helper's sidebar then answer: Merge now? yes (recommended) no"))
  assert.deepEqual(v.sent, [])
  await v.press('Dismiss')
  assert.ok(!v.has('Now click'))
})

test("'Open … to answer' lands on the bot's home over the chat's workspace; Home Chat by name; the callout clears once answered", async () => {
  const item = { ...snap.needsYou[0], worktreeId: 'f::/bots', address: 'orca_session_id:bot-chat-1', chat: 'Home', home: 'folder:home-h' }
  const v = details({ ...snap, needsYou: [item] })
  await v.press('Open Home Chat to answer')
  assert.deepEqual(v.navigated, [{ worktreeId: 'folder:home-h', address: null }])
  assert.ok(v.has("Now click Home Chat in Helper's sidebar then answer: Merge now?"))
  // A reading where the item still needs the owner keeps it; one where it no longer does clears it.
  takeSnap(v.env, { ...snap, needsYou: [item] })
  assert.equal(v.env.gate.landed, 'item:i1')
  takeSnap(v.env, { ...snap, needsYou: [] })
  assert.equal(v.env.gate.landed, null)
  takeSnap(v.env, { ...snap, needsYou: [item] })
  v.env.redraw()
  assert.ok(!v.has('Now click'))
})

test("a bot item with a home but no chat Orca shows still opens the home, with a generic label", async () => {
  const v = details({ ...snap, needsYou: [{ ...snap.needsYou[0], home: 'folder:home-h' }] })
  await v.press('Open chat to answer')
  assert.deepEqual(v.navigated, [{ worktreeId: 'folder:home-h', address: null }])
  assert.ok(v.has("Now click the chat that owns this item in Helper's sidebar"))
})

test("a bot item whose chat Orca doesn't show keeps its options as text and has no button", () => {
  const v = details(snap)
  assert.ok(v.has('no'))
  assert.equal(v.button(/^Open .* to answer$/), undefined)
})

test('a Product:Name site shows with its product on Ship; an unknown product stays under Sites', () => {
  const row = { url: 'https://x.example.com/', state: 'up' as const, status: 200, ms: 5, error: null, since: 0, was: null }
  const s: Snapshot = {
    ...snap,
    siteErrors: [],
    projects: ['Alpha', 'Beta'],
    sites: [
      { ...row, product: 'alpha', name: 'Docs' },
      { ...row, product: 'Beta', name: 'Status' },
      { ...row, product: 'Nope', name: 'Blog' }
    ]
  }
  const v = details(s, { tab: 'ship', collapsed: { 'ship:Alpha': false, 'ship:Beta': false, 'ship:Sites': false } })
  assert.equal(v.group('ship:Sites').description, '1 of 1 up')
  // Beta has no GitHub repo here, so it gets a card of its own.
  assert.equal(v.group('ship:Beta').description, '1 of 1 up')
  assert.equal(v.group('ship:Alpha').description, 'No runs · 0 open')
  for (const name of ['Docs', 'Status', 'Blog']) assert.ok(v.button(name), name)
})

test('a snapshot from an older version (no flows, no sites) draws every tab', () => {
  const { flows, sites, sitesAt, siteErrors, ...old } = snap
  void [flows, sites, sitesAt, siteErrors]
  const s = { ...emptySnapshot(), ...old }
  for (const tab of ['overview', 'queue', 'office', 'flows', 'ship'] as const) assert.ok(details(s, { tab }).text())
})

test('groups start collapsed; one expands and collapses, and the state is remembered per tab', async () => {
  const v = details(snap, { tab: 'office' })
  assert.equal(v.group('office:Alpha').open, false)
  // Collapsed, the header keeps its summary.
  assert.equal(v.group('office:Alpha').description, '1 working')
  await v.press(/^▸ Alpha/)
  assert.equal(v.group('office:Alpha').open, true)
  assert.deepEqual(v.state.collapsed, { 'office:Alpha': false })
  // Another tab's group of the same product is its own.
  v.tab('queue')
  assert.equal(v.group('queue:Alpha').open, false)
  v.tab('office')
  await v.press(/^▾ Alpha/)
  assert.equal(v.group('office:Alpha').open, false)
  assert.deepEqual(v.state.collapsed, {})
  assert.equal(v.saves(), 2)
})

test('a collapsed group with something waiting on you is marked 🟠; expanded, it is not', async () => {
  const v = details(snap, { tab: 'flows', collapsed: { 'flows:Alpha': true, 'flows:Gone': true } })
  assert.deepEqual(v.group('flows:Alpha'), { open: false, description: '1 messages · 🟠 1 waiting on you', tone: 'warning' })
  await v.press(/^▸ Alpha/)
  assert.deepEqual(v.group('flows:Alpha'), { open: true, description: '1 messages', tone: null })
})

test('a collapsed Ship card with a site down is marked 🔴', () => {
  const v = details({ ...snap, sites: [{ ...snap.sites[0], product: 'Alpha' }] }, { tab: 'ship' })
  assert.deepEqual(v.group('ship:Alpha'), { open: false, description: 'No runs · 0 open · 🔴 1 down', tone: 'danger' })
})

test('collapsed state an older or broken version stored is ignored', () => {
  assert.deepEqual(asCollapsed(['office:Alpha']), {})
  assert.deepEqual(asCollapsed({ 'office:Alpha': false, bad: 'x' }), { 'office:Alpha': false })
  assert.equal(details(snap, { tab: 'office', collapsed: asCollapsed('garbage') }).group('office:Alpha').open, false)
})

const agent = (key: string, state: AgentRow['state']): AgentRow => ({ ...snap.office[0].items[0], key, title: `Agent ${key}`, state })

test('collapsed, a group shows only its running rows and says how many more there are; expanded, all of them', async () => {
  const now = Date.now()
  const flow = snap.flows[0].items[0]
  const s: Snapshot = {
    ...snap,
    orcaAt: now,
    office: [{ product: 'Alpha', items: [agent('a', 'working'), agent('b', 'errored'), agent('c', 'idle'), agent('d', 'idle')] }],
    open: [
      {
        product: 'Alpha',
        items: [
          { key: 't1', title: 'Build it', status: 'in progress', via: 'Helper' },
          { key: 't2', title: 'Plan it', status: 'planned', via: 'Helper' }
        ]
      }
    ],
    flows: [
      {
        product: 'Alpha',
        items: [
          { ...flow, key: 'f1', subject: 'Fresh note', waiting: false, at: now - 60_000 },
          { ...flow, key: 'f2', subject: 'Old note', waiting: false, at: now - 60 * 60_000 }
        ]
      }
    ],
    ship: [
      {
        product: 'Alpha',
        repo: 'acme/alpha',
        latestRun: { name: 'CI', result: 'pass', url: 'https://ci.example.com/1', at: 1 },
        error: null,
        prs: [
          { number: 1, title: 'Red one', url: 'https://github.com/acme/alpha/pull/1', draft: false, checks: 'fail', review: 'none' },
          { number: 2, title: 'Green one', url: 'https://github.com/acme/alpha/pull/2', draft: false, checks: 'pass', review: 'approved' }
        ]
      }
    ],
    sites: [],
    siteErrors: []
  }
  const v = details(s, { tab: 'office' })
  assert.ok(v.has('Agent a'))
  assert.ok(v.has('Agent b'))
  assert.ok(!v.has('Agent c'))
  assert.equal(v.group('office:Alpha').description, '1 working · 1 errored · 2 idle · 🔴 1 errored · +2 more')
  await v.press(/^▸ Alpha/)
  assert.ok(v.has('Agent c'))
  assert.ok(v.has('Agent d'))
  assert.equal(v.group('office:Alpha').description, '1 working · 1 errored · 2 idle')

  v.tab('queue')
  assert.ok(v.has('Build it'))
  assert.ok(!v.has('Plan it'))
  assert.equal(v.group('queue:Alpha').description, '2 open · +1 more')

  v.tab('flows')
  assert.ok(v.has('Fresh note'))
  assert.ok(!v.has('Old note'))

  v.tab('ship')
  assert.ok(v.has('#1 Red one'))
  assert.ok(!v.has('#2 Green one'))
  // The passing run and the green PR are left out.
  assert.equal(v.group('ship:Alpha').description, 'CI passed · 2 open · 🔴 1 PR failing · +2 more')
  await v.press('#1 Red one')
  assert.deepEqual(v.opened, ['https://github.com/acme/alpha/pull/1'])
})

test('collapsed with nothing running, a group shows only its header and summary', () => {
  const v = details({ ...snap, office: [{ product: 'Alpha', items: [agent('c', 'idle'), agent('d', 'idle')] }] }, { tab: 'office' })
  assert.ok(!v.has('Agent c'))
  assert.equal(v.group('office:Alpha').description, '2 idle · +2 more')
})

test('a group the user expanded before stays expanded', () => {
  const v = details({ ...snap, office: [{ product: 'Alpha', items: [agent('c', 'idle')] }] }, { tab: 'office', collapsed: { 'office:Alpha': false } })
  assert.equal(v.group('office:Alpha').open, true)
  assert.ok(v.has('Agent c'))
  assert.equal(v.group('office:Alpha').description, '1 idle')
})
