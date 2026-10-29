<p><img src="brand/favicon.svg" width="72" height="72" alt="task-progress mark: a progress bar above a checklist"></p>

# task-progress

A calm progress bar for Claude Code. When Claude works through a multi-step task, a static band above the prompt shows how far along it is, instead of leaving you to read a flickering spinner.

```
████████████░░░░░░░░ 3/5 · 60% · ~40s left  ▸ Run tests · 1m 5s · 7 actions  ctx ███░░ 48%
```

## Why I built it

Claude Code's thinking spinner tells you something is happening, but not how far along it is. On a long task I wanted to glance at the screen and know "3 of 5 steps done, now running tests" without reading the transcript. This mod turns Claude's own task list into a progress bar.

## What it does

- **Band above the prompt.** It fills one segment each time a step finishes and names the step in progress. It's cyan while working and turns green with `✓ all done in 2m 10s` at the end.
- **Time left.** Once a step has finished, `~40s left` is the average finished-step time times the steps still to go.
- **Progress inside a step.** The current step shows its elapsed time and the number of tool calls made since it started (`· 7 actions`). A small sub-bar appears only where real counts exist: a step named like `Migrate 3/10 files` or `Fix 4 of 9`, or a Bash result with a test summary (jest, vitest, node:test, pytest).
- **Done notice.** When the list first reaches 100%, a toast says `All 5 steps done in 2m 10s` and a short soft chime plays. Once per list. Turn the chime off in the plugin's `sound` setting.
- **Stuck warning.** If the current step runs longer than twice the median finished step (never less than 3 minutes), its label and time turn amber, for example `▸ Run tests · 4m`.
- **Context bar.** `ctx ███░░ 48%` shows how full the context window is, from the figure the engine reports: green under 60%, amber 60 to 80%, red above. If the engine has no figure yet, the bar is left out.
- **Fits narrow panes.** When space runs short the band drops the sub-bar first, then the context bar, then actions, the step time and the time left. The bar, the count and the current step stay.
- **Calm.** No animation. The band redraws when the task list changes, and, only while a step is active, once every 20 seconds so the times stay current.
- **Hidden when idle.** With no task list it isn't drawn, and a finished list clears when you send your next prompt.
- **Checklist pane.** Type `/task-progress` to dock a pane beside the chat. Each finished step shows how long it took (`✓ Read config   12s`), then come the total time, the action count and the model, and a "Previous runs" list of the last five finished lists.
- **Works on every surface.** Terminal, the desktop app's Code tab, VS Code and mobile.

## What's new in 0.2

Time left, per-step time and action counts, sub-bars where counts are real, a done toast and chime, the amber stuck warning, step durations and run history in the pane, and the context bar. New setting: `sound` (default on).

## How it works

It's a Claude Code hooks module (a "mod"). A `tool.call` hook watches the main session's task-list tools and keeps the steps in session state. Two `ui.render` hooks draw the band (`AbovePrompt`) and the pane from that state.

| Task list source | Tools it reads |
| --- | --- |
| Desktop app (Code tab) | `update_plan` (full list, `advance`, `done`, `start`) and `wrap_up` (marks all done) |
| Terminal CLI | `TodoWrite`, `TaskCreate`, `TaskUpdate` |

Subagents keep their own lists, so their task calls are ignored.

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install task-progress --marketplace chaekim96/task-progress
```

From a shell:

```bash
claude plugin install task-progress --marketplace chaekim96/task-progress
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `chaekim96/task-progress`, then Add plugin.

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

## Develop

```bash
claude plugin validate .
claude plugin test .
```

Tests in `hooks/register.test.tsx` run the band and pane against a fake clock: the desktop and `TodoWrite` lists, time left, action counts, sub-bars, the once-only toast and chime, the stuck colour and its timer, pane durations and history, and the context bar. `hooks/lib.test.ts` covers the pure helpers.

`scripts/make-chime.mjs` regenerates `assets/chime.wav`.

---

a Chae Kim build
