// "Open full page": the Dashboard is a custom editor, which Orca opens only on a file inside a workspace
// (`editor.open` refuses any other path). So the worker keeps one .crdeck file in the workspace and opens
// it there. The owner's global git ignore has *.crdeck, so git never sees it. Orca tells a plugin nothing
// when an editor tab closes, so the file stays; the next click reuses it.
import { existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Relative to the workspace root, with Orca's forward slashes. */
export const DASHBOARD_FILE = '.control-room/dashboard.crdeck'
const TEXT = 'Control Room dashboard. This file only gives Orca something to open: the Dashboard editor ignores what it says.\n'
const REFUSED = 'Could not open the full page in this workspace.'

type Call = (method: string, params?: unknown) => Promise<unknown>
type Workspace = { id: string; path: string; hostId: string | null }

/** Opens the Dashboard as a tab of the focused workspace; readContext and workspace.list give it the same id. */
export async function openDashboard(call: Call): Promise<{ ok: boolean; error?: string }> {
  try {
    const id = ((await call('workspace.readContext')) as { workspaceId?: string } | null)?.workspaceId
    const { workspaces } = (await call('workspace.list')) as { workspaces: Workspace[] }
    const ws = id ? workspaces.find((w) => w.id === id) : undefined
    // A workspace on another host has no folder on this machine to write into.
    if (!ws || (ws.hostId !== null && ws.hostId !== 'local')) return { ok: false, error: REFUSED }
    const file = join(ws.path, ...DASHBOARD_FILE.split('/'))
    const dir = join(ws.path, DASHBOARD_FILE.split('/')[0])
    // Not recursive: a workspace folder that is gone is refused, never created.
    if (!existsSync(dir)) mkdirSync(dir)
    // lstat, not stat: a .control-room that is a link (say, committed in a clone) is refused, never followed.
    if (!lstatSync(dir).isDirectory()) return { ok: false, error: REFUSED }
    // `wx` never writes through a link, not even a dangling one.
    if (!existsSync(file)) writeFileSync(file, TEXT, { flag: 'wx' })
    await call('editor.open', { workspaceId: ws.id, path: DASHBOARD_FILE })
    return { ok: true }
  } catch {
    return { ok: false, error: REFUSED }
  }
}
