// Read-only control room. Rows only navigate Orca (focus a terminal or show a workspace);
// nothing here answers a bot, types into a terminal or grants a permission.
import {
  atom,
  Badge,
  Callout,
  EmptyState,
  Heading,
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
  type PanelContext,
  type Tone
} from 'orca'
import type { AgentRow, AgentState, Checks, Group, NeedRow, Review, ShipRow, TaskRow } from './model'
import { emptySnapshot, type Snapshot } from './protocol'

// Persisted so a reopened panel shows the last reading at once while a restarted worker reads again.
const snapshot = atom<Snapshot>('snapshot', emptySnapshot(), { persist: 'plugin' })
const tab = atom('tab', 'queue', { persist: 'plugin' })

const take = (s: Snapshot) => {
  // A worker that just started has read nothing yet; keep the last reading over its empty one.
  const last = read(snapshot)
  if (!(s.orcaAt || s.errors.orca || !last.orcaAt)) return
  // Same for GitHub, which is read less often.
  set(snapshot, s.ghAt || !last.ghAt ? s : { ...s, ghAt: last.ghAt, ship: last.ship, errors: { ...s.errors, ...(last.errors.gh ? { gh: last.errors.gh } : {}) } })
}

export function setup(ctx: PanelContext): void {
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

function NeedItem({ n }: { n: NeedRow }) {
  return (
    <ListItem
      title={n.title}
      icon={n.kind === 'gate' ? 'flag' : 'agent'}
      onPress={n.worktreeId ? go(n.worktreeId, n.address) : undefined}
    >
      <Stack gap="xs">
        <Text size="sm">{n.question}</Text>
        {n.options.length ? (
          <Row gap="xs" wrap>
            {n.options.map((o) => (
              <Badge tone="neutral">{o}</Badge>
            ))}
          </Row>
        ) : null}
        <Row gap="xs" wrap>
          <Text size="xs" muted>
            {n.product}
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
      <SourceError text={s.errors.runs} />
      <Heading level={3}>Needs you · {s.needsYou.length}</Heading>
      {s.needsYou.length ? (
        <List label="Needs you">
          {s.needsYou.map((n) => (
            <NeedItem n={n} />
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
              <ListItem title={t.title} description={`${t.status} · ${t.run}`} icon="layers" />
            ))}
          </List>
        ])
      ) : (
        <Text muted size="sm">
          No open tasks in any Run.
        </Text>
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

function ShipCard({ r }: { r: ShipRow }) {
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
    </Stack>
  )
}

function Ship({ s }: { s: Snapshot }) {
  if (!s.ghAt) return <Skeleton lines={4} label="Reading GitHub" />
  return (
    <Stack gap="md">
      <SourceError text={s.errors.gh} />
      {s.ship.length ? (
        s.ship.map((r) => <ShipCard r={r} />)
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
          <Tab value="ship" label="Ship" icon="rocket">
            <Ship s={s} />
          </Tab>
        </Tabs>
      ) : s.errors.orca ? null : (
        <Skeleton lines={6} label="Reading Orca" />
      )}
      {s.orcaAt ? (
        <Text size="xs" muted>
          Read-only · updated <RelativeTime at={s.orcaAt} muted />
        </Text>
      ) : null}
    </Stack>
  )
}
