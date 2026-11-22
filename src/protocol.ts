// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
import type { AgentRow, FlowRow, Group, NeedRow, ShipRow, TaskRow } from './model'

/** Each source's last error, or absent when its last read worked. */
export type SourceErrors = Partial<Record<'orca' | 'bots' | 'runs' | 'flows' | 'gh', string>>

export type Snapshot = {
  /** 0 until the first orca round finishes. */
  orcaAt: number
  /** 0 until the first gh round finishes. */
  ghAt: number
  needsYou: NeedRow[]
  open: Group<TaskRow>[]
  office: Group<AgentRow>[]
  /** Recent inter-agent messages, newest first within each product. */
  flows: Group<FlowRow>[]
  ship: ShipRow[]
  errors: SourceErrors
}

export const emptySnapshot = (): Snapshot => ({
  orcaAt: 0,
  ghAt: 0,
  needsYou: [],
  open: [],
  office: [],
  flows: [],
  ship: [],
  errors: {}
})

declare module 'orca' {
  interface PluginRequests {
    /** The latest snapshot the worker holds. */
    'snapshot.get': { output: Snapshot }
    /** Navigation only: focus an agent's terminal, else show its workspace. */
    'navigate': { input: { worktreeId: string; address?: string | null }; output: { ok: boolean } }
  }
  interface PluginPanelEvents {
    /** Posted to every open panel after each reading round. */
    'snapshot': Snapshot
  }
}
