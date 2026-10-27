export type Step = { label: string; status: 'pending' | 'in_progress' | 'completed' }

declare module 'claude-code' {
  interface PluginState {
    'task-progress': { steps: Step[] }
  }
}
