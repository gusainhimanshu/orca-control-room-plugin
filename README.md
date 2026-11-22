# Control Room

A **read-only** control room for Orca's right sidebar: what is waiting on you, every agent in every
workspace, and each product's pull requests and CI, grouped by product (Orca project).

It never answers a bot, writes to an agent or terminal, or presses a permission. A click only
navigates: it focuses an agent's terminal, or shows its workspace. A pull request row opens the PR
in your browser (Orca asks first).

## Views

- **Queue**: *Needs you* first: open decision gates from orchestration Runs (question and options,
  shown as plain labels, not answer buttons) and agents waiting on your input or permission. Then
  *Open work*: every open orchestration task of every Run, grouped by product.
- **Office**: every agent that still has a terminal or chat, grouped by product, as *working*,
  *waiting on you*, *idle* or *errored*, with how long it has been so. Click to go to it.
- **Ship**: per product, open pull requests with their checks state and review state, plus the
  latest GitHub Actions run (passed / failed / running).
- **Stuck-agent alarm**: one desktop notification per event when an agent waits on you or idles
  past the threshold, or errors. Already-announced events are remembered in plugin storage.
- **Status bar**: `Control Room · N to decide`.

## Where the data comes from

Only a fixed allow-list of read-only commands, run with argument arrays (never a shell), see
`src/sources.ts`:

| Command | Used for |
| --- | --- |
| `orca repo list --json` | products (projects) and their GitHub remotes |
| `orca worktree ps --json` | agents per workspace, state and since when |
| `orca orchestration run-list --json` | Runs to read tasks and gates from |
| `orca orchestration task-list --run <id> --json` | open work |
| `orca orchestration gate-list --run <id> --json` | decisions waiting on you |
| `orca orchestration worker-list --json` | which product a task works in |
| `gh pr list -R <repo> --state open --json …` | pull requests, checks, reviews |
| `gh run list -R <repo> --limit 1 --json …` | latest Actions run |

GitHub data comes only through your locally installed and signed-in `gh`. The plugin holds no
tokens and makes no network calls of its own.

Orca is read every 5 s and GitHub every 60 s. Reading rounds never overlap (one queue for both),
and agent or workspace events trigger an early Orca round. A failing source shows a small warning
in its view; the rest of the panel keeps working.

## Permissions it asks for, and why

| Capability | Why |
| --- | --- |
| `trusted-worker` | a Node worker runs the read-only `orca` and `gh` commands above |
| `workspace:read` | hear workspace created/removed events to refresh early |
| `agent:read` | hear agent status changes to refresh early |
| `workspace:write` | **only** `terminal.focus` and `workspace.open`, so a click can take you to an agent. Nothing renames, hides or runs commands |
| `notifications:show` | the stuck-agent alarm |
| `storage:own` | remember which alarms were already shown |
| `settings:own` | read the four settings below |

## Settings

| Setting | Default |
| --- | --- |
| Stuck-agent notifications | on |
| Stuck threshold (minutes) | 15 |
| Repos to watch on the Ship board (`owner/name`, comma separated) | empty = every GitHub repo behind your Orca projects |
| Orca CLI path | empty = find it automatically |

## Install

Requires Orca ≥ 1.4.259 and, for the Ship board, the GitHub CLI (`gh auth login` done).

```sh
git clone https://github.com/gusainhimanshu/orca-control-room-plugin
orca plugin dev load ./orca-control-room-plugin      # prints what it would grant, and a fingerprint
orca plugin dev load ./orca-control-room-plugin --approve <fingerprint>
```

Then open **Control Room** in the right sidebar.

## Development

No build step and no dependencies.

```sh
orca plugin validate .
orca plugin check .
orca plugin test .          # model, platform and panel tests (invented data)
npx -p typescript tsc -p .  # type check
```

- `src/model.ts`: pure data → view-model functions (tested in `src/model.test.ts`).
- `src/sources.ts`: the command allow-list.
- `src/worker.ts`: polling, alarms, status bar, navigation.
- `src/panel.tsx`: the components panel.

## Platform module

All platform-specific logic lives in **`src/platform.ts`**: finding `orca` and `gh`, the
environment handed to them, and starting them. It has a `win32` branch (tested) and a `darwin`
branch (filled in from the usual install paths, **untested**), so Mac support is a small change
in one file.

Windows notes:

- `orca` is looked up as: the setting → `ORCA_CLI_COMMAND` → `%LOCALAPPDATA%\Programs\orca\resources\bin\orca.exe` → `orca.exe` on `PATH`.
  `gh`: `%ProgramFiles%\GitHub CLI\gh.exe` → per-user install → `gh.exe` on `PATH`.
- Only `.exe` files are started: Node cannot start a `.cmd` without a shell, and this plugin never uses one.
- Orca gives plugin workers a trimmed environment without `APPDATA`/`LOCALAPPDATA` (both CLIs need
  them) and with `ELECTRON_RUN_AS_NODE`; `toolEnv()` restores the former from `USERPROFILE` and drops the latter.

## Not in v1

Acting from the panel, network calls of its own, flow diagrams, title-emoji parsing, an external
state file, an overlaps view, live-site pings. Agents Orca only remembers (no terminal or chat left)
are not shown.
