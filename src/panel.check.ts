// `orca plugin check` renders the panel once per scenario with the worker on a stand-in host.
import { defineCheck } from 'orca/testing'

export default defineCheck({
  fresh: {},
  quiet: { settings: { notifications: false } }
})
