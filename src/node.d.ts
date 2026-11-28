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
  export function readFileSync(path: URL | string, encoding: 'utf8'): string
  export function writeFileSync(path: string, data: string, options?: { flag?: string }): void
  export function lstatSync(path: string): { isDirectory(): boolean }
  export function symlinkSync(target: string, path: string, type?: 'dir' | 'file' | 'junction'): void
  export function mkdirSync(path: string): void
  export function mkdtempSync(prefix: string): string
  export function readdirSync(path: string): string[]
  export function statSync(path: string): { isDirectory(): boolean }
}
declare module 'node:os' {
  export function tmpdir(): string
}
declare module 'node:path' {
  export const win32: { join(...parts: string[]): string }
  export function join(...parts: string[]): string
}
declare const process: { platform: string; env: Record<string, string | undefined> }
