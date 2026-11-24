// Pure data -> view model, with invented data.
import { assert, test } from 'orca/testing'
import {
  lastActivity,
  alarmNotice,
  buildFlows,
  buildOffice,
  buildQueue,
  buildShipRow,
  checksState,
  FLOW_RECENT_MS,
  freshAlarms,
  fromFullInbox,
  githubRepos,
  productNames,
  resolveRefusal,
  reviewState,
  running,
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

test('queue: bot items first; Runs add gates and untracked tasks; waiting agents need you', () => {
  const office = buildOffice(worktrees, products)
  const q = buildQueue({
    products,
    repoProducts: new Map([['acme/alpha', 'Alpha']]),
    office,
    workers: [
      { taskId: 't1', dispatchId: 'ctx_t1', workspace: 'r1::/w/alpha' },
      { taskId: 't7', dispatchId: 'ctx_old', workspace: 'r2::/w/beta' }
    ],
    // As `orca bot item list --bot <name> --json` prints them (invented).
    items: [
      {
        bot: 'Helper',
        items: [
          {
            uid: 'i1',
            number: 3,
            title: 'Pick a database',
            status: 'needs_you',
            lastActivityAt: 5,
            question: {
              text: 'Which one?\nmore words',
              gist: 'Which database should we use?',
              decisions: [
                { question: 'Which database?', replies: [{ label: 'Postgres', recommended: true }, { label: 'SQLite', recommended: false }] },
                { question: 'Migrate now?', replies: [{ label: 'Yes' }, { label: 'Later' }] }
              ]
            },
            links: [{ kind: 'pr', ref: 'acme/alpha#12', pr: { ref: 'acme/alpha#12' } }]
          },
          // Linked to Beta through a Dispatch whose latest worker ran there.
          { uid: 'i2', title: 'Write docs', status: 'in_progress', links: [{ kind: 'dispatch', ref: 'ctx_first', latest: 'ctx_old' }] },
          // Links nothing: takes the product the bot's other items work in (one Alpha, one Beta: first wins).
          { uid: 'i3', title: 'Plan release', status: 'planned' },
          { uid: 'i4', title: 'Shipped', status: 'done' }
        ]
      },
      { bot: 'Quiet', items: [{ uid: 'i5', title: 'Lonely', status: 'needs_you', updatedAt: 1 }] }
    ],
    runs: [
      {
        run: { id: 'run1', objective: 'Ship alpha' },
        tasks: [
          { id: 't1', status: 'dispatched', title: 'Build it', dispatchId: 'ctx_t1' },
          { id: 't2', status: 'pending', title: 'Review it' },
          { id: 't3', status: 'completed', title: 'Plan it' },
          // Already tracked by bot item i2 (same Dispatch): not repeated.
          { id: 't7', status: 'dispatched', title: 'Docs worker', dispatchId: 'ctx_old' }
        ],
        gates: [
          { id: 'g1', taskId: 't2', question: 'Merge now?', options: ['yes', 'no'], status: 'pending', createdAt: 10 },
          { id: 'g2', taskId: 't1', question: 'Old', status: 'resolved' }
        ]
      },
      { run: { id: 'run2', objective: 'Loose' }, tasks: [{ id: 't9', status: 'ready', title: 'Orphan' }], gates: [] }
    ]
  })
  assert.deepEqual(
    q.needsYou.map((n) => [n.kind, n.from, n.product, n.title, n.question]),
    [
      ['item', 'Quiet', 'Other', 'Lonely', ''],
      ['item', 'Helper', 'Alpha', 'Pick a database', 'Which database should we use?'],
      ['gate', null, 'Alpha', 'Review it', 'Merge now?'],
      ['agent', null, 'loose-folder', 'Agent', 'Waiting for your answer'],
      ['agent', null, 'Alpha', 'codex', 'Wants to use Bash']
    ]
  )
  assert.deepEqual(q.needsYou[1].decisions, [
    { prompt: 'Which database?', options: ['Postgres (recommended)', 'SQLite'] },
    { prompt: 'Migrate now?', options: ['Yes', 'Later'] }
  ])
  assert.deepEqual(q.needsYou[2].decisions, [{ prompt: '', options: ['yes', 'no'] }])
  assert.deepEqual(
    q.open.map((g) => [g.product, g.items.map((t) => `${t.title} (${t.status}, ${t.via})`)]),
    [
      ['Alpha', ['Plan release (planned, Helper)', 'Build it (dispatched, Ship alpha)', 'Review it (pending, Ship alpha)']],
      ['Beta', ['Write docs (in progress, Helper)']],
      ['Other', ['Orphan (ready, Loose)']]
    ]
  )
})

test("a needs-you item navigates to its bot's chat when Orca shows that chat as an agent", () => {
  const office = buildOffice(
    [{ worktreeId: 'f::/bots', repoId: 'f', agents: [{ paneKey: 'b1', address: 'orca_session_id:bot-chat-1', state: 'waiting' }] }],
    products
  )
  const q = buildQueue({
    products,
    repoProducts: new Map(),
    office,
    workers: [],
    runs: [],
    homes: new Map([['Helper', 'folder:home-h']]),
    items: [
      {
        bot: 'Helper',
        items: [
          { uid: 'i1', status: 'needs_you', chat: { id: 'bot-chat-1', title: 'Planning' } },
          { uid: 'i2', status: 'needs_you', chat: { id: 'bot-chat-gone' } }
        ]
      }
    ]
  })
  const byKey = new Map(q.needsYou.map((n) => [n.key, n]))
  assert.deepEqual([byKey.get('item:i1')?.worktreeId, byKey.get('item:i1')?.address], ['f::/bots', 'orca_session_id:bot-chat-1'])
  assert.deepEqual([byKey.get('item:i2')?.worktreeId, byKey.get('item:i2')?.address], [null, null])
  assert.deepEqual([byKey.get('item:i1')?.chat, byKey.get('item:i2')?.chat], ['Planning', null])
  // The asking bot's home rides along: "Open … to answer" prefers it.
  assert.deepEqual([byKey.get('item:i1')?.home, byKey.get('item:i2')?.home], ['folder:home-h', 'folder:home-h'])
})

test('a gate answer is refused unless allowed, still waiting, and sane text', () => {
  const gate = { key: 'gate:g1', kind: 'gate' as const, product: 'A', title: 'T', from: null, question: 'Q', decisions: [], since: null, worktreeId: null, address: null }
  const item = { ...gate, key: 'item:g2', kind: 'item' as const }
  assert.equal(resolveRefusal([gate], true, 'g1', 'yes'), null)
  assert.match(resolveRefusal([gate], false, 'g1', 'yes') ?? '', /turned off/)
  assert.match(resolveRefusal([gate], true, 'g9', 'yes') ?? '', /no longer waiting/)
  // An item's uid is never treated as a gate.
  assert.match(resolveRefusal([item], true, 'g2', 'yes') ?? '', /no longer waiting/)
  assert.match(resolveRefusal([gate], true, 'g1', '   ') ?? '', /Write an answer/)
  assert.match(resolveRefusal([gate], true, 'g1', 42) ?? '', /Write an answer/)
  assert.match(resolveRefusal([gate], true, 'g1', 'x'.repeat(2_001)) ?? '', /under 2000/)
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

test('flows: newest first by product, first body line only, open asks wait on you, workers navigate', () => {
  const workers = [
    { taskId: 'task_a', dispatchId: 'ctx_a', workspace: 'r1::/w/alpha', terminal: 'structworker_aaa' },
    { taskId: 'task_b', dispatchId: 'ctx_b', workspace: 'r2::/w/beta' }
  ]
  const long = 'x'.repeat(300)
  const flows = buildFlows(
    [
      { id: 'm1', type: 'question', from: 'structworker_aaa', to: 'run:run_1', subject: 'Which colour?', handled: false, body: 'Red or blue?\nSecret second line', payload: { taskId: 'task_a', dispatchId: 'ctx_a' }, createdAt: '2026-01-02T03:04:05Z' },
      { id: 'm2', type: 'status', from: 'orca_session_id:bot-group-member-1', to: 'dispatch:ctx_b', subject: 'Go ahead', handled: true, body: long },
      { id: 'm3', type: 'escalation', from: 'orca_session_id:abc', to: 'run:run_9', subject: 'Stuck', handled: true, body: 'Done\r\nnow' },
      { id: 'm4', type: 'worker_done', from: 'structworker_aaa', to: 'run:run_1', subject: 'Finished', handled: false, body: '' }
    ],
    workers,
    products,
    new Map([['task_a', 'Paint the door']])
  )
  assert.deepEqual(
    flows.map((g) => [g.product, g.items.map((f) => f.key)]),
    [
      ['Alpha', ['m1', 'm4']],
      ['Beta', ['m2']],
      ['Other', ['m3']]
    ]
  )
  const [m1, m4] = flows[0].items
  assert.deepEqual(m1, {
    key: 'm1',
    from: 'Paint the door',
    to: 'coordinator',
    type: 'question',
    subject: 'Which colour?',
    line: 'Red or blue?',
    waiting: true,
    at: Date.UTC(2026, 0, 2, 3, 4, 5),
    worktreeId: 'r1::/w/alpha',
    address: 'structworker_aaa'
  })
  assert.equal(m4.at, 0) // no send time known
  assert.equal(m4.waiting, false) // only questions and escalations wait on you
  const m2 = flows[1].items[0]
  assert.deepEqual([m2.from, m2.to, m2.worktreeId, m2.address, m2.line.length], ['bot', 'worker', 'r2::/w/beta', null, 120])
  const m3 = flows[2].items[0]
  assert.deepEqual([m3.from, m3.waiting, m3.line, m3.worktreeId], ['agent', false, 'Done', null])
})

test('a full inbox row reads as the concise one, with its send time; a broken payload is dropped', () => {
  const row = { id: 'm1', type: 'question', from_handle: 'structworker_a', to_handle: 'run:run_1', subject: 'Hm?', body: 'b', read: 0, payload: '{"taskId":"t1","dispatchId":"ctx_1","reportPath":"/x"}', created_at: '2026-01-02T03:04:05Z' }
  assert.deepEqual(fromFullInbox(row), {
    id: 'm1',
    type: 'question',
    from: 'structworker_a',
    to: 'run:run_1',
    subject: 'Hm?',
    handled: false,
    body: 'b',
    payload: { taskId: 't1', dispatchId: 'ctx_1' },
    createdAt: '2026-01-02T03:04:05Z'
  })
  assert.deepEqual([fromFullInbox({ ...row, read: 1 }).handled, fromFullInbox({ ...row, payload: '{oops' }).payload], [true, null])
})

test('running: what a collapsed group still shows', () => {
  assert.deepEqual((['working', 'waiting', 'errored', 'idle'] as const).map((state) => running.agent({ state })), [true, true, true, false])
  assert.deepEqual(['in progress', 'dispatched', 'blocked', 'planned', 'pending', 'ready', 'idle'].map((status) => running.task({ status })), [true, true, true, false, false, false, false])
  assert.equal(running.pr({ checks: 'pending', review: 'approved' }), true)
  assert.equal(running.pr({ checks: 'fail', review: 'none' }), true)
  assert.equal(running.pr({ checks: 'pass', review: 'changes' }), true)
  assert.equal(running.pr({ checks: 'pass', review: 'required' }), false)
  const run = { name: 'CI', url: 'u', at: 1 }
  assert.deepEqual([running.run(null), running.run({ ...run, result: 'pass' }), running.run({ ...run, result: 'running' }), running.run({ ...run, result: 'fail' })], [false, false, true, true])
  assert.deepEqual(['up', 'degraded', 'down'].map((state) => running.site({ state })), [false, true, true])
  const now = 10 * FLOW_RECENT_MS
  assert.equal(running.flow({ waiting: true, at: 0 }, now), true)
  assert.equal(running.flow({ waiting: false, at: now - FLOW_RECENT_MS + 1 }, now), true)
  assert.equal(running.flow({ waiting: false, at: now - FLOW_RECENT_MS }, now), false)
  assert.equal(running.flow({ waiting: false, at: 0 }, now), false)
  assert.deepEqual(['working', 'waiting', 'errored', 'idle', 'done'].map((state) => running.worker({ state })), [false, true, true, false, false])
  assert.deepEqual(['Build login', 'Nothing open', ''].map((doing) => running.doing({ doing })), [true, false, false])
})

test('lastActivity: the newest workspace activity per product', () => {
  const products = new Map([['r1', 'Alpha']])
  assert.deepEqual(
    lastActivity([{ worktreeId: 'a', repoId: 'r1', lastActivityAt: 5 }, { worktreeId: 'b', repoId: 'r1', lastActivityAt: 9 }, { worktreeId: 'c', repo: 'Loose' }], products),
    { Alpha: 9 }
  )
})
