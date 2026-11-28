// The full-page Dashboard opens as a tab of the workspace you are in, from Orca's + menu, never by
// switching the window to another workspace. The panel's "Open full page" only says where to find it.
import { readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import { headerHtml, STYLE, wireFullHint } from './dashboard'

const manifest = JSON.parse(readFileSync(new URL('../orca-plugin.json', import.meta.url), 'utf8'))

test('the + menu and the command palette offer "Control Room dashboard", a .crdeck our editor opens', () => {
  const entry = manifest.contributes.newFiles?.find((f: { title: string }) => f.title === 'Control Room dashboard')
  assert.ok(entry, 'a newFiles entry titled "Control Room dashboard"')
  assert.equal(entry.extension, '.crdeck')
  assert.ok(manifest.contributes.customEditors.some((e: { id: string; extensions: string[] }) => e.id === 'dashboard' && e.extensions.includes('.crdeck')))
})

test('the old "Control Room: Open dashboard" command, which switched the window to the plugin folder workspace, is gone', () => {
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

// A stand-in for the three elements wireFullHint touches. An element with `hidden` is off screen only when
// the page's CSS says so: an author rule like `.full-hint { display: flex }` beats the browser's own `[hidden]`.
function fakeHeader() {
  const els: Record<string, { hidden: boolean; attrs: Record<string, string>; click?: () => void; setAttribute(n: string, v: string): void; focus(): void; addEventListener(t: string, f: () => void): void }> = {}
  let focused = ''
  for (const id of ['full', 'full-hint', 'full-hint-close']) {
    els[id] = {
      hidden: id === 'full-hint',
      attrs: { 'aria-expanded': 'false' },
      setAttribute(n, v) { this.attrs[n] = v },
      focus() { focused = id },
      addEventListener(t, f) { if (t === 'click') this.click = f }
    }
  }
  const hidesHidden = /(^|[\s}])\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(STYLE)
  const hint = els['full-hint']
  return {
    doc: { getElementById: (id: string) => els[id] ?? null } as unknown as Document,
    press: (id: string) => els[id].click?.(),
    shown: () => !(hint.hidden && hidesHidden),
    expanded: () => els.full.attrs['aria-expanded'],
    focused: () => focused
  }
}

test('the hint is off screen until "Open full page" is pressed, on screen after, and off again after "Got it"', () => {
  const h = fakeHeader()
  wireFullHint(h.doc)
  assert.equal(h.shown(), false, 'hidden when the panel loads')
  h.press('full')
  assert.equal(h.shown(), true)
  assert.equal(h.expanded(), 'true')
  assert.equal(h.focused(), 'full-hint')
  h.press('full-hint-close')
  assert.equal(h.shown(), false)
  assert.equal(h.expanded(), 'false')
  assert.equal(h.focused(), 'full')
})
