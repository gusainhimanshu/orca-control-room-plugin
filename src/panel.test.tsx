// The panel draws a snapshot and rows only navigate.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import { emptySnapshot, type Snapshot } from './protocol'

const snap: Snapshot = {
  ...emptySnapshot(),
  orcaAt: Date.now(),
  ghAt: Date.now(),
  needsYou: [
    { key: 'gate:g1', kind: 'gate', product: 'Alpha', title: 'Review it', question: 'Merge now?', options: ['yes', 'no'], since: 1, worktreeId: null, address: null }
  ],
  open: [{ product: 'Alpha', items: [{ key: 'task:t1', title: 'Build it', status: 'dispatched', run: 'Ship alpha' }] }],
  office: [
    {
      product: 'Alpha',
      items: [{ key: 'p1', title: 'Fix login', agent: 'claude', workspace: 'main', state: 'working', since: 1, detail: '', worktreeId: 'r1::/w', address: 'term_1' }]
    }
  ],
  ship: [{ product: 'Alpha', repo: 'acme/alpha', prs: [], latestRun: null, error: null }]
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
  assert.ok(view.find({ text: 'Merge now?' }))
  assert.ok(view.find({ label: 'Build it' }))

  await view.select({ role: 'tablist' }, 'office')
  await view.press({ label: 'Fix login' })
  assert.deepEqual(navigated, [{ worktreeId: 'r1::/w', address: 'term_1' }])

  await view.select({ role: 'tablist' }, 'ship')
  assert.ok(view.find({ text: 'acme/alpha · no open pull requests' }))

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
