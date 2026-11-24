// The panel draws a snapshot and rows only navigate.
import { assert, mockHost, mount, stored, test } from 'orca/testing'
import * as panel from './panel'
import { emptySnapshot, type Snapshot } from './protocol'

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
      since: 1,
      worktreeId: null,
      address: null
    }
  ],
  open: [{ product: 'Alpha', items: [{ key: 'task:t1', title: 'Build it', status: 'in progress', via: 'Helper' }] }],
  office: [
    {
      product: 'Alpha',
      items: [{ key: 'p1', title: 'Fix login', agent: 'claude', workspace: 'main', state: 'working', since: 1, detail: '', worktreeId: 'r1::/w', address: 'term_1' }]
    }
  ],
  flows: [
    {
      product: 'Alpha',
      items: [
        { key: 'm1', from: 'Paint the door', to: 'coordinator', type: 'question', subject: 'Which colour?', line: 'Red or blue?', waiting: true, at: 0, worktreeId: 'r1::/w', address: 'structworker_1' }
      ]
    }
  ],
  ship: [{ product: 'Alpha', repo: 'acme/alpha', prs: [], latestRun: null, error: null }],
  sitesAt: Date.now(),
  sites: [{ name: 'Shop', url: 'https://shop.example.com/', state: 'down', status: 503, ms: 42, error: null, since: 1, was: 'up' }],
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
  since: 2,
  worktreeId: null,
  address: null
}

/** A panel over `s` that records every gate.resolve and navigate request it gets. */
async function withGate(s: Snapshot, answer: (input: unknown) => { ok: boolean; error?: string } = () => ({ ok: true })) {
  const sent: unknown[] = []
  const navigated: unknown[] = []
  const host = mockHost({
    requests: {
      'snapshot.get': () => s,
      'gate.resolve': (input) => (sent.push(input), answer(input)),
      navigate: (input) => (navigated.push(input), { ok: true })
    }
  })
  const view = await mount(panel, { host })
  // Overview is the first tab; these tests are about the Queue.
  await view.select({ role: 'tablist' }, 'queue')
  return { view, sent, navigated }
}

test('shows the queue, office and ship board; pressing an agent navigates', async () => {
  const navigated: unknown[] = []
  const host = mockHost({
    requests: {
      'snapshot.get': () => snap,
      navigate: (input) => (navigated.push(input), { ok: true })
    }
  })
  // Groups start collapsed; the Ship card was opened before, so it shows everything.
  const view = await mount(panel, { host, persisted: { plugin: { collapsed: { 'ship:Alpha': false } } } })
  await view.select({ role: 'tablist' }, 'queue')
  assert.ok(view.find({ text: 'Merge now?' }))
  // Options are labels, not answer buttons.
  assert.ok(view.find({ text: 'yes (recommended)' }))
  assert.equal(view.findAll({ role: 'button' }).filter((b) => /yes|no/.test(b.text ?? '')).length, 0)
  assert.ok(view.find({ text: 'Helper · Alpha' }))
  assert.ok(view.find({ label: 'Build it' }))

  await view.select({ role: 'tablist' }, 'office')
  await view.press({ label: 'Fix login' })
  assert.deepEqual(navigated, [{ worktreeId: 'r1::/w', address: 'term_1' }])

  await view.select({ role: 'tablist' }, 'flows')
  assert.ok(view.find({ text: 'Paint the door → coordinator' }))
  assert.ok(view.find({ text: 'Waiting on you' }))
  assert.ok(view.find({ text: 'Red or blue?' }))
  await view.press({ label: 'Which colour?' })
  assert.deepEqual(navigated[1], { worktreeId: 'r1::/w', address: 'structworker_1' })

  await view.select({ role: 'tablist' }, 'ship')
  assert.ok(view.find({ text: 'acme/alpha · no open pull requests' }))
  assert.ok(view.find({ text: 'Down' }))
  assert.ok(view.find({ text: 'HTTP 503 · 42 ms' }))
  assert.ok(view.find({ text: 'Sites to ping: "oops": write it as Name=https://url' }))

  // A restarted worker's empty snapshot does not wipe the last reading.
  await view.post('snapshot', emptySnapshot())
  assert.ok(view.find({ text: 'acme/alpha · no open pull requests' }))
  // ...nor does its first Orca reading wipe the GitHub one.
  await view.post('snapshot', { ...snap, ghAt: 0, ship: [] })
  assert.ok(view.find({ text: 'acme/alpha · no open pull requests' }))

  await view.post('snapshot', { ...snap, errors: { orca: 'CLI down' } })
  assert.ok(view.find({ text: 'CLI down' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
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
  const { view, navigated } = await withGate(s)
  await view.select({ role: 'tablist' }, 'overview')
  assert.ok(view.find({ text: 'You' }))
  assert.ok(view.find({ text: '1 waiting on you' }))
  // Collapsed, the card shows what the bot is doing now; opened, everything.
  assert.ok(view.find({ text: 'Doing now: Build login' }))
  assert.equal(view.find({ text: 'Last said: Opened the PR.' }), null)
  await view.toggle({ testId: 'overview:Helper' })
  assert.ok(view.find({ text: 'Last said: Opened the PR.' }))
  assert.ok(view.find({ role: 'list', label: 'Helper workers' }))
  await view.press({ role: 'button', text: 'Login worker' })
  assert.deepEqual(navigated, [{ worktreeId: 'r1::/a', address: 'structworker_a' }])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a gate option asks for confirmation first; Cancel sends nothing; Confirm sends it once', async () => {
  const { view, sent } = await withGate({ ...snap, needsYou: [gate] })
  await view.press({ role: 'button', text: 'deploy' })
  assert.ok(view.find({ text: "Send 'deploy' to the coordinator?" }))
  assert.deepEqual(sent, [])
  await view.press({ role: 'button', text: 'Cancel' })
  assert.equal(view.find({ text: "Send 'deploy' to the coordinator?" }), null)
  assert.deepEqual(sent, [])

  await view.press({ role: 'button', text: 'wait' })
  await view.press({ role: 'button', text: 'Confirm' })
  assert.deepEqual(sent, [{ gateId: 'g1', resolution: 'wait' }])
  assert.ok(view.find({ text: "Sent 'wait'." }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a typed gate answer also needs confirming, and a refusal shows inline', async () => {
  const { view, sent } = await withGate({ ...snap, needsYou: [gate] }, () => ({ ok: false, error: 'gate already resolved' }))
  await view.type({ label: 'Answer: Ship it' }, '  after lunch  ')
  await view.press({ role: 'button', text: 'Send' })
  assert.deepEqual(sent, [])
  await view.press({ role: 'button', text: 'Confirm' })
  assert.deepEqual(sent, [{ gateId: 'g1', resolution: 'after lunch' }])
  assert.ok(view.find({ text: 'Not sent: gate already resolved' }))
  await view.unmount()
})

test('with answering turned off, a gate shows its options as labels and nothing can be sent', async () => {
  const { view, sent } = await withGate({ ...snap, allowAnswer: false, needsYou: [gate] })
  assert.ok(view.find({ text: 'deploy' }))
  assert.equal(view.findAll({ role: 'button' }).filter((b) => /deploy|wait|Send|Confirm/.test(b.text ?? '')).length, 0)
  assert.deepEqual(sent, [])
  await view.unmount()
})

test("a bot item shows its options as text and one honest button to its bot's chats; nothing is sent", async () => {
  const item = { ...snap.needsYou[0], worktreeId: 'f::/bots', address: 'orca_session_id:bot-chat-1', chat: 'Planning' }
  const { view, sent, navigated } = await withGate({ ...snap, needsYou: [item] })
  // The options are plain text, not buttons that would claim to answer.
  assert.ok(view.find({ text: 'no' }))
  assert.equal(view.findAll({ role: 'button' }).filter((b) => /^(no|yes)/.test(b.text ?? '')).length, 0)
  const open = view.find({ role: 'button', text: 'Open chat to answer' })
  assert.ok(open)
  const tip = JSON.stringify(open)
  assert.match(tip, /the 'Planning' chat/)
  assert.ok(!tip.includes('Answer in'))
  await view.press({ role: 'button', text: 'Open chat to answer' })
  assert.deepEqual(navigated, [{ worktreeId: 'f::/bots', address: 'orca_session_id:bot-chat-1' }])
  assert.deepEqual(sent, [])
  await view.unmount()
})

test("a bot item whose chat Orca doesn't show keeps its options as text and has no button", async () => {
  const { view } = await withGate({ ...snap, needsYou: [snap.needsYou[0]] })
  assert.ok(view.find({ text: 'no' }))
  assert.equal(view.find({ role: 'button', text: 'Open chat to answer' }), null)
  await view.unmount()
})

test('a Product:Name site shows with its product on Ship; an unknown product stays under Sites', async () => {
  const row = { url: 'https://x.example.com/', state: 'up' as const, status: 200, ms: 5, error: null, since: 1, was: null }
  const host = mockHost({
    requests: {
      'snapshot.get': () => ({
        ...snap,
        siteErrors: [],
        projects: ['Alpha', 'Beta'],
        sites: [
          { ...row, product: 'alpha', name: 'Docs' },
          { ...row, product: 'Beta', name: 'Status' },
          { ...row, product: 'Nope', name: 'Blog' }
        ]
      })
    }
  })
  const view = await mount(panel, { host, persisted: { plugin: { collapsed: { 'ship:Alpha': false, 'ship:Beta': false, 'ship:Sites': false } } } })
  await view.select({ role: 'tablist' }, 'ship')
  assert.ok(view.find({ role: 'list', label: 'Alpha sites' }))
  // Beta has no GitHub repo here, so it gets a card of its own.
  assert.ok(view.find({ role: 'list', label: 'Beta sites' }))
  assert.ok(view.find({ role: 'list', label: 'Sites' }))
  assert.ok(view.find({ label: 'Blog' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a snapshot persisted by an older version (no flows, no sites) draws every tab', async () => {
  const { flows, sites, sitesAt, siteErrors, ...old } = snap
  void [flows, sites, sitesAt, siteErrors]
  // The restarted worker cannot answer yet, so only the persisted snapshot is drawn.
  const host = mockHost({ requests: { 'snapshot.get': () => Promise.reject(new Error('worker starting')) } })
  const view = await mount(panel, { host, persisted: { plugin: { snapshot: old, collapsed: { 'ship:Alpha': false } } } })
  for (const t of ['overview', 'queue', 'office', 'flows', 'ship']) await view.select({ role: 'tablist' }, t)
  assert.ok(view.find({ text: 'acme/alpha · no open pull requests' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a persisted snapshot that is not an object is discarded', async () => {
  const host = mockHost({ requests: { 'snapshot.get': () => Promise.reject(new Error('worker starting')) } })
  const view = await mount(panel, { host, persisted: { plugin: { snapshot: 'garbage' } } })
  assert.ok(view.find({ label: 'Reading Orca' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

const groupOf = (view: Awaited<ReturnType<typeof mount>>, id: string) => view.find({ testId: id })?.props as { open: boolean; description: string }

test('groups start collapsed; one expands and collapses, and the state is persisted per tab', async () => {
  const host = mockHost({ requests: { 'snapshot.get': () => snap } })
  const view = await mount(panel, { host })
  await view.select({ role: 'tablist' }, 'office')
  assert.equal(groupOf(view, 'office:Alpha').open, false)
  // Collapsed, the header keeps its summary.
  assert.equal(groupOf(view, 'office:Alpha').description, '1 working')
  await view.toggle({ testId: 'office:Alpha' })
  assert.equal(groupOf(view, 'office:Alpha').open, true)
  assert.deepEqual(view.persisted.plugin.collapsed, { 'office:Alpha': false })
  // Another tab's group of the same product is its own.
  await view.select({ role: 'tablist' }, 'queue')
  assert.equal(groupOf(view, 'queue:Alpha').open, false)
  await view.select({ role: 'tablist' }, 'office')
  await view.toggle({ testId: 'office:Alpha' })
  assert.equal(groupOf(view, 'office:Alpha').open, false)
  assert.deepEqual(view.persisted.plugin.collapsed, {})
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a remembered collapsed group stays collapsed after a reload; one with something waiting on you is marked', async () => {
  const host = mockHost({ requests: { 'snapshot.get': () => snap } })
  const view = await mount(panel, { host, persisted: { plugin: { collapsed: { 'flows:Alpha': true, 'flows:Gone': true }, tab: stored('flows', 2) } } })
  assert.equal(groupOf(view, 'flows:Alpha').open, false)
  assert.equal(groupOf(view, 'flows:Alpha').description, '1 messages · 1 waiting on you')
  assert.ok(view.summary().some((l) => l.startsWith('Box warning "Alpha')))
  // Expanded, there is no marker: the rows show it themselves.
  await view.toggle({ testId: 'flows:Alpha' })
  assert.equal(groupOf(view, 'flows:Alpha').description, '1 messages')
  assert.ok(!view.summary().some((l) => l.startsWith('Box warning')))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a collapsed Ship card with a site down is marked red', async () => {
  const host = mockHost({ requests: { 'snapshot.get': () => ({ ...snap, sites: [{ ...snap.sites[0], product: 'Alpha' }] }) } })
  const view = await mount(panel, { host, persisted: { plugin: { collapsed: { 'ship:Alpha': true }, tab: stored('ship', 2) } } })
  assert.equal(groupOf(view, 'ship:Alpha').description, 'No runs · 0 open · 1 down')
  assert.ok(view.summary().some((l) => l.startsWith('Box danger "Alpha')))
  await view.unmount()
})

test('collapsed state an older or broken version stored is ignored', async () => {
  const host = mockHost({ requests: { 'snapshot.get': () => snap } })
  const view = await mount(panel, { host, persisted: { plugin: { collapsed: ['office:Alpha'], tab: stored('office', 2) } } })
  // Read as nothing remembered: the default, collapsed.
  assert.equal(groupOf(view, 'office:Alpha').open, false)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

const agent = (key: string, state: 'working' | 'waiting' | 'errored' | 'idle') => ({ ...snap.office[0].items[0], key, title: `Agent ${key}`, state })

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
        latestRun: { name: 'CI', result: 'pass', url: 'u', at: 1 },
        error: null,
        prs: [
          { number: 1, title: 'Red one', url: 'u1', draft: false, checks: 'fail', review: 'none' },
          { number: 2, title: 'Green one', url: 'u2', draft: false, checks: 'pass', review: 'approved' }
        ]
      }
    ],
    sites: [],
    siteErrors: []
  }
  const host = mockHost({ requests: { 'snapshot.get': () => s } })
  const view = await mount(panel, { host, persisted: { plugin: { tab: stored('office', 2) } } })
  assert.ok(view.find({ label: 'Agent a' }))
  assert.ok(view.find({ label: 'Agent b' }))
  assert.equal(view.find({ label: 'Agent c' }), null)
  assert.equal(groupOf(view, 'office:Alpha').description, '1 working · 1 errored · 2 idle · 1 errored · +2 more')
  await view.toggle({ testId: 'office:Alpha' })
  assert.ok(view.find({ label: 'Agent c' }))
  assert.ok(view.find({ label: 'Agent d' }))
  assert.equal(groupOf(view, 'office:Alpha').description, '1 working · 1 errored · 2 idle')

  await view.select({ role: 'tablist' }, 'queue')
  assert.ok(view.find({ label: 'Build it' }))
  assert.equal(view.find({ label: 'Plan it' }), null)
  assert.equal(groupOf(view, 'queue:Alpha').description, '2 open · +1 more')

  await view.select({ role: 'tablist' }, 'flows')
  assert.ok(view.find({ label: 'Fresh note' }))
  assert.equal(view.find({ label: 'Old note' }), null)

  await view.select({ role: 'tablist' }, 'ship')
  assert.ok(view.find({ label: '#1 Red one' }))
  assert.equal(view.find({ label: '#2 Green one' }), null)
  // The passing run and the green PR are left out.
  assert.equal(groupOf(view, 'ship:Alpha').description, 'CI passed · 2 open · 1 PR failing · +2 more')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('collapsed with nothing running, a group shows only its header and summary', async () => {
  const s: Snapshot = { ...snap, office: [{ product: 'Alpha', items: [agent('c', 'idle'), agent('d', 'idle')] }] }
  const host = mockHost({ requests: { 'snapshot.get': () => s } })
  const view = await mount(panel, { host, persisted: { plugin: { tab: stored('office', 2) } } })
  assert.equal(view.find({ role: 'list', label: 'Alpha' }), null)
  assert.equal(groupOf(view, 'office:Alpha').description, '2 idle · +2 more')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a group the user expanded before stays expanded after a reload', async () => {
  const s: Snapshot = { ...snap, office: [{ product: 'Alpha', items: [agent('c', 'idle')] }] }
  const host = mockHost({ requests: { 'snapshot.get': () => s } })
  const view = await mount(panel, { host, persisted: { plugin: { tab: stored('office', 2), collapsed: { 'office:Alpha': false } } } })
  assert.equal(groupOf(view, 'office:Alpha').open, true)
  assert.ok(view.find({ label: 'Agent c' }))
  assert.equal(groupOf(view, 'office:Alpha').description, '1 idle')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('opens on the Dashboard; a key shows the rows behind it in place, and ← Dashboard goes back', async () => {
  const navigated: unknown[] = []
  const host = mockHost({ requests: { 'snapshot.get': () => snap, navigate: (input) => (navigated.push(input), { ok: true }) } })
  const view = await mount(panel, { host })
  assert.ok(view.summary().includes('Tabs "View": "Dashboard" selected'))
  assert.ok(view.find({ role: 'button', text: '1 Needs you' }))
  assert.equal(view.find({ label: 'Fix login' }), null)

  // A product key: its agents, items, PRs and sites, with the same rows (and actions) as the other tabs.
  await view.press({ role: 'button', text: 'Alpha' })
  assert.ok(view.find({ role: 'button', text: '← Dashboard' }))
  assert.equal(view.find({ role: 'button', text: '1 Needs you' }), null)
  assert.ok(view.find({ text: 'Merge now?' }))
  assert.ok(view.find({ label: 'Build it' }))
  assert.ok(view.find({ text: 'acme/alpha' }))
  await view.press({ label: 'Fix login' })
  assert.deepEqual(navigated, [{ worktreeId: 'r1::/w', address: 'term_1' }])

  await view.press({ role: 'button', text: '← Dashboard' })
  assert.ok(view.find({ role: 'button', text: '1 Needs you' }))
  assert.equal(view.find({ label: 'Fix login' }), null)

  // A total: the matching rows from every product.
  await view.press({ role: 'button', text: '1 Sites down' })
  assert.ok(view.find({ text: 'HTTP 503 · 42 ms' }))
  assert.equal(view.find({ label: 'Fix login' }), null)
  // A key whose rows went away says so instead of showing stale rows.
  await view.post('snapshot', { ...snap, sites: [] })
  assert.ok(view.find({ text: 'Nothing behind this key right now.' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('a gate answered from a Dashboard detail still needs the confirm', async () => {
  const { view, sent } = await withGate({ ...snap, needsYou: [gate] })
  await view.select({ role: 'tablist' }, 'dashboard')
  await view.press({ role: 'button', text: '1 Needs you' })
  await view.press({ role: 'button', text: 'deploy' })
  assert.deepEqual(sent, [])
  await view.press({ role: 'button', text: 'Confirm' })
  assert.deepEqual(sent, [{ gateId: 'g1', resolution: 'deploy' }])
  await view.unmount()
})

test('a tab remembered before 0.8.0 opens on the Dashboard once; a tab chosen since is remembered', async () => {
  const host = () => mockHost({ requests: { 'snapshot.get': () => snap } })
  let view = await mount(panel, { host: host(), persisted: { plugin: { tab: stored('office', 1) } } })
  assert.ok(view.summary().includes('Tabs "View": "Dashboard" selected'))
  await view.select({ role: 'tablist' }, 'ship')
  assert.equal(view.persisted.plugin.tab, 'ship')
  await view.unmount()
  // What 0.8.0 itself stored is kept.
  view = await mount(panel, { host: host(), persisted: { plugin: { tab: stored('ship', 2) } } })
  assert.ok(view.summary().includes('Tabs "View": "Ship" selected'), String(view.summary()))
  await view.unmount()
})
