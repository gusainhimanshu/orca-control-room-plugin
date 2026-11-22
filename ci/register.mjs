// Lets plain Node run the pure *.test.ts files without Orca: maps `orca/testing` to the stand-in
// and resolves extensionless relative imports (`./model`) to `.ts`, as Orca's loader does.
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'orca/testing') return next(new URL('./orca-testing.mjs', import.meta.url).href, context)
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context)
    return next(specifier, context)
  }
})
