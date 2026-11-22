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
