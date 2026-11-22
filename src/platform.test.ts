// Where orca and gh are found, per platform, with invented paths.
import { assert, test } from 'orca/testing'
import { candidates, resolveTool, toolEnv } from './platform'

const winEnv = {
  LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
  ProgramFiles: 'C:\\Program Files',
  PATH: 'C:\\tools\\;D:\\bin'
}

test('win32 orca: setting, then Orca-exported CLI, then install folder, then PATH (.exe only)', () => {
  assert.deepEqual(candidates('orca', 'win32', { ...winEnv, ORCA_CLI_COMMAND: 'E:\\o\\orca.exe' }, ' X:\\my\\orca.exe '), [
    'X:\\my\\orca.exe',
    'E:\\o\\orca.exe',
    'C:\\Users\\u\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe',
    'C:\\tools\\orca.exe',
    'D:\\bin\\orca.exe'
  ])
})

test('win32 gh: Program Files, per-user install, then PATH', () => {
  assert.deepEqual(candidates('gh', 'win32', winEnv), [
    'C:\\Program Files\\GitHub CLI\\gh.exe',
    'C:\\Users\\u\\AppData\\Local\\Programs\\GitHub CLI\\gh.exe',
    'C:\\tools\\gh.exe',
    'D:\\bin\\gh.exe'
  ])
})

test('darwin uses app bundle, Homebrew and PATH with plain names', () => {
  const env = { PATH: '/usr/bin:/opt/x/' }
  assert.deepEqual(candidates('orca', 'darwin', env), [
    '/Applications/Orca.app/Contents/Resources/bin/orca',
    '/usr/bin/orca',
    '/opt/x/orca'
  ])
  assert.deepEqual(candidates('gh', 'darwin', env), ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh', '/opt/x/gh'])
})

test('toolEnv fills Windows app-data folders and drops ELECTRON_RUN_AS_NODE', () => {
  const env = toolEnv('win32', { USERPROFILE: 'C:\\Users\\u', ELECTRON_RUN_AS_NODE: '1', PATH: 'C:\\tools' })
  assert.equal(env.APPDATA, 'C:\\Users\\u\\AppData\\Roaming')
  assert.equal(env.LOCALAPPDATA, 'C:\\Users\\u\\AppData\\Local')
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(toolEnv('win32', { USERPROFILE: 'C:\\Users\\u', APPDATA: 'Z:\\a' }).APPDATA, 'Z:\\a')
  // A trimmed worker env still finds the installed CLI.
  assert.equal(candidates('orca', 'win32', { USERPROFILE: 'C:\\Users\\u' })[0], 'C:\\Users\\u\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe')
  assert.equal(toolEnv('darwin', { HOME: '/Users/u' }).APPDATA, undefined)
})

test('resolveTool answers the first path that exists, or null', () => {
  const exists = (p: string) => p === 'D:\\bin\\gh.exe'
  assert.equal(resolveTool('gh', '', 'win32', winEnv, exists), 'D:\\bin\\gh.exe')
  assert.equal(resolveTool('orca', '', 'win32', winEnv, () => false), null)
})
