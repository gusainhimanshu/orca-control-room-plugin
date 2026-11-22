// Overview: invented bots, workers and pull requests.
import { assert, test } from 'orca/testing'
import type { AgentRow, Group } from './model'
import { buildOverview, layoutOverview, prTone, type OverviewBot } from './overview'

const agent = (address: string, state: AgentRow['state'], detail = ''): AgentRow => ({
  key: address,
  title: 'a',
  agent: 'claude',
  workspace: 'w',
  state,
  since: 1,
  detail,
  worktreeId: `r1::/${address}`,
  address
})
const office: Group<AgentRow>[] = [
  { product: 'Alpha', items: [agent('orca_session_id:bot-chat-1', 'working', 'On it.'), agent('structworker_a', 'working'), agent('structworker_b', 'waiting')] }
]

test('bots hand work to the workers their items link and mail; PRs hang off the worker that made them', () => {
  const bots = buildOverview({
    office,
    taskTitles: new Map([['task_c', 'Mailed task']]),
    workers: [
      { dispatchId: 'ctx_a', workspace: 'r1::/structworker_a', terminal: 'structworker_a' },
      { dispatchId: 'ctx_b', workspace: 'r1::/structworker_b', terminal: 'structworker_b' },
      { dispatchId: 'ctx_c', taskId: 'task_c', workspace: 'r1::/c' }
    ],
    messages: [
      { id: 'm2', from: 'orca_session_id:bot-chat-1', to: 'dispatch:ctx_c', subject: 'Go', body: 'Please start\nmore' },
      { id: 'm1', from: 'structworker_a', to: 'orca_session_id:bot-chat-1', subject: 'Done' }
    ],
    items: [
      {
        bot: 'Helper',
        items: [
          {
            uid: 'i1',
            title: 'Build login',
            status: 'in_progress',
            chat: { id: 'bot-chat-1' },
            links: [
              { kind: 'dispatch', ref: 'ctx_old', latest: 'ctx_a', title: 'Login worker', state: 'running' },
              { kind: 'pr', ref: 'acme/alpha#7', pr: { ref: 'acme/alpha#7', url: 'https://example.com/pr/7', state: 'open', checks: 'success', title: 'Add login' } }
            ]
          },
          { uid: 'i2', title: 'Pick a colour', status: 'needs_you', chat: { id: 'bot-chat-1' }, links: [{ kind: 'dispatch', ref: 'ctx_b', title: 'Paint worker' }] },
          { uid: 'i3', title: 'Loose PR', status: 'planned', links: [{ kind: 'pr', ref: 'acme/alpha#9' }] },
          { uid: 'i4', title: 'Old', status: 'done', links: [{ kind: 'dispatch', ref: 'ctx_gone' }] }
        ]
      },
      { bot: 'Quiet', items: [] }
    ]
  })
  const [helper, quiet] = bots
  assert.deepEqual(
    [helper.doing, helper.open, helper.needsYou, helper.lastSaid, helper.worktreeId],
    ['Build login', 3, 1, 'On it.', 'r1::/orca_session_id:bot-chat-1']
  )
  assert.deepEqual(
    helper.workers.map((w) => [w.key, w.label, w.state, w.prs.map((p) => p.ref)]),
    [
      ['ctx_a', 'Login worker', 'working', ['acme/alpha#7']],
      ['ctx_b', 'Paint worker', 'waiting', []],
      // Started by mail, not by a link; its task title names it.
      ['ctx_c', 'Mailed task', 'idle', []]
    ]
  )
  assert.deepEqual(helper.prs.map((p) => p.ref), ['acme/alpha#9'])
  assert.deepEqual([quiet.doing, quiet.workers, quiet.lastSaid], ['Nothing open', [], ''])
})

test("a bot whose chat Orca does not show says what it last mailed", () => {
  const [b] = buildOverview({
    office: [],
    taskTitles: new Map(),
    workers: [],
    messages: [{ id: 'm', from: 'orca_session_id:bot-chat-9', to: 'run:r', subject: 'Status', body: '' }],
    items: [{ bot: 'Far', items: [{ uid: 'i', title: 'Ask', status: 'needs_you', chat: { id: 'bot-chat-9' } }] }]
  })
  assert.deepEqual([b.doing, b.lastSaid, b.worktreeId], ['Waiting on you: Ask', 'Status', null])
})

const pr = (ref: string, checks = '', state = 'open') => ({ ref, title: '', url: null, state, checks })

test('PR tone: the link says first, then the Ship board; merged ones are neutral', () => {
  const ship = [{ product: 'A', repo: 'acme/alpha', error: null, latestRun: null, prs: [{ number: 3, title: '', url: '', draft: false, checks: 'fail' as const, review: 'none' as const }] }]
  assert.equal(prTone(pr('acme/alpha#1', 'success'), ship).tone, 'success')
  assert.equal(prTone(pr('acme/alpha#1', 'pending'), ship).tone, 'warning')
  assert.equal(prTone(pr('Acme/Alpha#3'), ship).tone, 'danger')
  assert.equal(prTone(pr('acme/alpha#4'), ship).tone, 'neutral')
  assert.deepEqual(prTone(pr('acme/alpha#1', 'failure', 'merged'), ship), { tone: 'neutral', word: 'merged' })
})

test('layout: owner on top, then each bot, its workers and their PRs, one row each; amber edges wait on you', () => {
  const bots: OverviewBot[] = [
    {
      name: 'Helper',
      doing: '',
      open: 2,
      needsYou: 1,
      lastSaid: '',
      worktreeId: 'r1::/bot',
      address: 'orca_session_id:bot-chat-1',
      workers: [
        { key: 'ctx_a', label: 'Login', state: 'working', worktreeId: 'r1::/a', address: 'structworker_a', prs: [{ ...pr('acme/alpha#7', 'success'), url: 'https://example.com/pr/7' }] },
        { key: 'ctx_b', label: 'Paint', state: 'waiting', worktreeId: null, address: null, prs: [] }
      ],
      prs: [pr('acme/alpha#9')]
    },
    { name: 'Quiet', doing: '', open: 0, needsYou: 0, lastSaid: '', worktreeId: null, address: null, workers: [], prs: [] }
  ]
  const { nodes, edges } = layoutOverview(bots, [])
  assert.deepEqual(
    nodes.map((n) => [n.row, n.tier, n.kind, n.label, n.tone, n.waiting]),
    [
      [0, 0, 'owner', 'You', 'warning', true],
      [1, 1, 'bot', 'Helper', 'warning', true],
      [2, 2, 'worker', 'Login', 'accent', false],
      [3, 3, 'pr', 'acme/alpha#7', 'success', false],
      [4, 2, 'worker', 'Paint', 'warning', true],
      [5, 2, 'pr', 'acme/alpha#9', 'neutral', false],
      [6, 1, 'bot', 'Quiet', 'neutral', false]
    ]
  )
  assert.deepEqual(
    edges.map((e) => `${e.from} -> ${e.to}${e.waiting ? ' (waiting)' : ''}`),
    [
      'owner -> bot:Helper (waiting)',
      'bot:Helper -> worker:Helper:ctx_a',
      'worker:Helper:ctx_a -> pr:worker:Helper:ctx_a:acme/alpha#7',
      'bot:Helper -> worker:Helper:ctx_b (waiting)',
      'bot:Helper -> pr:bot:Helper:acme/alpha#9',
      'owner -> bot:Quiet'
    ]
  )
  assert.deepEqual(nodes[1].nav, { worktreeId: 'r1::/bot', address: 'orca_session_id:bot-chat-1' })
  assert.deepEqual(nodes[3].nav, { url: 'https://example.com/pr/7' })
  assert.equal(nodes[4].nav, null)
  assert.deepEqual(layoutOverview([], []).nodes.map((n) => [n.kind, n.waiting]), [['owner', false]])
})
