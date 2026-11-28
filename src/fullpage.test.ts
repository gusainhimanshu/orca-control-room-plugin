// The full-page Dashboard opens as a tab of the workspace you are in, from Orca's + menu, never by
// switching the window to another workspace. The panel's "Open full page" only says where to find it.
import { readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import { headerHtml } from './dashboard'

const manifest = JSON.parse(readFileSync(new URL('../orca-plugin.json', import.meta.url), 'utf8'))

test('the + menu and the command palette offer "Control Room dashboard", a .crdeck our editor opens', () => {
  const entry = manifest.contributes.newFiles?.find((f: { title: string }) => f.title === 'Control Room dashboard')
  assert.ok(entry, 'a newFiles entry titled "Control Room dashboard"')
  assert.equal(entry.extension, '.crdeck')
  assert.ok(manifest.contributes.customEditors.some((e: { id: string; extensions: string[] }) => e.id === 'dashboard' && e.extensions.includes('.crdeck')))
})

test('nothing opens the dashboard on the plugin folder file any more (that switched the window to its workspace)', () => {
  assert.ok(!manifest.contributes.commands?.some((c: { id: string }) => c.id === 'dashboard.open'))
})

test('"Open full page" is a disclosure for an inline hint naming + > Control Room dashboard', () => {
  const html = headerHtml(true)
  assert.match(html, /<button[^>]*id="full"[^>]*aria-expanded="false"[^>]*aria-controls="full-hint"/)
  const hint = html.match(/<div[^>]*id="full-hint"[^>]*>([\s\S]*?)<\/div>/)
  assert.ok(hint, 'a hint element with id full-hint')
  assert.match(hint[0], /\bhidden\b/, 'hidden until the button is pressed')
  assert.match(hint[0], /tabindex="-1"/, 'focusable, so pressing the button moves focus (and a screen reader) to it')
  assert.match(hint[1].replace(/<[^>]+>/g, ''), /\+ &gt; Control Room dashboard/)
  assert.match(hint[1], /<button[^>]*id="full-hint-close"/, 'a keyboard-reachable way to dismiss it')
})

test('the full-page editor has no "Open full page" and no hint', () => {
  assert.ok(!/id="full"|full-hint/.test(headerHtml(false)))
})
