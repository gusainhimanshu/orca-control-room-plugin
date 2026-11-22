// Control room. Rows navigate Orca (focus a terminal or show a workspace). The one write: a decision
// gate waiting on you can be answered, and only after an inline confirm. Nothing here answers a bot,
// types into a terminal or grants a permission.
import {
  atom,
  Badge,
  Button,
  Callout,
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
  type PanelContext,
  type Tone
} from 'orca'
import { MAX_RESOLUTION, type AgentRow, type AgentState, type Checks, type FlowRow, type Group, type NeedRow, type Review, type ShipRow, type TaskRow } from './model'
import { asSnapshot, emptySnapshot, type Snapshot } from './protocol'
import { siteGroup, type SiteRow, type SiteState } from './sites'

// Persisted so a reopened panel shows the last reading at once while a restarted worker reads again.
const snapshot = atom<Snapshot>('snapshot', emptySnapshot(), { persist: 'plugin' })
const tab = atom('tab', 'queue', { persist: 'plugin' })

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

function ProductHeader({ name, note }: { name: string; note: string }) {
  return (
    <Row gap="xs" align="center" wrap>
      <Text weight="semibold">{name}</Text>
      <Text size="xs" muted>
        {note}
      </Text>
    </Row>
  )
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

/** A bot item's options: Orca has no way to answer an item for its owner, so they open the bot's chat. */
function ItemOptions({ n, options }: { n: NeedRow; options: string[] }) {
  if (!n.worktreeId)
    return (
      <Row gap="xs" wrap>
        {options.map((o) => (
          <Badge tone="neutral">{o}</Badge>
        ))}
      </Row>
    )
  return (
    <Row gap="xs" wrap>
      {options.map((o) => (
        <Button size="sm" variant="outline" icon="open-external" tooltip={`Answer in ${n.from ?? 'the bot'}'s chat`} onPress={go(n.worktreeId, n.address)}>
          {o}
        </Button>
      ))}
    </Row>
  )
}

function NeedItem({ n, canAnswer }: { n: NeedRow; canAnswer: boolean }) {
  const answerable = n.kind === 'gate' && canAnswer
  // A pressable row cannot hold buttons: when the options are buttons to the chat, they navigate instead.
  const optionButtons = answerable || (n.kind === 'item' && !!n.worktreeId && n.decisions.some((d) => d.options.length > 0))
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
            {answerable ? null : <ItemOptions n={n} options={d.options} />}
          </Stack>
        ))}
        {/* A gate with no options still takes a typed answer. */}
        {answerable ? <GateAnswer n={n} options={n.decisions.flatMap((d) => d.options)} /> : null}
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
        // Header and list are siblings: nesting the list in another Stack lets long rows widen the panel.
        s.open.flatMap((g: Group<TaskRow>) => [
          <ProductHeader name={g.product} note={`${g.items.length} open`} />,
          <List label={g.product}>
            {g.items.map((t) => (
              <ListItem title={t.title} description={`${t.status} · ${t.via}`} icon="layers" />
            ))}
          </List>
        ])
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
    <ListItem
      title={f.subject || f.type}
      icon={f.waiting ? 'flag' : 'activity'}
      onPress={f.worktreeId ? go(f.worktreeId, f.address) : undefined}
    >
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

function Flows({ s }: { s: Snapshot }) {
  return (
    <Stack gap="md">
      <SourceError text={s.errors.flows} />
      {s.flows.length ? (
        s.flows.flatMap((g) => [
          <ProductHeader name={g.product} note={`${g.items.length} messages`} />,
          <List label={g.product}>
            {g.items.map((f) => (
              <FlowItem f={f} />
            ))}
          </List>
        ])
      ) : (
        <EmptyState title="No messages between agents yet" icon="activity" />
      )}
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

function Office({ s }: { s: Snapshot }) {
  if (!s.office.length) return <EmptyState title="No agents running" icon="agent" />
  return (
    <Stack gap="md">
      {s.office.flatMap((g) => [
        <ProductHeader name={g.product} note={counts(g.items)} />,
        <List label={g.product}>
          {g.items.map((a) => (
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
      ])}
    </Stack>
  )
}

function ShipCard({ r, sites }: { r: ShipRow; sites: SiteRow[] }) {
  const run = r.latestRun
  return (
    <Stack gap="xs">
      <Row justify="between" align="center" wrap>
        <Text weight="semibold">{r.product}</Text>
        {run ? (
          <Badge tone={run.result === 'pass' ? 'success' : run.result === 'fail' ? 'danger' : 'warning'}>
            {run.name} {run.result === 'pass' ? 'passed' : run.result === 'fail' ? 'failed' : 'running'}
          </Badge>
        ) : (
          <Badge tone="neutral">No runs</Badge>
        )}
      </Row>
      {r.error ? (
        <Text size="xs" tone="warning">
          {r.error}
        </Text>
      ) : r.prs.length ? (
        <List label={`${r.repo} · ${r.prs.length} open`}>
          {r.prs.map((p) => (
            <ListItem
              title={`#${p.number} ${p.title}`}
              onPress={() => void shell.openExternal(p.url).catch(() => undefined)}
            >
              <Row gap="xs" wrap>
                {p.draft ? <Badge tone="neutral">Draft</Badge> : null}
                <Badge tone={CHECKS[p.checks].tone}>{CHECKS[p.checks].label}</Badge>
                <Badge tone={REVIEW[p.review].tone}>{REVIEW[p.review].label}</Badge>
              </Row>
            </ListItem>
          ))}
        </List>
      ) : (
        <Text size="xs" muted>
          {r.repo} · no open pull requests
        </Text>
      )}
      <SiteList label={`${r.product} sites`} rows={sites} />
    </Stack>
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

const upNote = (rows: SiteRow[]) => `${rows.filter((r) => r.state === 'up').length} of ${rows.length} up`

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
        <Stack gap="xs">
          <ProductHeader name="Sites" note={upNote(plain)} />
          {s.siteErrors.map((e) => (
            <SourceError text={`Sites to ping: ${e}`} />
          ))}
          <SiteList label="Sites" rows={plain} />
        </Stack>
      ) : null}
      {[...groups].map(([product, rows]) => (
        <Stack gap="xs">
          <ProductHeader name={product} note={upNote(rows)} />
          <SiteList label={`${product} sites`} rows={rows} />
        </Stack>
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
        <EmptyState
          title="No GitHub repos to watch"
          description="Add owner/name repos in Settings, or a GitHub project to Orca."
          icon="rocket"
        />
      )}
    </Stack>
  )
}

export default function Panel() {
  const s = read(snapshot)
  return (
    <Stack gap="sm">
      <SourceError text={s.errors.orca} />
      {s.orcaAt ? (
        <Tabs label="View" defaultValue={read(tab)} onChange={(v) => set(tab, v)}>
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
