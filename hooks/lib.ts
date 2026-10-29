import type { HistoryEntry, Run, Step } from '../types'

export const STUCK_FLOOR_MS = 3 * 60 * 1000

// Compact duration: 45s, 4m 20s, 12m, 1h 5m.
export function fmtDur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 10) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
}

export function stepMs(step: Step): number | undefined {
  if (step.status !== 'completed' || step.startedAt === undefined || step.endedAt === undefined) return undefined
  return Math.max(0, step.endedAt - step.startedAt)
}

function finishedDurations(steps: Step[]): number[] {
  return steps.map(stepMs).filter((d): d is number => d !== undefined)
}

export function median(nums: number[]): number | undefined {
  if (nums.length === 0) return undefined
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export function currentStep(steps: Step[]): Step | undefined {
  return steps.find(step => step.status === 'in_progress')
}

export function elapsedMs(step: Step | undefined, now: number): number | undefined {
  return step && step.startedAt !== undefined ? Math.max(0, now - step.startedAt) : undefined
}

// Time left: average finished-step time for each step not yet started, plus what
// is left of the current step's average. Only once a step has finished.
export function etaMs(steps: Step[], now: number): number | undefined {
  const durations = finishedDurations(steps)
  if (durations.length === 0) return undefined
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length
  const pending = steps.filter(step => step.status === 'pending').length
  const cur = currentStep(steps)
  const curLeft = cur ? Math.max(0, avg - (elapsedMs(cur, now) ?? 0)) : 0
  const left = avg * pending + curLeft
  return left > 0 ? left : undefined
}

export function stuckAfterMs(steps: Step[]): number {
  const med = median(finishedDurations(steps))
  return Math.max(2 * (med ?? 0), STUCK_FLOOR_MS)
}

export function isStuck(steps: Step[], now: number): boolean {
  const el = elapsedMs(currentStep(steps), now)
  return el !== undefined && el > stuckAfterMs(steps)
}

// "Step 3/10: migrate" or "3 of 10 files": real progress named by the step itself.
export function labelCounts(label: string): { done: number; total: number } | undefined {
  const m = /(?:^|[^\d./])(\d{1,5})\s*(?:\/|of)\s*(\d{1,5})(?![\d/])/i.exec(label)
  if (!m) return undefined
  const done = Number(m[1])
  const total = Number(m[2])
  return total > 0 && done <= total ? { done, total } : undefined
}

// Final pass/total from a test runner's summary. Conservative: only known shapes.
export function testCounts(output: string): { done: number; total: number } | undefined {
  const num = (re: RegExp) => {
    const m = re.exec(output)
    return m ? Number(m[1]) : 0
  }
  // jest: "Tests:       1 failed, 11 passed, 12 total"
  const jest = /^\s*Tests:\s.*?(\d+) total/m.exec(output)
  if (jest) {
    const passed = /^\s*Tests:\s.*?(\d+) passed/m.exec(output)
    return { done: passed ? Number(passed[1]) : 0, total: Number(jest[1]) }
  }
  // vitest: "Tests  11 passed | 1 failed (12)"
  const vitest = /^\s*Tests\s+.*\((\d+)\)\s*$/m.exec(output)
  if (vitest) {
    const passed = /^\s*Tests\s+.*?(\d+) passed/m.exec(output)
    return { done: passed ? Number(passed[1]) : 0, total: Number(vitest[1]) }
  }
  // node:test (TAP summary): "# tests 12" and "# pass 11"
  const tests = /^# tests (\d+)\s*$/m.exec(output)
  if (tests) return { done: num(/^# pass (\d+)\s*$/m), total: Number(tests[1]) }
  // pytest: "=== 1 failed, 11 passed, 2 skipped in 1.20s ==="
  const py = /^=+ (.*\b(?:passed|failed|error|errors)\b.*) in [\d.]+s.*=+\s*$/m.exec(output)
  if (py) {
    let total = 0
    let passed = 0
    for (const part of (py[1] ?? '').matchAll(/(\d+) (passed|failed|errors?|skipped|xfailed|xpassed|deselected)/g)) {
      if (part[2] === 'deselected') continue
      total += Number(part[1])
      if (part[2] === 'passed') passed += Number(part[1])
    }
    if (total > 0) return { done: passed, total }
  }
  return undefined
}

export function subOf(step: Step | undefined): { done: number; total: number; kind: 'label' | 'tests' } | undefined {
  if (!step) return undefined
  const fromLabel = labelCounts(step.label)
  if (fromLabel) return { ...fromLabel, kind: 'label' }
  return step.tests ? { ...step.tests, kind: 'tests' } : undefined
}

export function ctxColor(percent: number): string {
  return percent > 80 ? 'red' : percent >= 60 ? 'yellow' : 'green'
}

export function bar(done: number, total: number, width: number) {
  const filled = total > 0 ? Math.max(0, Math.min(width, Math.round((done / total) * width))) : 0
  return { filled: '█'.repeat(filled), empty: '░'.repeat(width - filled) }
}

// Carries start/end times and counts across a list rewrite, then stamps transitions.
export function stamp(prev: Step[], next: Step[], now: number, byIndex: boolean): Step[] {
  return next.map((step, i) => {
    const old = prev[i]
    const same = old && (byIndex || old.label === step.label)
    const out: Step = { ...step }
    if (same) {
      if (old.startedAt !== undefined) out.startedAt = old.startedAt
      if (old.endedAt !== undefined) out.endedAt = old.endedAt
      if (old.actions !== undefined) out.actions = old.actions
      if (old.tests !== undefined) out.tests = old.tests
    }
    if (step.status === 'in_progress' && out.startedAt === undefined) out.startedAt = now
    if (step.status !== 'completed') delete out.endedAt
    if (step.status === 'completed' && out.endedAt === undefined && out.startedAt !== undefined) out.endedAt = now
    if (step.status === 'pending') {
      delete out.startedAt
    }
    return out
  })
}

export type Seg = { text: string; color?: string; dim?: boolean }

export type BandModel = {
  steps: Step[]
  run: Run | null
  ctx: number | null
  now: number
  cols: number
}

const len = (segs: Seg[]) => segs.reduce((n, s) => n + [...s.text].length, 0)

// Lays the band out in `cols` cells. The bar, count and percent always stay; then
// the current step, time left, step time, actions, context and sub-bar are added
// in that order of importance while they fit.
export function layoutBand(m: BandModel): Seg[] {
  const { steps, run, ctx, now, cols } = m
  const total = steps.length
  const done = steps.filter(step => step.status === 'completed').length
  const isDone = done === total
  const cur = currentStep(steps)
  const stuck = !isDone && isStuck(steps, now)
  const width = cols >= 80 ? 20 : cols >= 56 ? 12 : 8
  const { filled, empty } = bar(done, total, width)
  const base: Seg[] = [
    { text: filled, color: isDone ? 'green' : 'cyan' },
    { text: empty, dim: true },
    { text: ` ${done}/${total} · ${Math.round((done / total) * 100)}%` },
  ]

  const slots: Record<string, Seg[]> = {}
  if (isDone) {
    const took = run?.finishedAt !== undefined ? ` in ${fmtDur(run.finishedAt - run.startedAt)}` : ''
    slots.label = [{ text: ` ✓ all done${took}`, color: 'green' }]
  } else {
    if (cur) {
      const label = [...cur.label].length > 40 ? `${[...cur.label].slice(0, 39).join('')}…` : cur.label
      slots.label = [{ text: `  ▸ ${label}`, dim: !stuck, color: stuck ? 'yellow' : undefined }]
    }
    const eta = etaMs(steps, now)
    if (eta !== undefined) {
      const rounded = eta < 60000 ? Math.max(5000, Math.round(eta / 5000) * 5000) : eta
      slots.eta = [{ text: ` · ~${fmtDur(rounded)} left` }]
    }
    const el = elapsedMs(cur, now)
    if (el !== undefined) slots.elapsed = [{ text: ` · ${fmtDur(el)}`, color: stuck ? 'yellow' : undefined, dim: !stuck }]
    if (cur && run && cur.actions) {
      slots.actions = [{ text: ` · ${cur.actions} ${cur.actions === 1 ? 'action' : 'actions'}`, dim: true }]
    }
    const sub = subOf(cur)
    if (sub) {
      const b = bar(sub.done, sub.total, 6)
      slots.sub = [
        { text: '  ' },
        { text: b.filled, color: 'cyan' },
        { text: b.empty, dim: true },
        { text: ` ${sub.kind === 'tests' ? 'tests ' : ''}${sub.done}/${sub.total}`, dim: true },
      ]
    }
  }
  if (ctx !== null) {
    const c = bar(ctx, 100, 5)
    const color = ctxColor(ctx)
    slots.ctx = [
      { text: '  ctx ', dim: true },
      { text: c.filled, color },
      { text: c.empty, dim: true },
      { text: ` ${ctx}%`, color },
    ]
  }

  // Priority, most important first.
  const priority = ['label', 'eta', 'elapsed', 'actions', 'ctx', 'sub']
  const keep = new Set<string>()
  let used = len(base)
  for (const key of priority) {
    const seg = slots[key]
    if (seg && used + len(seg) <= cols) {
      keep.add(key)
      used += len(seg)
    }
  }
  // Display order differs from priority order.
  const order = ['eta', 'label', 'elapsed', 'actions', 'sub', 'ctx']
  return [...base, ...order.filter(key => keep.has(key)).flatMap(key => slots[key] ?? [])]
}

export function keepHistory(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...history].slice(0, 5)
}
