# Control Room

A **read-only** control room for Orca's right sidebar: what is waiting on you, every agent in every
workspace, each product's pull requests and CI, grouped by product (Orca project), and whether
the sites you list are up.

It never answers a bot, writes to an agent or terminal, or presses a permission. A click only
navigates: it focuses an agent's terminal, or shows its workspace. A pull request row opens the PR
in your browser (Orca asks first); so does a site row, with the site's URL.

## Views

- **Queue**: *Needs you* first: every bot's items with status *needs you*, with the bot's ask and
  its options (shown as plain labels, not answer buttons; you answer in the bot's chat). Agents
  waiting on your input or permission and open orchestration decision gates are added too. Then
  *Open work*: every bot's other open items (in progress, planned), grouped by product, plus
  orchestration tasks that no bot item already tracks.
- **Office**: every agent that still has a terminal or chat, grouped by product, as *working*,
  *waiting on you*, *idle* or *errored*, with how long it has been so. Click to go to it.
- **Flows**: the last 40 messages between bots, coordinators and workers, newest first, grouped by
  the product their task or Dispatch works in (else *Other*). Each row: from → to, the message type
  (question, status, worker_done, escalation…), its subject and only the first line of the body, cut
  short. An unanswered question or escalation is marked *Waiting on you*. Click to go to the worker's
  workspace when Orca knows it.
- **Ship**: per product, open pull requests with their checks state and review state, plus the
  latest GitHub Actions run (passed / failed / running). At the top, when *Sites to ping* is set,
  a **Sites** group: each site as *up* (2xx/3xx), *degraded* (4xx, or slower than 2 s) or *down*
  (5xx, timeout, DNS or connection error), with its response time and since when it has been so.
  A site written as `Product:Name=url` whose product is an Orca project shows in that product's
  card instead (or in a card of its own when the product has no GitHub repo); the rest stay in
  **Sites**. Bad entries in the setting show inline with the reason.
- **Stuck-agent alarm**: one desktop notification per event when an agent waits on you or idles
  past the threshold, or errors; and one when a site goes down, and one when it comes back.
  Already-announced events are remembered in plugin storage.
- **Status bar**: `Control Room · N to decide`.

## Where the data comes from

Only a fixed allow-list of read-only commands, run with argument arrays (never a shell), see
`src/sources.ts`:

| Command | Used for |
| --- | --- |
| `orca bot list --json` | the bots whose items make the Queue |
| `orca bot item list --bot <name> --limit 100 --json` | each bot's open items and their asks |
| `orca repo list --json` | products (projects) and their GitHub remotes |
| `orca worktree ps --json` | agents per workspace, state and since when |
| `orca orchestration run-list --json` | Runs to read tasks and gates from |
| `orca orchestration task-list --run <id> --json` | open tasks no bot item tracks |
| `orca orchestration gate-list --run <id> --json` | decision gates waiting on you |
| `orca orchestration worker-list --json` | which product a task or Dispatch works in |
| `orca orchestration inbox --limit 40 --json` | the Flows view: recent messages across every mailbox (bodies come previewed, never full) |

A bot item's product comes from what it links: a pull request's workspace or repo, or a Dispatch's
workspace. An item that links nothing takes the product the bot's other items work in.
| `gh pr list -R <repo> --state open --json …` | pull requests, checks, reviews |
| `gh run list -R <repo> --limit 1 --json …` | latest Actions run |

GitHub data comes only through your locally installed and signed-in `gh`. The plugin holds no
tokens.

### Site pings: the only network requests

Pinging the sites in *Sites to ping* is the **one** place the plugin makes network requests of its
own, and only to the URLs you list there (`src/sites.ts`). Empty (the default) means no request at
all. Each site, once a minute: a `HEAD` request (`GET` if the server refuses `HEAD`), 5 s timeout,
no cookies or credentials, at most 3 redirects followed (only to `http(s)`). The response body is
never read or stored; only the status code and the time taken are kept.

Orca is read every 5 s, GitHub every 60 s and the sites every 60 s. Reading rounds never overlap (one queue for both),
and agent or workspace events trigger an early Orca round. A failing source shows a small warning
in its view; the rest of the panel keeps working.

## Permissions it asks for, and why

| Capability | Why |
| --- | --- |
| `trusted-worker` | a Node worker runs the read-only `orca` and `gh` commands above |
| `workspace:read` | hear workspace created/removed events to refresh early |
| `agent:read` | hear agent status changes to refresh early |
| `workspace:write` | **only** `terminal.focus` and `workspace.open`, so a click can take you to an agent. Nothing renames, hides or runs commands |
| `notifications:show` | the stuck-agent alarm and site down / back notifications |
| `storage:own` | remember which alarms were already shown |
| `settings:own` | read the five settings below |

## Settings

| Setting | Default |
| --- | --- |
| Notifications (stuck agents, sites going down or coming back) | on |
| Stuck threshold (minutes) | 15 |
| Repos to watch on the Ship board (`owner/name`, comma separated) | empty = every GitHub repo behind your Orca projects |
| Sites to ping (`Name=https://url` or `Product:Name=https://url`, comma or newline separated, e.g. `Shop=https://shop.example.com, Alpha:Docs=https://docs.example.com`) | empty = no Sites group and no requests |
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
orca plugin test .          # model, platform, sites and panel tests (invented data, no real requests)
npx -y -p typescript@5.9.3 tsc -p . --noEmit  # type check
```

CI (`.github/workflows/ci.yml`, Ubuntu and Windows, Node LTS) runs without Orca: the type check
against a copy of Orca's generated types in `ci/orca-types/`, and the pure tests (model, platform,
sites) in plain Node through `ci/register.mjs`, which maps `orca/testing` to Node's `test` and
`assert`. The panel test needs Orca's `mount()`, so it runs only under `orca plugin test`. After
upgrading Orca, refresh the copy: `orca plugin types . && cp -r .orca/types/. ci/orca-types/`.

- `src/model.ts`: pure data → view-model functions (tested in `src/model.test.ts`).
- `src/sites.ts`: parsing *Sites to ping*, the ping itself (fetch injected) and up/degraded/down
  (tested in `src/sites.test.ts`).
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

## Not yet

Acting from the panel, network calls beyond the site pings, flow diagrams, title-emoji parsing, an
external state file, an overlaps view. Agents Orca only remembers (no terminal or chat left)
are not shown.
