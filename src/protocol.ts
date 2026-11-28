// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
import type { AgentRow, FlowRow, Group, NeedRow, ShipRow, TaskRow } from './model'
import type { OverviewBot } from './overview'
import type { SiteRow } from './sites'

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
  /** Who hands work to whom: each bot, the workers it started and their pull requests. */
  overview: OverviewBot[]
  /** 0 until the first site round finishes (it runs even when no sites are set). */
  sitesAt: number
  /** One row per site in the "Sites to ping" setting; empty when it is empty. */
  sites: SiteRow[]
  /** Entries of that setting that could not be used, each with the reason. */
  siteErrors: string[]
  /** Every Orca project's name: a `Product:Name=url` site whose product is one of these shows in its group. */
  projects: string[]
  /** The "Allow answering from the panel" setting: decision gates get answer buttons. */
  allowAnswer: boolean
  /** Each product's latest workspace activity (ms), from `lastActivityAt` in `orca worktree ps`. */
  lastActive: Record<string, number>
  /** The "Active within (days)" setting: the Dashboard hides projects quiet for longer. 0 shows every project. */
  activeDays: number
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
  overview: [],
  sitesAt: 0,
  sites: [],
  siteErrors: [],
  projects: [],
  allowAnswer: false,
  lastActive: {},
  activeDays: 0,
  errors: {}
})

/** A snapshot from storage, over the defaults: one saved by an older version lacks newer fields. */
export const asSnapshot = (stored: unknown): Snapshot =>
  stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...emptySnapshot(), ...stored } : emptySnapshot()

declare module 'orca' {
  interface PluginRequests {
    /** The latest snapshot the worker holds. */
    'snapshot.get': { output: Snapshot }
    /** Navigation only: focus an agent's terminal, else show its workspace. */
    'navigate': { input: { worktreeId: string; address?: string | null }; output: { ok: boolean } }
    /** Open the Dashboard as a tab of the focused workspace: writes its one .crdeck file there. */
    'dashboard.open': { output: { ok: boolean; error?: string } }
    /** The one write: resolve a decision gate the owner confirmed in the panel. */
    'gate.resolve': { input: { gateId: string; resolution: string }; output: { ok: boolean; error?: string } }
  }
  interface PluginPanelEvents {
    /** Posted to every open panel after each reading round. */
    'snapshot': Snapshot
  }
}
