// Every platform-specific detail lives here: where `orca` and `gh` are, and how to start them.
// Windows (win32) is the tested target. macOS (darwin) has its branch filled in from the usual
// install locations but is untested; anything else falls back to PATH lookup.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { win32 } from 'node:path'

export type Env = Record<string, string | undefined>
export type Platform = 'win32' | 'darwin' | string

/**
 * The environment for the tools we start. Orca gives plugin workers a trimmed environment: on
 * Windows it has no APPDATA/LOCALAPPDATA (the orca CLI and gh both need them to find their state),
 * and ELECTRON_RUN_AS_NODE, which must not reach a child Electron binary.
 */
export function toolEnv(platform: Platform, env: Env): Env {
  const out: Env = { ...env }
  delete out.ELECTRON_RUN_AS_NODE
  if (platform === 'win32' && env.USERPROFILE) {
    out.APPDATA ??= win32.join(env.USERPROFILE, 'AppData', 'Roaming')
    out.LOCALAPPDATA ??= win32.join(env.USERPROFILE, 'AppData', 'Local')
  }
  // darwin: HOME is enough for both tools; nothing to fill in.
  return out
}

/** Candidate paths for a tool, in order of preference. Pure: tests call it with any platform. */
export function candidates(tool: 'orca' | 'gh', platform: Platform, rawEnv: Env, configured = ''): string[] {
  const env = toolEnv(platform, rawEnv)
  const list: string[] = []
  if (configured.trim()) list.push(configured.trim())
  // Orca exports the CLI it ships to the processes it starts.
  if (tool === 'orca' && env.ORCA_CLI_COMMAND) list.push(env.ORCA_CLI_COMMAND)

  if (platform === 'win32') {
    if (tool === 'orca' && env.LOCALAPPDATA) {
      list.push(win32.join(env.LOCALAPPDATA, 'Programs', 'orca', 'resources', 'bin', 'orca.exe'))
    }
    if (tool === 'gh') {
      for (const root of [env.ProgramFiles, env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'Programs')]) {
        if (root) list.push(win32.join(root, 'GitHub CLI', 'gh.exe'))
      }
    }
  } else if (platform === 'darwin') {
    // shortcut: untested on macOS; confirm these locations when Mac support is turned on.
    if (tool === 'orca') list.push('/Applications/Orca.app/Contents/Resources/bin/orca')
    if (tool === 'gh') list.push('/opt/homebrew/bin/gh', '/usr/local/bin/gh')
  }

  list.push(...onPath(tool, platform, env))
  return list
}

function onPath(tool: string, platform: Platform, env: Env): string[] {
  const path = env.PATH ?? env.Path ?? ''
  const sep = platform === 'win32' ? ';' : ':'
  // Only .exe on Windows: Node cannot start a .cmd/.bat without a shell, and we never use one.
  const name = platform === 'win32' ? `${tool}.exe` : tool
  const joiner = platform === 'win32' ? '\\' : '/'
  return path
    .split(sep)
    .filter(Boolean)
    .map((dir) => dir.replace(/[\\/]+$/, '') + joiner + name)
}

/** The first candidate that exists on disk, or null. */
export function resolveTool(
  tool: 'orca' | 'gh',
  configured = '',
  platform: Platform = process.platform,
  env: Env = process.env,
  exists: (path: string) => boolean = existsSync
): string | null {
  return candidates(tool, platform, env, configured).find((path) => exists(path)) ?? null
}

/** Runs an executable with an argument array (never a shell) and resolves with stdout. */
export function runFile(file: string, args: readonly string[], timeoutMs = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        env: toolEnv(process.platform, process.env),
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
        shell: false
      },
      (error, stdout, stderr) => {
        // The orca CLI prints its JSON error envelope on stdout with a non-zero exit; let the caller read it.
        if (error && !stdout.trim()) reject(new Error((stderr || error.message).trim().split('\n')[0]))
        else resolve(stdout)
      }
    )
  })
}
