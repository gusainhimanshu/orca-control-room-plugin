// Pure data -> view model, with invented data.
import { assert, test } from 'orca/testing'
import {
  alarmNotice,
  buildOffice,
  buildQueue,
  buildShipRow,
  checksState,
  freshAlarms,
  githubRepos,
  productNames,
  reviewState,
  stuckAlarms,
  type RawWorktree
} from './model'

const repos = [
  { id: 'r1', displayName: 'Alpha', gitRemoteIdentity: { canonicalKey: 'github.com/acme/alpha' } },
  { id: 'r2', displayName: 'Beta', gitRemoteIdentity: { canonicalKey: 'gitlab.com/acme/beta' } },
  { id: 'r3', displayName: 'Gamma', gitRemoteIdentity: null }
]
const products = productNames(repos)

const worktrees: RawWorktree[] = [
  {
    worktreeId: 'r1::/w/alpha',
    repoId: 'r1',
    displayName: 'main',
    agents: [
      { paneKey: 'p1', address: 'term_1', state: 'working', agentType: 'claude', stateStartedAt: 1000, conversationName: 'Fix login' },
      { paneKey: 'p2', address: 'term_2', state: 'blocked', agentType: 'codex', stateStartedAt: 500, toolName: 'Bash' },
      { paneKey: 'p3', state: 'done', stateStartedAt: 1 } // no address: remembered only
    ]
  },
  {
    worktreeId: 'r2::/w/beta',
    repoId: 'r2',
    displayName: 'feature',
    agents: [
      { paneKey: 'p4', address: 'orca_session_id:s4', state: 'done', stateStartedAt: 200, taskTitle: 'Write docs', mainAgent: { outcome: 'failure' } },
      { paneKey: 'p5', address: 'term_5', state: 'done', stateStartedAt: 300, lastAssistantMessage: 'All done.\nMore text' }
    ]
  },
  { worktreeId: 'x::/w/loose', repoId: 'unknown', repo: 'loose-folder', agents: [{ paneKey: 'p6', address: 'term_6', state: 'waiting', stateStartedAt: 50 }] }
]

test('githubRepos keeps only github.com remotes', () => {
  assert.deepEqual(githubRepos(repos), [{ product: 'Alpha', repo: 'acme/alpha' }])
})

test('office groups addressed agents by product, waiting first', () => {
  const office = buildOffice(worktrees, products)
  assert.deepEqual(
    office.map((g) => [g.product, g.items.map((a) => `${a.key}:${a.state}`)]),
    [
      ['Alpha', ['p2:waiting', 'p1:working']],
      ['Beta', ['p4:errored', 'p5:idle']],
      ['loose-folder', ['p6:waiting']]
    ]
  )
  const alpha = office[0].items
  assert.equal(alpha[0].detail, 'Wants to use Bash')
  assert.equal(alpha[1].title, 'Fix login')
  assert.equal(office[1].items[1].detail, 'All done.')
})

test('queue: open gates and waiting agents need you; open tasks group by product', () => {
  const office = buildOffice(worktrees, products)
  const q = buildQueue(
    [
      {
        run: { id: 'run1', objective: 'Ship alpha' },
        tasks: [
          { id: 't1', status: 'dispatched', title: 'Build it' },
          { id: 't2', status: 'pending', title: 'Review it' },
          { id: 't3', status: 'completed', title: 'Plan it' }
        ],
        gates: [
          { id: 'g1', taskId: 't2', question: 'Merge now?', options: ['yes', 'no'], status: 'pending', createdAt: 10 },
          { id: 'g2', taskId: 't1', question: 'Old', status: 'resolved' }
        ]
      },
      { run: { id: 'run2', objective: 'Loose' }, tasks: [{ id: 't9', status: 'ready', title: 'Orphan' }], gates: [] }
    ],
    [{ taskId: 't1', workspace: 'r1::/w/alpha' }],
    products,
    office
  )
  assert.deepEqual(
    q.needsYou.map((n) => [n.kind, n.product, n.title, n.question, n.options.join('/')]),
    [
      ['gate', 'Alpha', 'Review it', 'Merge now?', 'yes/no'],
      ['agent', 'loose-folder', 'Agent', 'Waiting for your answer', ''],
      ['agent', 'Alpha', 'codex', 'Wants to use Bash', '']
    ]
  )
  // t2 has no worker but its Run's other task maps to Alpha; t9 maps nowhere.
  assert.deepEqual(
    q.open.map((g) => [g.product, g.items.map((t) => t.title)]),
    [
      ['Alpha', ['Build it', 'Review it']],
      ['Other', ['Orphan']]
    ]
  )
})

test('checks and review states', () => {
  assert.equal(checksState(null), 'none')
  assert.equal(checksState([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { state: 'SUCCESS' }]), 'pass')
  assert.equal(checksState([{ status: 'IN_PROGRESS' }, { status: 'COMPLETED', conclusion: 'SUCCESS' }]), 'pending')
  assert.equal(checksState([{ status: 'IN_PROGRESS' }, { status: 'COMPLETED', conclusion: 'FAILURE' }]), 'fail')
  assert.equal(checksState([{ state: 'PENDING' }]), 'pending')
  assert.equal(checksState([{ state: 'ERROR' }]), 'fail')
  assert.equal(reviewState('APPROVED'), 'approved')
  assert.equal(reviewState('CHANGES_REQUESTED'), 'changes')
  assert.equal(reviewState('REVIEW_REQUIRED'), 'required')
  assert.equal(reviewState(''), 'none')
})

test('ship row reads PRs and the latest run', () => {
  const row = buildShipRow(
    'Alpha',
    'acme/alpha',
    [{ number: 7, title: 'Add thing', url: 'u', isDraft: true, reviewDecision: 'APPROVED', statusCheckRollup: [] }],
    [{ status: 'completed', conclusion: 'failure', workflowName: 'CI', url: 'r', createdAt: '2026-01-01T00:00:00Z' }],
    null
  )
  assert.deepEqual(row.prs, [{ number: 7, title: 'Add thing', url: 'u', draft: true, checks: 'none', review: 'approved' }])
  assert.deepEqual(row.latestRun, { name: 'CI', result: 'fail', url: 'r', at: Date.parse('2026-01-01T00:00:00Z') })
  assert.equal(buildShipRow('A', 'a/b', null, [{ status: 'in_progress' }], null).latestRun?.result, 'running')
  assert.equal(buildShipRow('A', 'a/b', null, null, 'gh failed').error, 'gh failed')
})

test('stuck alarms fire once per event', () => {
  const office = buildOffice(worktrees, products)
  const min = 60_000
  // now - 500 >= 1 minute for every agent here; the working one never alarms.
  const all = stuckAlarms(office, 500 + min, 1)
  assert.deepEqual(all.map((a) => a.key).sort(), ['p2:waiting:500', 'p4:errored:200', 'p5:idle:300', 'p6:waiting:50'])
  // Below threshold only the errored agent alarms.
  assert.deepEqual(stuckAlarms(office, 600, 15).map((a) => a.key), ['p4:errored:200'])

  const first = freshAlarms(all, [])
  assert.equal(first.fresh.length, 4)
  const second = freshAlarms(all, first.remember)
  assert.equal(second.fresh.length, 0)
  // An agent that moved on drops out of memory; a new state is a new event.
  const later = freshAlarms([{ key: 'p2:waiting:900', text: 'x' }], second.remember)
  assert.deepEqual(later.fresh.map((a) => a.key), ['p2:waiting:900'])
  assert.deepEqual(later.remember, ['p2:waiting:900'])
})

test('alarm notice summarises many', () => {
  assert.equal(alarmNotice([]), null)
  assert.deepEqual(alarmNotice([{ key: 'a', text: 'A is idle' }]), { title: 'Agent needs a look', body: 'A is idle' })
  const many = Array.from({ length: 6 }, (_, i) => ({ key: `${i}`, text: `T${i}` }))
  assert.deepEqual(alarmNotice(many), { title: '6 agents need a look', body: 'T0\nT1\nT2\nT3\nand 2 more' })
})
