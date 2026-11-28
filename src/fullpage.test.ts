// "Open full page" opens the Dashboard as a tab of the workspace you are in: it puts one .crdeck file in that
// workspace (git ignores *.crdeck for the owner) and asks Orca to open it there. No hint, no workspace switch.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, test } from 'orca/testing'
import { headerHtml, STYLE, wireFull } from './dashboard'
import { openDashboard } from './fullpage'

const manifest = JSON.parse(readFileSync(new URL('../orca-plugin.json', import.meta.url), 'utf8'))

test('the + menu and the command palette still offer "Control Room dashboard", a .crdeck our editor opens', () => {
  const entry = manifest.contributes.newFiles?.find((f: { title: string }) => f.title === 'Control Room dashboard')
  assert.ok(entry, 'a newFiles entry titled "Control Room dashboard"')
  assert.equal(entry.extension, '.crdeck')
  assert.ok(manifest.contributes.customEditors.some((e: { id: string; extensions: string[] }) => e.id === 'dashboard' && e.extensions.includes('.crdeck')))
})

test('the old "Control Room: Open dashboard" command, which switched the window to the plugin folder workspace, is gone', () => {
  assert.ok(!manifest.contributes.commands?.some((c: { id: string }) => c.id === 'dashboard.open'))
})

// A stand-in for orca.host.call: one local workspace at `dir`, focused unless `focused` says otherwise.
function fakeHost(dir: string, opts: { focused?: string | null; hostId?: string | null } = {}) {
  const opened: { workspaceId: string; path: string }[] = []
  const call = async (method: string, params?: unknown): Promise<unknown> => {
    if (method === 'workspace.readContext') return opts.focused === null ? null : { workspaceId: opts.focused ?? 'ws1', branch: 'b', displayName: 'w', terminals: [] }
    if (method === 'workspace.list') return { workspaces: [{ id: 'ws1', kind: 'worktree', name: 'w', path: dir, branch: 'b', hostId: opts.hostId === undefined ? 'local' : opts.hostId }], truncated: false }
    if (method === 'editor.open') return opened.push(params as { workspaceId: string; path: string }), { opened: true }
    throw new Error(`unexpected ${method}`)
  }
  return { call, opened }
}

const workspace = () => mkdtempSync(join(tmpdir(), 'cr-ws-'))
const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? filesUnder(join(dir, n)).map((f) => `${n}/${f}`) : [n]))

test('one click puts a single *.crdeck file inside the focused workspace and opens it there as a tab', async () => {
  const dir = workspace()
  const host = fakeHost(dir)
  assert.deepEqual(await openDashboard(host.call), { ok: true })
  const files = filesUnder(dir)
  assert.equal(files.length, 1, 'nothing else is written into the workspace')
  assert.match(files[0], /^[^/]+\/[^/]+\.crdeck$|^[^/]+\.crdeck$/)
  assert.deepEqual(host.opened, [{ workspaceId: 'ws1', path: files[0] }], 'opened by a relative path inside that workspace')
  assert.ok(!/^\/|^[a-z]:|\.\./i.test(host.opened[0].path))
})

test('a second click reuses the file: same path, no second file, content untouched', async () => {
  const dir = workspace()
  const host = fakeHost(dir)
  await openDashboard(host.call)
  const [file] = filesUnder(dir)
  writeFileSync(join(dir, file), 'kept')
  assert.deepEqual(await openDashboard(host.call), { ok: true })
  assert.deepEqual(filesUnder(dir), [file])
  assert.equal(readFileSync(join(dir, file), 'utf8'), 'kept')
  assert.deepEqual(host.opened.map((o) => o.path), [file, file])
})

test('a workspace it cannot write to: a short message, nothing opened, no throw', async () => {
  const blocker = join(workspace(), 'not-a-folder')
  writeFileSync(blocker, '')
  const host = fakeHost(blocker)
  const r = await openDashboard(host.call)
  assert.equal(r.ok, false)
  assert.match(r.error ?? '', /^Could not open the full page in this workspace/)
  assert.deepEqual(host.opened, [])
})

test('no focused workspace, or one on another host: the same short message, nothing written', async () => {
  const dir = workspace()
  for (const host of [fakeHost(dir, { focused: null }), fakeHost(dir, { hostId: 'ssh:box' }), fakeHost(dir, { focused: 'gone' })]) {
    const r = await openDashboard(host.call)
    assert.equal(r.ok, false)
    assert.match(r.error ?? '', /^Could not open the full page/)
    assert.deepEqual(host.opened, [])
  }
  assert.deepEqual(filesUnder(dir), [])
})

test('a workspace folder that is gone is refused, never recreated', async () => {
  const gone = join(workspace(), 'deleted')
  const host = fakeHost(gone)
  const r = await openDashboard(host.call)
  assert.equal(r.ok, false)
  assert.match(r.error ?? '', /^Could not open the full page/)
  assert.deepEqual(host.opened, [])
  assert.equal(existsSync(gone), false)
})

// A cloned repository can commit .control-room as a link to a folder outside the checkout ('junction' needs no admin on Windows).
test('a .control-room that links out of the workspace is refused: nothing written through it', async () => {
  const dir = workspace()
  const outside = workspace()
  symlinkSync(outside, join(dir, '.control-room'), 'junction')
  const host = fakeHost(dir)
  const r = await openDashboard(host.call)
  assert.equal(r.ok, false)
  assert.match(r.error ?? '', /^Could not open the full page/)
  assert.deepEqual(host.opened, [])
  assert.deepEqual(readdirSync(outside), [])
})

test('a dashboard.crdeck that is a dangling link is never written through', async () => {
  const dir = workspace()
  const outside = join(workspace(), 'target.crdeck')
  mkdirSync(join(dir, '.control-room'))
  try {
    symlinkSync(outside, join(dir, '.control-room', 'dashboard.crdeck'), 'file')
  } catch {
    return // shortcut: Windows without Developer Mode cannot make file links; Linux CI runs this case.
  }
  const r = await openDashboard(fakeHost(dir).call)
  assert.equal(r.ok, false)
  assert.equal(existsSync(outside), false)
})

test('the hint is gone: "Open full page" is a plain button, no disclosure and no + menu directions', () => {
  const html = headerHtml(true)
  assert.match(html, /<button[^>]*id="full"/)
  assert.ok(!/full-hint|aria-expanded|aria-controls|Control Room dashboard/.test(html))
  assert.ok(!/full-hint/.test(STYLE))
})

test('the full-page editor has no "Open full page"', () => {
  assert.ok(!/id="full"/.test(headerHtml(false)))
})

test('the could-not-open line is a live region always in the page, outside the sticky header row', () => {
  const html = headerHtml(true)
  const msg = html.match(/<p[^>]*id="full-msg"[^>]*>/)
  assert.ok(msg, 'a full-msg element')
  assert.match(msg[0], /role="status"/)
  assert.match(html, /<\/header><p[^>]*id="full-msg"/, 'below the header, so an empty line takes no room in its row')
  assert.ok(!/\bhidden\b/.test(msg[0]), 'never hidden: a region that appears with its text is often not read out')
})

// A stand-in for the two elements wireFull touches; `said` lists each text the live region took.
function fakeHeader() {
  const said: string[] = []
  let text = ''
  const msg = { get textContent() { return text }, set textContent(v: string) { text = v; said.push(v) } }
  const full: { click?: () => void; addEventListener(t: string, f: () => void): void } = { addEventListener(t, f) { if (t === 'click') this.click = f } }
  const els: Record<string, unknown> = { full, 'full-msg': msg }
  return { doc: { getElementById: (id: string) => els[id] ?? null } as unknown as Document, press: () => full.click?.(), said, text: () => text }
}

const settle = () => new Promise((r) => setTimeout(r, 300))
const REFUSAL = { ok: false, error: 'Could not open the full page in this workspace.' }

test('a refusal is cleared, then said, in separate turns, so a reader announces it; the same refusal again is said again', async () => {
  const h = fakeHeader()
  const answers = [REFUSAL, REFUSAL, { ok: true }]
  let asked = 0
  wireFull(h.doc, async () => answers[asked++])
  h.press()
  assert.equal(h.text(), '', 'cleared at once on the press')
  await settle()
  assert.equal(asked, 1)
  assert.equal(h.text(), REFUSAL.error)
  h.press()
  assert.equal(h.text(), '', 'cleared again, so the same words count as new')
  await settle()
  assert.equal(h.text(), REFUSAL.error)
  assert.deepEqual(h.said.filter(Boolean), [REFUSAL.error, REFUSAL.error])
  h.press()
  await settle()
  assert.equal(h.text(), '', 'a success leaves the line empty')
})

test('a refusal still waiting to be said is dropped when a press within 150 ms succeeds', async () => {
  const h = fakeHeader()
  const answers = [REFUSAL, { ok: true }]
  let asked = 0
  wireFull(h.doc, async () => answers[asked++])
  h.press()
  await new Promise((r) => setTimeout(r, 0))
  h.press()
  await settle()
  assert.equal(asked, 2)
  assert.equal(h.text(), '', 'no stale refusal after the success')
})
