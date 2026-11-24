// The only commands this plugin ever runs: a fixed allow-list of read-only `orca` and `gh` reads,
// `orca plugin open` to show the Dashboard, plus one write, resolving a decision gate, sent only after the owner confirms it in the panel.
import { runFile } from './platform'

const ORCA_READS = new Set([
  'bot list',
  'bot item list',
  'bot chats',
  'repo list',
  'worktree ps',
  'orchestration run-list',
  'orchestration task-list',
  'orchestration gate-list',
  'orchestration worker-list',
  'orchestration inbox',
  'plugin list'
])
const ORCA_WRITES = new Set(['orchestration gate-resolve'])
// Changes only what Orca shows: the Dashboard tab.
const ORCA_SHOWS = new Set(['plugin open'])
const GH_READS = new Set(['pr list', 'run list'])

/** Runs one allow-listed `orca <command> ... --json` and answers its `result`. */
export async function orcaRead<T>(bin: string, command: string, extra: string[] = []): Promise<T> {
  if (!ORCA_READS.has(command)) throw new Error(`not an allowed read: orca ${command}`)
  return orcaRun<T>(bin, command, extra)
}

/** The one write: `orca orchestration gate-resolve`. No `--from`: the CLI acts as the person, not an agent. */
export async function orcaWrite<T>(bin: string, command: string, extra: string[]): Promise<T> {
  if (!ORCA_WRITES.has(command)) throw new Error(`not an allowed write: orca ${command}`)
  return orcaRun<T>(bin, command, extra)
}

/** `orca plugin open`: shows a tab, writes nothing. */
export async function orcaShow<T>(bin: string, command: string, extra: string[]): Promise<T> {
  if (!ORCA_SHOWS.has(command)) throw new Error(`not an allowed view: orca ${command}`)
  return orcaRun<T>(bin, command, extra)
}

async function orcaRun<T>(bin: string, command: string, extra: string[]): Promise<T> {
  const out = await runFile(bin, [...command.split(' '), ...extra, '--json'])
  // Some commands print a trailing `error: ...` line after the JSON on failure.
  const json = JSON.parse(out.slice(0, out.lastIndexOf('}') + 1)) as { ok?: boolean; result?: T; error?: { message?: string } }
  if (!json.ok) throw new Error(json.error?.message ?? `orca ${command} failed`)
  return json.result as T
}

/** Runs one allow-listed `gh <command> -R <repo> ... --json <fields>`. */
export async function ghRead<T>(bin: string, command: string, repo: string, extra: string[]): Promise<T> {
  if (!GH_READS.has(command)) throw new Error(`not an allowed read: gh ${command}`)
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`not a GitHub repo: ${repo}`)
  return JSON.parse(await runFile(bin, [...command.split(' '), '-R', repo, ...extra], 30_000)) as T
}

export const PR_FIELDS = 'number,title,url,isDraft,reviewDecision,statusCheckRollup'
export const RUN_FIELDS = 'status,conclusion,name,workflowName,url,createdAt'
