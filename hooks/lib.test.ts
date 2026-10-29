import { expect, test } from 'claude-code/testing'

import type { Step } from '../types'
import {
  ctxColor,
  etaMs,
  fmtDur,
  isStuck,
  labelCounts,
  layoutBand,
  stamp,
  stuckAfterMs,
  testCounts,
} from './lib'

const done = (label: string, startedAt: number, endedAt: number): Step => ({ label, status: 'completed', startedAt, endedAt })

test('durations are compact', async () => {
  expect(fmtDur(45000)).toBe('45s')
  expect(fmtDur(180000)).toBe('3m')
  expect(fmtDur(130000)).toBe('2m 10s')
  expect(fmtDur(12 * 60000)).toBe('12m')
  expect(fmtDur(65 * 60000)).toBe('1h 5m')
})

test('time left needs a finished step and uses their average', async () => {
  const none: Step[] = [{ label: 'a', status: 'in_progress', startedAt: 0 }, { label: 'b', status: 'pending' }]
  expect(etaMs(none, 1000)).toBeUndefined()

  const some: Step[] = [
    done('a', 0, 20000),
    { label: 'b', status: 'in_progress', startedAt: 20000 },
    { label: 'c', status: 'pending' },
  ]
  // One pending step at 20s, plus all 20s of the current one.
  expect(etaMs(some, 20000)).toBe(40000)
  // Half of the current step is already behind it.
  expect(etaMs(some, 30000)).toBe(30000)
})

test('stuck means over twice the median, never under three minutes', async () => {
  const quick: Step[] = [done('a', 0, 10000), done('b', 10000, 30000), { label: 'c', status: 'in_progress', startedAt: 30000 }]
  expect(stuckAfterMs(quick)).toBe(180000)
  expect(isStuck(quick, 30000 + 179000)).toBe(false)
  expect(isStuck(quick, 30000 + 181000)).toBe(true)

  const slow: Step[] = [done('a', 0, 120000), { label: 'b', status: 'in_progress', startedAt: 120000 }]
  expect(stuckAfterMs(slow)).toBe(240000)
  expect(isStuck(slow, 120000 + 200000)).toBe(false)
  expect(isStuck(slow, 120000 + 250000)).toBe(true)
})

test('a sub-bar needs real counts', async () => {
  expect(labelCounts('Migrate 3/10 files')).toEqual({ done: 3, total: 10 })
  expect(labelCounts('Fix 4 of 9 tests')).toEqual({ done: 4, total: 9 })
  expect(labelCounts('Review 2025/10/21 notes')).toBeUndefined()
  expect(labelCounts('Run tests')).toBeUndefined()
  expect(labelCounts('Do 5/3')).toBeUndefined()

  expect(testCounts('Tests:       1 failed, 11 passed, 12 total')).toEqual({ done: 11, total: 12 })
  expect(testCounts(' Tests  11 passed | 1 failed (12)')).toEqual({ done: 11, total: 12 })
  expect(testCounts('# tests 12\n# pass 12\n')).toEqual({ done: 12, total: 12 })
  expect(testCounts('=== 1 failed, 11 passed, 2 skipped in 1.20s ===')).toEqual({ done: 11, total: 14 })
  expect(testCounts('all good, 12 things passed')).toBeUndefined()
})

test('the context bar is green under 60, amber to 80, red above', async () => {
  expect(ctxColor(59)).toBe('green')
  expect(ctxColor(60)).toBe('yellow')
  expect(ctxColor(80)).toBe('yellow')
  expect(ctxColor(81)).toBe('red')
})

test('narrow bands drop the less important pieces first', async () => {
  const steps: Step[] = [
    done('Read config', 0, 20000),
    { label: 'Run tests 3/10', status: 'in_progress', startedAt: 20000, actions: 7 },
    { label: 'Ship', status: 'pending' },
  ]
  const text = (cols: number, ctx: number | null) =>
    layoutBand({ steps, run: { startedAt: 0, notified: false, actions: 8 }, ctx, now: 35000, cols })
      .map(s => s.text)
      .join('')

  const wide = text(140, 48)
  expect(wide).toContain('1/3 · 33%')
  expect(wide).toContain('~25s left')
  expect(wide).toContain('▸ Run tests 3/10')
  expect(wide).toContain('· 15s')
  expect(wide).toContain('7 actions')
  expect(wide).toContain('ctx ')
  expect(wide).toContain('48%')

  const narrow = text(50, 48)
  expect(narrow).toContain('1/3 · 33%')
  expect(narrow).toContain('▸ Run tests')
  expect(narrow).not.toContain('ctx')
  expect(narrow).not.toContain('actions')
  expect([...narrow].length).toBeLessThanOrEqual(50)

  expect(text(140, null)).not.toContain('ctx')
})

test('a rewrite keeps times for the same step', async () => {
  const prev: Step[] = [{ label: 'a', status: 'in_progress', startedAt: 5, actions: 2 }]
  const next = stamp(prev, [{ label: 'a', status: 'completed' }], 99, false)
  expect(next[0]).toMatchObject({ startedAt: 5, endedAt: 99, actions: 2 })
  const fresh = stamp(prev, [{ label: 'other', status: 'in_progress' }], 99, false)
  expect(fresh[0]).toMatchObject({ startedAt: 99 })
})
