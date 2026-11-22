// The few Node APIs the worker uses, typed here so the plugin needs no @types/node dependency.
declare module 'node:child_process' {
  export function execFile(
    file: string,
    args: readonly string[],
    options: { env?: Record<string, string | undefined>; timeout?: number; windowsHide?: boolean; maxBuffer?: number; shell?: boolean },
    callback: (error: Error | null, stdout: string, stderr: string) => void
  ): unknown
}
declare module 'node:fs' {
  export function existsSync(path: string): boolean
}
declare module 'node:path' {
  export const win32: { join(...parts: string[]): string }
}
declare const process: { platform: string; env: Record<string, string | undefined> }
