// CI stand-in for `orca/testing`, enough for the pure tests: Orca's `test` and `assert` are Node's.
export { test } from 'node:test'
export { default as assert } from 'node:assert/strict'
