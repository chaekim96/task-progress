<p><img src="brand/favicon.svg" width="72" height="72" alt="task-progress mark: a progress bar above a checklist"></p>

# task-progress

A calm progress bar for Claude Code. When Claude works through a multi-step task, a static band above the prompt shows how far along it is, instead of leaving you to read a flickering spinner.

```
████████████░░░░░░░░ 3/5 · 60%  ▸ Run tests
```

## Why I built it

Claude Code's thinking spinner tells you something is happening, but not how far along it is. On a long task I wanted to glance at the screen and know "3 of 5 steps done, now running tests" without reading the transcript. This mod turns Claude's own task list into a progress bar.

## What it does

- **Band above the prompt.** It fills one segment each time a step finishes and names the step in progress. It's cyan while working and turns green with `✓ all done` at the end.
- **No animation.** It redraws only when the task list changes.
- **Hidden when idle.** With no task list it isn't drawn, and a finished list clears when you send your next prompt.
- **Checklist pane.** Type `/task-progress` to dock a pane beside the chat with every step: `✓` done, `▸` in progress, `·` pending.
- **Works on every surface.** Terminal, the desktop app's Code tab, VS Code and mobile.

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

Tests in `hooks/register.test.tsx` cover the desktop task list from start to `all done`, the terminal `TodoWrite` list, and the band staying hidden with no list.

---

a Chae Kim build
