// The panel draws a snapshot and rows only navigate.
import { assert, mockHost, mount, test } from 'orca/testing'
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
        { key: 'm1', from: 'Paint the door', to: 'coordinator', type: 'question', subject: 'Which colour?', line: 'Red or blue?', waiting: true, worktreeId: 'r1::/w', address: 'structworker_1' }
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
  const view = await mount(panel, { host })
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
  assert.ok(view.find({ text: 'Last said: Opened the PR.' }))
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

test("a bot item's options open the bot's chat and never send an answer", async () => {
  const item = { ...snap.needsYou[0], worktreeId: 'f::/bots', address: 'orca_session_id:bot-chat-1' }
  const { view, sent, navigated } = await withGate({ ...snap, needsYou: [item] })
  await view.press({ role: 'button', text: 'no' })
  assert.deepEqual(navigated, [{ worktreeId: 'f::/bots', address: 'orca_session_id:bot-chat-1' }])
  assert.equal(view.find({ text: "Send 'no' to the coordinator?" }), null)
  assert.deepEqual(sent, [])
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
  const view = await mount(panel, { host })
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
  const view = await mount(panel, { host, persisted: { plugin: { snapshot: old } } })
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
