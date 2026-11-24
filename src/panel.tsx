// Control room. Rows navigate Orca (focus a terminal or show a workspace). The one write: a decision
// gate waiting on you can be answered, and only after an inline confirm. Nothing here answers a bot,
// types into a terminal or grants a permission.
import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  Collapsible,
  EmptyState,
  Heading,
  Input,
  List,
  ListItem,
  plugin,
  read,
  RelativeTime,
  Row,
  set,
  shell,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  Text,
  update,
  type OrcaNode,
  type PanelContext,
  type Tone
} from 'orca'
import { MAX_RESOLUTION, running, type AgentRow, type AgentState, type Checks, type FlowRow, type Group, type NeedRow, type PrRow, type Review, type ShipRow, type TaskRow } from './model'
import { layoutOverview, type OverviewEdge, type OverviewBot, type OverviewNode, type OverviewWorker } from './overview'
import { asSnapshot, emptySnapshot, type Snapshot } from './protocol'
import { siteGroup, type SiteRow, type SiteState } from './sites'

// Persisted so a reopened panel shows the last reading at once while a restarted worker reads again.
const snapshot = atom<Snapshot>('snapshot', emptySnapshot(), { persist: 'plugin' })
const tab = atom('tab', 'overview', { persist: 'plugin' })
// Groups the user opened (false) or closed (true) as 'tab:product'; absent means collapsed, the default
// since 0.6.0 (0.5.0 stored only `true`, which reads the same). Stale products are just ignored.
const collapsed = atom<Record<string, boolean>>('collapsed', {}, { persist: 'plugin' })
const asCollapsed = (v: unknown): Record<string, boolean> =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'boolean')) : {}

// Answering a gate: what is typed per gate, the answer awaiting confirmation, and how sending went.
const drafts = atom<Record<string, string>>({})
const pending = atom<{ key: string; text: string } | null>(null)
const sending = atom<string | null>(null)
const outcome = atom<Record<string, { ok: boolean; text: string }>>({})

const take = (s: Snapshot) => {
  // A worker that just started has read nothing yet; keep the last reading over its empty one.
  const last = read(snapshot)
  if (!(s.orcaAt || s.errors.orca || !last.orcaAt)) return
  // Same for GitHub and the sites, which are read less often.
  let next = s.ghAt || !last.ghAt ? s : { ...s, ghAt: last.ghAt, ship: last.ship, errors: { ...s.errors, ...(last.errors.gh ? { gh: last.errors.gh } : {}) } }
  if (!next.sitesAt && last.sitesAt) next = { ...next, sitesAt: last.sitesAt, sites: last.sites, siteErrors: last.siteErrors }
  set(snapshot, next)
}

export function setup(ctx: PanelContext): void {
  set(snapshot, asSnapshot(read(snapshot)))
  set(collapsed, asCollapsed(read(collapsed)))
  ctx.subscriptions.push(plugin.on('snapshot', take))
  void plugin.request('snapshot.get').then(take, () => undefined)
}

const go = (worktreeId: string | null, address: string | null) => () => {
  if (worktreeId) void plugin.request('navigate', { worktreeId, address }).catch(() => undefined)
}

const STATE: Record<AgentState, { label: string; tone: Tone }> = {
  waiting: { label: 'Waiting on you', tone: 'warning' },
  errored: { label: 'Errored', tone: 'danger' },
  working: { label: 'Working', tone: 'accent' },
  idle: { label: 'Idle', tone: 'neutral' }
}
const CHECKS: Record<Checks, { label: string; tone: Tone }> = {
  pass: { label: 'Checks pass', tone: 'success' },
  fail: { label: 'Checks fail', tone: 'danger' },
  pending: { label: 'Checks running', tone: 'warning' },
  none: { label: 'No checks', tone: 'neutral' }
}
const REVIEW: Record<Review, { label: string; tone: Tone }> = {
  approved: { label: 'Approved', tone: 'success' },
  changes: { label: 'Changes asked', tone: 'danger' },
  required: { label: 'Review needed', tone: 'warning' },
  none: { label: 'No review', tone: 'neutral' }
}

const SITE: Record<SiteState, { label: string; tone: Tone }> = {
  up: { label: 'Up', tone: 'success' },
  degraded: { label: 'Degraded', tone: 'warning' },
  down: { label: 'Down', tone: 'danger' }
}

function SourceError({ text }: { text?: string }) {
  return text ? (
    <Callout tone="warning" icon="warning">
      <Text size="xs">{text}</Text>
    </Callout>
  ) : null
}

type Alert = { tone: 'warning' | 'danger'; text: string } | null
/** The worse of two alerts. */
const worst = (...a: Alert[]): Alert => a.find((x) => x?.tone === 'danger') ?? a.find((x) => x) ?? null

type GroupProps = {
  tab: string
  name: string
  note: string
  alert?: Alert
  /** What a collapsed group still shows (only what is running); null shows the header alone. */
  preview?: OrcaNode
  /** Rows the preview leaves out, said as "+N more". */
  hidden?: number
  children?: OrcaNode
}

/** A product group, collapsed until the user opens it; collapsed, it is outlined amber/red when something inside waits or fails. */
function ProductGroup({ tab, name, note, alert, preview, hidden = 0, children }: GroupProps) {
  const key = `${tab}:${name}`
  const open = read(collapsed)[key] === false
  const marked = !open && alert
  const description = [note, marked ? alert.text : '', !open && hidden ? `+${hidden} more` : ''].filter(Boolean).join(' · ')
  return (
    // Keyed (testId) on the Collapsible; a component's root element loses its key.
    <Box border={marked ? alert.tone : false} radius="md">
      <Collapsible
        key={key}
        title={name}
        description={description}
        open={open}
        onChange={(o) => update(collapsed, ({ [key]: _old, ...rest }) => (o ? { ...rest, [key]: false } : rest))}
      >
        {children}
      </Collapsible>
      {!open && preview ? (
        <Box paddingX="sm" paddingY="xs">
          {preview}
        </Box>
      ) : null}
    </Box>
  )
}

/** A collapsed group's preview: `draw` over only the running rows, and how many it leaves out. */
function runningOnly<T>(rows: T[], keep: (r: T) => boolean, draw: (rows: T[]) => OrcaNode) {
  const shown = rows.filter(keep)
  return { preview: shown.length ? draw(shown) : null, hidden: rows.length - shown.length }
}

const gateId = (n: NeedRow) => n.key.slice('gate:'.length)
const plainLabel = (option: string) => option.replace(/ \(recommended\)$/, '')

/** Step 1: pick an option or type an answer; nothing is sent here. */
const ask = (key: string, text: string) => () => {
  if (!text.trim()) return
  set(pending, { key, text: text.trim() })
  update(outcome, ({ [key]: _old, ...rest }) => rest)
}

/** Step 2: the owner confirmed; send it once. */
const confirm = (n: NeedRow, text: string) => async () => {
  if (read(sending)) return
  set(sending, n.key)
  const r = await plugin.request('gate.resolve', { gateId: gateId(n), resolution: text }).catch((e: unknown) => ({
    ok: false,
    error: e instanceof Error ? e.message : String(e)
  }))
  set(pending, null)
  set(sending, null)
  update(outcome, (o) => ({ ...o, [n.key]: { ok: r.ok, text: r.ok ? `Sent '${text}'.` : `Not sent: ${r.error ?? 'unknown error'}` } }))
}

function GateAnswer({ n, options }: { n: NeedRow; options: string[] }) {
  const p = read(pending)
  const done = read(outcome)[n.key]
  if (p?.key === n.key)
    return (
      <Callout tone="warning" icon="flag">
        <Stack gap="xs">
          <Text size="sm">{`Send '${p.text}' to the coordinator?`}</Text>
          <Row gap="xs">
            <Button tone="accent" size="sm" disabled={read(sending) === n.key} onPress={confirm(n, p.text)}>
              Confirm
            </Button>
            <Button variant="ghost" size="sm" onPress={() => set(pending, null)}>
              Cancel
            </Button>
          </Row>
        </Stack>
      </Callout>
    )
  const draft = read(drafts)[n.key] ?? ''
  return (
    <Stack gap="xs">
      <Row gap="xs" wrap>
        {options.map((o) => (
          <Button size="sm" variant="outline" onPress={ask(n.key, plainLabel(o))}>
            {o}
          </Button>
        ))}
      </Row>
      <Row gap="xs" align="center">
        <Input
          label={`Answer: ${n.title}`}
          labelHidden
          placeholder="Or write a short answer"
          maxLength={MAX_RESOLUTION}
          value={draft}
          onChange={(v) => update(drafts, (d) => ({ ...d, [n.key]: v }))}
          onSubmit={(v) => ask(n.key, v)()}
        />
        <Button size="sm" disabled={!draft.trim()} onPress={ask(n.key, draft)}>
          Send
        </Button>
      </Row>
      {done ? (
        <Text size="xs" tone={done.ok ? 'success' : 'danger'}>
          {done.text}
        </Text>
      ) : null}
    </Stack>
  )
}

/** A bot item's options, as text: Orca has no way to answer an item for its owner from a plugin. */
function ItemOptions({ options }: { options: string[] }) {
  return (
    <Row gap="xs" wrap>
      {options.map((o) => (
        <Badge tone="neutral">{o}</Badge>
      ))}
    </Row>
  )
}

/** Orca can show the bot's workspace but not switch to one of its chats, so the tooltip names the chat to pick. */
const openChatTooltip = (n: NeedRow) =>
  `Opens ${n.from ?? 'the bot'}'s chats. Orca can't open one chat or answer for you from a panel: ` +
  `switch to ${n.chat ? `the '${n.chat}' chat` : 'the chat that owns this item'} and answer there.`

function NeedItem({ n, canAnswer }: { n: NeedRow; canAnswer: boolean }) {
  const answerable = n.kind === 'gate' && canAnswer
  const openChat = n.kind === 'item' && !!n.worktreeId
  // A pressable row cannot hold buttons.
  const optionButtons = answerable || openChat
  return (
    <ListItem
      title={n.title}
      icon={n.kind === 'agent' ? 'agent' : n.kind === 'gate' ? 'flag' : 'bot'}
      onPress={n.worktreeId && !optionButtons ? go(n.worktreeId, n.address) : undefined}
    >
      <Stack gap="xs">
        {n.question ? <Text size="sm">{n.question}</Text> : null}
        {n.decisions.map((d) => (
          <Stack gap="xs">
            {d.prompt && d.prompt !== n.question ? (
              <Text size="sm" weight="medium">
                {d.prompt}
              </Text>
            ) : null}
            {answerable ? null : <ItemOptions options={d.options} />}
          </Stack>
        ))}
        {/* A gate with no options still takes a typed answer. */}
        {answerable ? <GateAnswer n={n} options={n.decisions.flatMap((d) => d.options)} /> : null}
        {openChat ? (
          <Row>
            <Button size="sm" variant="outline" icon="open-external" tooltip={openChatTooltip(n)} onPress={go(n.worktreeId, n.address)}>
              Open chat to answer
            </Button>
          </Row>
        ) : null}
        <Row gap="xs" wrap>
          <Text size="xs" muted>
            {n.from ? `${n.from} · ${n.product}` : n.product}
          </Text>
          {n.since ? <RelativeTime at={n.since} muted /> : null}
        </Row>
      </Stack>
    </ListItem>
  )
}

function TaskList({ label, rows }: { label: string; rows: TaskRow[] }) {
  return (
    <List label={label}>
      {rows.map((t) => (
        <ListItem title={t.title} description={`${t.status} · ${t.via}`} icon="layers" />
      ))}
    </List>
  )
}

function Queue({ s }: { s: Snapshot }) {
  return (
    <Stack gap="md">
      <SourceError text={s.errors.bots} />
      <SourceError text={s.errors.runs} />
      <Heading level={3}>Needs you · {s.needsYou.length}</Heading>
      {s.needsYou.length ? (
        <List label="Needs you">
          {s.needsYou.map((n) => (
            <NeedItem n={n} canAnswer={s.allowAnswer} />
          ))}
        </List>
      ) : (
        <Text muted size="sm">
          Nothing is waiting on you.
        </Text>
      )}
      <Heading level={3}>Open work</Heading>
      {s.open.length ? (
        s.open.map((g: Group<TaskRow>) => (
          <ProductGroup tab="queue" name={g.product} note={`${g.items.length} open`} {...runningOnly(g.items, running.task, (rows) => <TaskList label={g.product} rows={rows} />)}>
            <TaskList label={g.product} rows={g.items} />
          </ProductGroup>
        ))
      ) : (
        <Text muted size="sm">
          No open items.
        </Text>
      )}
    </Stack>
  )
}

function FlowItem({ f }: { f: FlowRow }) {
  return (
    <ListItem title={f.subject || f.type} icon={f.waiting ? 'flag' : 'activity'} onPress={f.worktreeId ? go(f.worktreeId, f.address) : undefined}>
      <Stack gap="xs">
        <Row gap="xs" wrap align="center">
          {/* Same tone as the Queue's "waiting on you" state. */}
          {f.waiting ? <Badge tone="warning">Waiting on you</Badge> : null}
          <Badge tone="neutral">{f.type}</Badge>
          <Text size="xs" muted truncate>
            {`${f.from} → ${f.to}`}
          </Text>
        </Row>
        {f.line ? (
          <Text size="xs" muted truncate>
            {f.line}
          </Text>
        ) : null}
      </Stack>
    </ListItem>
  )
}

function FlowList({ label, rows }: { label: string; rows: FlowRow[] }) {
  return (
    <List label={label}>
      {rows.map((f) => (
        <FlowItem f={f} />
      ))}
    </List>
  )
}

function Flows({ s }: { s: Snapshot }) {
  return (
    <Stack gap="md">
      <SourceError text={s.errors.flows} />
      {s.flows.length ? (
        s.flows.map((g) => {
          const waiting = g.items.filter((f) => f.waiting).length
          return (
            <ProductGroup
              tab="flows"
              name={g.product}
              note={`${g.items.length} messages`}
              alert={waiting ? { tone: 'warning', text: `${waiting} waiting on you` } : null}
              {...runningOnly(g.items, (f) => running.flow(f, s.orcaAt), (rows) => <FlowList label={g.product} rows={rows} />)}
            >
              <FlowList label={g.product} rows={g.items} />
            </ProductGroup>
          )
        })
      ) : (
        <EmptyState title="No messages between agents yet" icon="activity" />
      )}
    </Stack>
  )
}

const NODE_ICON = { owner: 'star', bot: 'bot', worker: 'agent', pr: 'branch' } as const

function DiagramNode({ n, edge }: { n: OverviewNode; edge?: OverviewEdge }) {
  const nav = n.nav
  const press = !nav ? undefined : 'url' in nav ? () => void shell.openExternal(nav.url).catch(() => undefined) : go(nav.worktreeId, nav.address)
  return (
    <Row gap="xs" align="center">
      {/* Indent by tier; the hook shows the edge from the node above it, amber when it waits on you. */}
      {n.tier > 1 ? <Box width={(n.tier - 1) * 16} /> : null}
      {edge ? (
        <Text size="xs" tone={edge.waiting ? 'warning' : undefined} muted={!edge.waiting}>
          └
        </Text>
      ) : null}
      {press ? (
        <Button size="xs" variant="outline" tone={n.tone} icon={NODE_ICON[n.kind]} onPress={press}>
          {n.label}
        </Button>
      ) : (
        <Badge tone={n.tone}>{n.label}</Badge>
      )}
      {n.sub ? (
        <Text size="xs" tone={n.waiting ? 'warning' : undefined} muted={!n.waiting} truncate>
          {n.sub}
        </Text>
      ) : null}
    </Row>
  )
}

const WORKER: Record<OverviewWorker['state'], { label: string; tone: Tone }> = { ...STATE, done: { label: 'Done', tone: 'success' } }

function WorkerList({ label, rows }: { label: string; rows: OverviewWorker[] }) {
  return (
    <List label={label}>
      {rows.map((w) => (
        <ListItem title={w.label} icon="agent" onPress={w.worktreeId ? go(w.worktreeId, w.address) : undefined}>
          <Badge tone={WORKER[w.state].tone}>{WORKER[w.state].label}</Badge>
        </ListItem>
      ))}
    </List>
  )
}

/** A collapsed bot card: what it is doing now and the workers waiting on you or errored. */
function botPreview(b: OverviewBot) {
  const busy = b.workers.filter(running.worker)
  const doing = running.doing(b)
  return {
    preview:
      doing || busy.length ? (
        <Stack gap="xs">
          {doing ? <Text size="xs">{`Doing now: ${b.doing}`}</Text> : null}
          {busy.length ? <WorkerList label={`${b.name} workers`} rows={busy} /> : null}
        </Stack>
      ) : null,
    hidden: b.workers.length - busy.length
  }
}

function Overview({ s }: { s: Snapshot }) {
  if (!s.overview.length)
    return (
      <Stack gap="md">
        <SourceError text={s.errors.bots} />
        <EmptyState title="No bots yet" description="Bots, the workers they start and their pull requests show here." icon="bot" />
      </Stack>
    )
  const { nodes, edges } = layoutOverview(s.overview, s.ship)
  const into = new Map(edges.map((e) => [e.to, e]))
  return (
    <Stack gap="md">
      <SourceError text={s.errors.bots} />
      <Box border radius="md" padding="sm" maxHeight={480} scroll="y" gap="xs">
        {nodes.map((n) => (
          <DiagramNode n={n} edge={into.get(n.id)} />
        ))}
      </Box>
      {s.overview.map((b) => (
        <ProductGroup
          tab="overview"
          name={b.name}
          note={`${b.open} open`}
          alert={b.needsYou ? { tone: 'warning', text: `${b.needsYou} need you` } : null}
          {...botPreview(b)}
        >
          <Stack gap="xs">
            <Text size="xs">{`Doing now: ${b.doing}`}</Text>
            <Row gap="xs" wrap>
              <Badge tone={b.needsYou ? 'warning' : 'neutral'}>{b.needsYou ? `${b.open} open · ${b.needsYou} need you` : `${b.open} open`}</Badge>
              <Badge tone="neutral">{`${b.workers.length} worker${b.workers.length === 1 ? '' : 's'}`}</Badge>
            </Row>
            {b.lastSaid ? (
              <Text size="xs" muted truncate>
                {`Last said: ${b.lastSaid}`}
              </Text>
            ) : null}
            {b.workers.length ? <WorkerList label={`${b.name} workers`} rows={b.workers} /> : null}
          </Stack>
        </ProductGroup>
      ))}
    </Stack>
  )
}

function counts(items: AgentRow[]): string {
  const n = (st: AgentState) => items.filter((a) => a.state === st).length
  return (['working', 'waiting', 'errored', 'idle'] as const)
    .filter((st) => n(st))
    .map((st) => `${n(st)} ${STATE[st].label.toLowerCase()}`)
    .join(' · ')
}

function officeAlert(items: AgentRow[]): Alert {
  const n = (st: AgentState) => items.filter((a) => a.state === st).length
  return worst(
    n('errored') ? { tone: 'danger', text: `${n('errored')} errored` } : null,
    n('waiting') ? { tone: 'warning', text: `${n('waiting')} waiting on you` } : null
  )
}

function Office({ s }: { s: Snapshot }) {
  if (!s.office.length) return <EmptyState title="No agents running" icon="agent" />
  return (
    <Stack gap="md">
      {s.office.map((g) => (
        <ProductGroup
          tab="office"
          name={g.product}
          note={counts(g.items)}
          alert={officeAlert(g.items)}
          {...runningOnly(g.items, running.agent, (rows) => <AgentList label={g.product} rows={rows} />)}
        >
          <AgentList label={g.product} rows={g.items} />
        </ProductGroup>
      ))}
    </Stack>
  )
}

function AgentList({ label, rows }: { label: string; rows: AgentRow[] }) {
  return (
    <List label={label}>
      {rows.map((a) => (
        <ListItem title={a.title} icon="agent" onPress={go(a.worktreeId, a.address)}>
          <Stack gap="xs">
            <Row gap="xs" wrap align="center">
              <Badge tone={STATE[a.state].tone}>{STATE[a.state].label}</Badge>
              {a.since ? <RelativeTime at={a.since} muted /> : null}
              <Text size="xs" muted truncate>
                {a.workspace}
              </Text>
            </Row>
            {a.detail ? (
              <Text size="xs" muted truncate>
                {a.detail}
              </Text>
            ) : null}
          </Stack>
        </ListItem>
      ))}
    </List>
  )
}

const runText = (run: ShipRow['latestRun']) => (!run ? 'No runs' : `${run.name} ${run.result === 'pass' ? 'passed' : run.result === 'fail' ? 'failed' : 'running'}`)

const siteAlert = (rows: SiteRow[]): Alert => {
  const n = (st: SiteState) => rows.filter((r) => r.state === st).length
  return worst(n('down') ? { tone: 'danger', text: `${n('down')} down` } : null, n('degraded') ? { tone: 'warning', text: `${n('degraded')} degraded` } : null)
}

function RunBadge({ run }: { run: ShipRow['latestRun'] }) {
  return <Badge tone={!run ? 'neutral' : run.result === 'pass' ? 'success' : run.result === 'fail' ? 'danger' : 'warning'}>{runText(run)}</Badge>
}

function PrList({ label, rows }: { label: string; rows: PrRow[] }) {
  return (
    <List label={label}>
      {rows.map((p) => (
        <ListItem title={`#${p.number} ${p.title}`} onPress={() => void shell.openExternal(p.url).catch(() => undefined)}>
          <Row gap="xs" wrap>
            {p.draft ? <Badge tone="neutral">Draft</Badge> : null}
            <Badge tone={CHECKS[p.checks].tone}>{CHECKS[p.checks].label}</Badge>
            <Badge tone={REVIEW[p.review].tone}>{REVIEW[p.review].label}</Badge>
          </Row>
        </ListItem>
      ))}
    </List>
  )
}

function ShipCard({ r, sites }: { r: ShipRow; sites: SiteRow[] }) {
  const run = r.latestRun
  const failing = r.prs.filter((p) => p.checks === 'fail').length
  const alert = worst(
    run?.result === 'fail' ? { tone: 'danger', text: runText(run) } : null,
    failing ? { tone: 'danger', text: `${failing} PR${failing === 1 ? '' : 's'} failing` } : null,
    siteAlert(sites)
  )
  // Collapsed: only a running or failed run, PRs whose checks run or fail or that have changes asked, and sites not up.
  const prs = r.error ? [] : r.prs.filter(running.pr)
  const down = sites.filter(running.site)
  const showRun = running.run(run)
  const shown = prs.length + down.length + (showRun ? 1 : 0)
  const preview = shown ? (
    <Stack gap="xs">
      {showRun ? <RunBadge run={run} /> : null}
      {prs.length ? <PrList label={`${r.repo} · running or failing`} rows={prs} /> : null}
      <SiteList label={`${r.product} sites not up`} rows={down} />
    </Stack>
  ) : null
  const total = (r.error ? 0 : r.prs.length) + sites.length + (run ? 1 : 0)
  return (
    <ProductGroup
      tab="ship"
      name={r.product}
      note={`${runText(run)} · ${r.error ? 'unreadable' : `${r.prs.length} open`}`}
      alert={alert}
      preview={preview}
      hidden={total - shown}
    >
      <Stack gap="xs">
        <Row justify="between" align="center" wrap>
          <RunBadge run={run} />
        </Row>
        {r.error ? (
          <Text size="xs" tone="warning">
            {r.error}
          </Text>
        ) : r.prs.length ? (
          <PrList label={`${r.repo} · ${r.prs.length} open`} rows={r.prs} />
        ) : (
          <Text size="xs" muted>
            {r.repo} · no open pull requests
          </Text>
        )}
        <SiteList label={`${r.product} sites`} rows={sites} />
      </Stack>
    </ProductGroup>
  )
}

function siteDetail(r: SiteRow): string {
  const answer = r.error ?? (r.status ? `HTTP ${r.status}` : '')
  return `${answer} · ${r.ms} ms`
}

function SiteList({ label, rows }: { label: string; rows: SiteRow[] }) {
  return rows.length ? (
    <List label={label}>
      {rows.map((r) => (
        <ListItem title={r.name} icon="globe" onPress={() => void shell.openExternal(r.url).catch(() => undefined)}>
          <Row gap="xs" wrap align="center">
            <Badge tone={SITE[r.state].tone}>{SITE[r.state].label}</Badge>
            <Text size="xs" muted>
              {siteDetail(r)}
            </Text>
            <Text size="xs" muted>
              since
            </Text>
            <RelativeTime at={r.since} muted />
          </Row>
        </ListItem>
      ))}
    </List>
  ) : null
}

/** The plain Sites group: bad entries in the setting (strings), then the sites. */
function SiteRows({ label, rows }: { label: string; rows: (string | SiteRow)[] }) {
  return (
    <Stack gap="xs">
      {rows.map((e) => (typeof e === 'string' ? <SourceError text={`Sites to ping: ${e}`} /> : null))}
      <SiteList label={label} rows={rows.filter((r): r is SiteRow => typeof r !== 'string')} />
    </Stack>
  )
}

const upNote =(rows: SiteRow[]) => `${rows.filter((r) => r.state === 'up').length} of ${rows.length} up`

/** Sites in the plain "Sites" group, then one group per product that has sites but no Ship row. */
function Sites({ s, shown }: { s: Snapshot; shown: Set<string> }) {
  const groups = new Map<string, SiteRow[]>()
  for (const r of s.sites) {
    const g = siteGroup(r, s.projects)
    if (g && shown.has(g)) continue
    groups.set(g ?? '', [...(groups.get(g ?? '') ?? []), r])
  }
  const plain = groups.get('') ?? []
  groups.delete('')
  return (
    <Stack gap="md">
      {plain.length || s.siteErrors.length ? (
        <ProductGroup
          tab="ship"
          name="Sites"
          note={upNote(plain)}
          alert={siteAlert(plain)}
          {...runningOnly([...s.siteErrors, ...plain], (r) => typeof r === 'string' || running.site(r), (rows) => <SiteRows label="Sites" rows={rows} />)}
        >
          <SiteRows label="Sites" rows={[...s.siteErrors, ...plain]} />
        </ProductGroup>
      ) : null}
      {[...groups].map(([product, rows]) => (
        <ProductGroup
          tab="ship"
          name={product}
          note={upNote(rows)}
          alert={siteAlert(rows)}
          {...runningOnly(rows, running.site, (down) => <SiteList label={`${product} sites`} rows={down} />)}
        >
          <SiteList label={`${product} sites`} rows={rows} />
        </ProductGroup>
      ))}
    </Stack>
  )
}

function Ship({ s }: { s: Snapshot }) {
  const ship = s.ghAt ? s.ship : []
  const shown = new Set(ship.map((r) => r.product))
  const sitesOf = (product: string) => s.sites.filter((r) => siteGroup(r, s.projects) === product)
  if (!s.ghAt)
    return (
      <Stack gap="md">
        <Sites s={s} shown={shown} />
        <Skeleton lines={4} label="Reading GitHub" />
      </Stack>
    )
  return (
    <Stack gap="md">
      <Sites s={s} shown={shown} />
      <SourceError text={s.errors.gh} />
      {ship.length ? (
        ship.map((r) => <ShipCard r={r} sites={sitesOf(r.product)} />)
      ) : (
        <EmptyState title="No GitHub repos to watch" description="Add owner/name repos in Settings, or a GitHub project to Orca." icon="rocket" />
      )}
    </Stack>
  )
}

const dashboardError = atom<string | null>(null)
const openDashboard = () => {
  set(dashboardError, null)
  void plugin.request('dashboard.open').then(
    (r) => set(dashboardError, r.ok ? null : r.error ?? 'Could not open the dashboard'),
    (e: unknown) => set(dashboardError, e instanceof Error ? e.message : String(e))
  )
}

export default function Panel() {
  const s = read(snapshot)
  return (
    <Stack gap="sm">
      <Row gap="xs" align="center">
        <Button size="sm" variant="outline" icon="bar-chart-3" tooltip="The whole control room as a wall of keys, full width in an editor tab" onPress={openDashboard}>
          Open dashboard
        </Button>
        {read(dashboardError) ? <Text size="xs" tone="danger">{read(dashboardError)}</Text> : null}
      </Row>
      <SourceError text={s.errors.orca} />
      {s.orcaAt ? (
        <Tabs label="View" defaultValue={read(tab)} onChange={(v) => set(tab, v)}>
          <Tab value="overview" label="Overview" icon="layers">
            <Overview s={s} />
          </Tab>
          <Tab value="queue" label={`Queue · ${s.needsYou.length}`} icon="flag">
            <Queue s={s} />
          </Tab>
          <Tab value="office" label="Office" icon="agent">
            <Office s={s} />
          </Tab>
          <Tab value="flows" label="Flows" icon="activity">
            <Flows s={s} />
          </Tab>
          <Tab value="ship" label="Ship" icon="rocket">
            <Ship s={s} />
          </Tab>
        </Tabs>
      ) : s.errors.orca ? null : (
        <Skeleton lines={6} label="Reading Orca" />
      )}
      {s.orcaAt ? (
        <Text size="xs" muted>
          {s.allowAnswer ? 'Answers decision gates after a confirm' : 'Read-only'} · updated <RelativeTime at={s.orcaAt} muted />
        </Text>
      ) : null}
    </Stack>
  )
}
