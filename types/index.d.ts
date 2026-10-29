export type Step = {
  label: string
  status: 'pending' | 'in_progress' | 'completed'
  /** ms since epoch, set when the step first becomes in progress. */
  startedAt?: number
  /** ms since epoch, set when the step completes. */
  endedAt?: number
  /** Main-session tool calls made while this step was in progress. */
  actions?: number
  /** Pass/total parsed from a test runner's output in a Bash result. */
  tests?: { done: number; total: number }
}

export type Run = {
  startedAt: number
  finishedAt?: number
  /** True once the done toast and chime fired for this list. */
  notified: boolean
  /** Main-session tool calls since the list began. */
  actions: number
}

export type HistoryEntry = { steps: number; ms: number; actions: number; at: number }

declare module 'claude-code' {
  interface PluginState {
    'task-progress': {
      steps: Step[]
      run: Run | null
      /** Context window fill, whole percent, from the engine. Null until known. */
      ctx: number | null
      /** Model id that answered the latest main-session turn. */
      model: string | null
      /** Last finished lists, newest first (mirrors $.store 'history'). */
      history: HistoryEntry[]
    }
  }
}
