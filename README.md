# Control Room

A control room for Orca's right sidebar: who hands work to whom, what is waiting on you, every agent in every workspace,
each product's pull requests and CI, grouped by product (Orca project), and whether the sites you
list are up; plus a full-page Dashboard of the same, as a wall of keys.

It is **read-only except for one thing**: an orchestration *decision gate* waiting on you can be
answered from the Queue, and only after you confirm it inline (see [Answering from the
panel](#answering-from-the-panel)); the setting *Allow answering from the panel* turns that off.
It never answers a bot item, writes to an agent or terminal, or presses a permission. Any other
click only navigates: it focuses an agent's terminal, or shows its workspace (a bot's chat
included). A pull request row opens the PR in your browser (Orca asks first); so does a site row,
with the site's URL.

## Views

One sidebar entry, **Control Room** (0.9.0). Its header has three controls side by side:
**Dashboard** (the wall of keys, the default), **Details** (the tabs below, as lists) and **Open full
page**. The panel opens on the view, tab and groups you left it on (kept in the plugin's storage).
In Details, Esc goes back to the Dashboard (first dropping an answer awaiting confirmation), Left
and Right move between the tabs, Up and Down between the rows and group headers.

- **Dashboard**: the Dashboard's wall of keys (below), drawn by the same
  page as the full-page Dashboard, so the same square keys with their glow: the totals, one row per
  product worst first with quiet things folded, then the bots. **Press a key for what is behind
  it**: the wall is replaced, in place, by the rows behind that key, which do what they do
  elsewhere (focus an agent or show its workspace, open a PR or site with Orca's confirm, *Open
  chat to answer*, answer a decision gate after a confirm). **← Dashboard** or Esc goes back, and
  focus returns to the key. A total lists its rows from every product (*Needs you* → the needs-you
  cards, *Working* → the agents working, *PRs failing* → the failing PRs); a product key lists
  that product's agents, items, PRs with their checks, latest CI, sites and recent messages; a bot
  key its workers, items and the last thing it said; a summary key (*4 agents*) the rows it folded.
  Arrow keys move between keys. **Open full page** opens the full-page Dashboard.
- **Details**: the tabs below, drawn as HTML on the same page (until 0.8.0 they were a separate
  *Control Room · Details* panel), with the same rows and actions as the drawer.

- **Overview**: a diagram of who hands work to whom, top to bottom: **You** → each bot
  → the workers it started → their pull requests, one node per row, indented by tier, in a box
  that scrolls when tall. A bot's workers come from the Dispatches its open items link and the
  Dispatches it mailed; a pull request hangs off the worker of the item that links it (else off
  the bot). Pull requests are coloured by CI (the item link's checks, else the Ship board's).
  Amber marks what waits on you: a bot with *needs you* items, a worker waiting on input. Press a
  node to go there: a bot's chat or a worker's terminal or workspace, or a PR in your browser.
  Below it, one card per bot: what it is doing now, open items, workers, and the first line of the
  last thing it said. Built only from the reads below; drawn as indented rows in Orca's theme
  colours, with no motion.
- **Queue**: *Needs you* first: every bot's items with status *needs you*, with the bot's ask and
  its options as plain text. Orca offers no way to answer a bot item for you outside its chat, and
  a plugin cannot switch to one particular chat (chats are not terminals), so the item gets one
  **Open '<chat>' to answer** button (*Open Home Chat to answer* for the Home Chat): it opens the
  bot's home workspace (0.10.2; when Orca lists no home, the workspace Orca shows the chat in), and
  a large amber callout under the row says *Now click the '<chat>' chat in <bot>'s sidebar*, then
  the question and its options. The callout stays until you dismiss it or the item no longer needs
  you. It sends nothing. Agents waiting on your input or permission are added too, and open
  orchestration decision gates, which you can answer here (below). Then
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
- **Collapsible groups** (0.5.0): in every tab each group header (a product; a bot on Overview;
  *Sites* on Ship) collapses and expands on a click or with the keyboard. A collapsed header keeps
  its name and summary (*3 open*, the CI run, *2 of 3 up*), and when something inside waits on you,
  fails or is down it is outlined amber or red and says what (*🟠 1 waiting on you*, *🔴 1 down*).
  Which ones you opened or closed is remembered per tab and product across reloads and updates,
  and a product that is gone is ignored.
- **Collapsed by default, showing what runs** (0.6.0): every group starts collapsed unless you
  opened it before. Under its header a collapsed group still lists its running rows, and says
  *+N more* when expanding would show more:
  - *Office*: agents working, waiting on you or errored (idle ones hidden).
  - *Queue* (Open work): items in progress, dispatched or blocked (planned ones hidden).
  - *Ship*: pull requests whose checks run or fail, or with changes asked; sites down or degraded;
    the latest Actions run when it is running or failed.
  - *Flows*: messages waiting on you and messages from the last 15 minutes.
  - *Overview* bot cards: what the bot is doing now, and its workers waiting on you or errored.

  When nothing in a group runs, only the header and its summary show (*2 idle*).
- **Dashboard** (0.7.0): the whole control room on one full-width page, as a wall of keys. Open it
  with **Open full page** in the *Control Room* panel or *Control Room: Open dashboard* in the
  command palette. It reads the same snapshot as the sidebar and is read-only the same way.
  - Top row, the totals: *Needs you*, *Working*, *Waiting*, *Errored*, *PRs failing*, *Sites down*.
    A zero stays grey. Pressing one opens its details (below) and also outlines the keys that count
    toward it, dimming the rest.
  - Then one row per product, worst first: the product's own wide key (red when something fails or
    is down, amber when something waits on you, blue when something works, green when all is
    quiet), then its keys, worst first: items and gates waiting on you, agents working, waiting or
    errored, pull requests whose checks fail or run or that have changes asked, sites down or
    degraded, the latest Actions run, open items. Quiet things fold into one key each
    (*4 agents idle*, *3 PRs green*, *2 sites up*). Sites with no product share a *Sites* row, and
    products with nothing to show share the last row.
  - **Only active projects** (0.10.0): a project (Orca project) shows a row only when one of its
    workspaces had activity (`lastActivityAt` in `orca worktree ps`) within *Active within (days)*
    (default 15, the boundary day included). A project with no workspaces is inactive. The others
    drop their rows, from *Nothing to show* too, and fold into one quiet line at the end:
    *N inactive projects hidden*. The totals count only what shows, except **Needs you**, which
    always counts every question to you. Rows that are no Orca project (*Sites*, a watched repo of
    no project) and the bots always show; the Details tabs show everything. Both the sidebar
    Dashboard and the full page.
  - Then one key per bot: its workers, and how many wait on you. Its drawer starts with
    **Open <bot>'s home** (0.10.1): it shows the bot's home folder workspace (`~/.orca/bots/<bot>`,
    the workspace `orca worktree ps` marks `botHome`). Bot chats have no terminal, so a plugin
    cannot pick one: Orca shows the chat open there last; pick *Home* in its chat list for the Home
    Chat. **Shift+press** on a bot key opens its home directly. A bot with no home workspace gets
    no button.
  - Pressing any key (0.8.0) opens a **details drawer** on the same page: beside the wall when the
    tab is wide, below it when narrow. It lists the rows behind the key, the same ones the sidebar's
    Dashboard view lists, and they act the same way: show the workspace or focus the terminal, open
    the pull request, run or site in your browser (Orca asks first), *Open '<chat>' to answer*, or
    answer a decision gate after an inline confirm. Pressing the key again, **Close**, or Esc closes
    it and puts focus back on the key. Arrow keys move between keys, Enter presses one.
  - Only product keys glow and pulse, and only when red or amber; the pulse is off under
    *reduce motion*. Colours follow Orca's light or dark theme.
  - Where it lives: Orca plugins have no main-area panel; a custom editor is the one full-page
    surface, and it opens on a file. So the plugin ships an empty `Control Room/Dashboard.crdeck`
    and opens it with `orca plugin open <plugin> --editor <that file>`. **The first time, Orca adds
    the plugin's `Control Room` folder as a folder workspace** (it holds only that file); you can
    hide it from the sidebar. Nothing is ever written to it.
- **Stuck-agent alarm**: one desktop notification per event when an agent waits on you or idles
  past the threshold, or errors; and one when a site goes down, and one when it comes back.
  Already-announced events are remembered in plugin storage.
- **Status bar**: `Control Room · N to decide`.

## Where the data comes from

Only a fixed allow-list of commands, run with argument arrays (never a shell), see
`src/sources.ts`. All are reads but two: `orca plugin open` only shows the Dashboard tab, and `gate-resolve` is the one write:

| Command | Used for |
| --- | --- |
| `orca bot list --json` | the bots whose items make the Queue |
| `orca bot item list --bot <name> --limit 100 --json` | each bot's open items and their asks |
| `orca bot chats --bot <name> --json` | the title of the chat a needs-you item lives in (only for bots with one) |
| `orca repo list --json` | products (projects) and their GitHub remotes |
| `orca worktree ps --json` | agents per workspace, state and since when; each workspace's `lastActivityAt`, which makes a project active on the Dashboard |
| `orca orchestration run-list --json` | Runs to read tasks and gates from |
| `orca orchestration task-list --run <id> --json` | open tasks no bot item tracks |
| `orca orchestration gate-list --run <id> --json` | decision gates waiting on you |
| `orca orchestration worker-list --json` | which product a task or Dispatch works in |
| `orca orchestration inbox --limit 40 --full --json` | the Flows view: recent messages across every mailbox and when each was sent (only a body's first line is kept, cut to 120 characters) |
| `orca plugin list --json` | this plugin's key, to open its Dashboard |
| `orca plugin open <plugin> --editor <Dashboard.crdeck>` | shows the Dashboard tab (changes only what Orca shows) |
| `orca orchestration gate-resolve --id <gate> --resolution <text> --json` | **the one write**: only when you confirm an answer to a decision gate (below) |

A bot item's product comes from what it links: a pull request's workspace or repo, or a Dispatch's
workspace. An item that links nothing takes the product the bot's other items work in.
| `gh pr list -R <repo> --state open --json …` | pull requests, checks, reviews |
| `gh run list -R <repo> --limit 1 --json …` | latest Actions run |

GitHub data comes only through your locally installed and signed-in `gh`. The plugin holds no
tokens.

### Answering from the panel

What Orca 1.4.271 offers the **owner** to answer, checked before building this:

- **Decision gates** (`orca orchestration gate-create` by a coordinator): `orca orchestration
  gate-resolve` resolves one. The plugin's worker runs it with no `--from`, outside any agent
  session, so it acts as you. Each gate in *Needs you* shows its options as buttons and a short
  text box; pressing one shows *Send '<answer>' to the coordinator?* with **Confirm** / **Cancel**,
  and only Confirm sends. The result (sent, or why not) shows inline. Before sending, the worker
  checks again that the setting is on, that the gate is still one waiting on you in its latest
  reading, and that the answer is non-empty and under 2,000 characters.
- **Bot items**: no owner path. Every `orca bot item` write (`comment`, `set`, ...) acts as the
  *bot* from its own chat, and the plugin host API has no bot or item methods, so the panel does
  not pretend: an item's options are plain text and one button opens the bot's chats, where you
  answer. No composer or prefill method exists either, so the choice cannot be typed in for you.

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
| `trusted-worker` | a Node worker runs the `orca` and `gh` commands above: reads, plus `gate-resolve` after you confirm (no extra Orca capability is needed for it) |
| `workspace:read` | hear workspace created/removed events to refresh early |
| `agent:read` | hear agent status changes to refresh early |
| `workspace:write` | **only** `terminal.focus` and `workspace.open`, so a click can take you to an agent. Nothing renames, hides or runs commands |
| `notifications:show` | the stuck-agent alarm and site down / back notifications |
| `storage:own` | remember which alarms were already shown, and the panel's view, tab and open groups |
| `settings:own` | read the seven settings below |

## Settings

| Setting | Default |
| --- | --- |
| Notifications (stuck agents, sites going down or coming back) | on |
| Stuck threshold (minutes) | 15 |
| Active within (days): the Dashboard shows only projects with workspace activity in this many days (1–90) | 15 |
| Repos to watch on the Ship board (`owner/name`, comma separated) | empty = every GitHub repo behind your Orca projects |
| Sites to ping (`Name=https://url` or `Product:Name=https://url`, comma or newline separated, e.g. `Shop=https://shop.example.com, Alpha:Docs=https://docs.example.com`) | empty = no Sites group and no requests |
| Allow answering from the panel (decision gates, after a confirm) | on |
| Orca CLI path | empty = find it automatically |

## Install

Requires Orca ≥ 1.4.259 and, for the Ship board, the GitHub CLI (`gh auth login` done).

```sh
git clone https://github.com/gusainhimanshu/orca-control-room-plugin
orca plugin dev load ./orca-control-room-plugin      # prints what it would grant, and a fingerprint
orca plugin dev load ./orca-control-room-plugin --approve <fingerprint>
```

Then open **Control Room** in the right sidebar; **Dashboard** and **Details** switch its view.

## Development

No build step and no dependencies.

```sh
orca plugin validate .
orca plugin check .
orca plugin test .          # model, overview, platform, sites, deck and details tests (invented data, no real requests)
npx -y -p typescript@5.9.3 tsc -p . --noEmit  # type check
```

CI (`.github/workflows/ci.yml`, Ubuntu and Windows, Node LTS) runs without Orca: the type check
against a copy of Orca's generated types in `ci/orca-types/`, and the pure tests (model, overview,
platform, sites, deck, details) in plain Node through `ci/register.mjs`, which maps `orca/testing` to Node's `test` and
`assert`. Every test is pure, so CI runs all of them. After
upgrading Orca, refresh the copy: `orca plugin types . && cp -r .orca/types/. ci/orca-types/`.

- `src/model.ts`: pure data → view-model functions (tested in `src/model.test.ts`).
- `src/overview.ts`: the Overview's bots → workers → PRs model and its layout into tiers, rows and
  edges (tested in `src/overview.test.ts`).
- `src/sites.ts`: parsing *Sites to ping*, the ping itself (fetch injected) and up/degraded/down
  (tested in `src/sites.test.ts`).
- `src/sources.ts`: the command allow-list.
- `src/worker.ts`: polling, alarms, status bar, navigation.
- `src/deck.ts`: the Dashboard's keys: totals, product rows worst first, folded summary keys, bot
  keys, what a total outlines, the rows behind each key (`rowsBehind`), and arrow-key moves (tested
  in `src/deck.test.ts`).
- `src/dashboard.ts`: the wall of keys and its details drawer (HTML, drawn from `src/deck.ts`), started
  by `src/dashboard-editor.ts` as the full-page editor and by `src/wall.ts` as the first sidebar
  panel (an open drawer replaces the wall there, and on any page narrower than 520 px); in the
  panel it also switches to the Details view and remembers the view.
- `src/rows.ts`: the HTML rows both views draw (agents, needs-you items with the gate confirm, PRs,
  runs, sites, open work, messages, workers); buttons carry `data-act` indexes into `env.acts`, so
  they are tested without a DOM.
- `src/details.ts`: the Details view (Overview, Queue, Office, Flows, Ship) with its collapsible
  product groups (tested in `src/details.test.ts`).

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

Answering a bot item from the panel (Orca has no owner path for it yet), network calls beyond the site pings, coordinators that are not bots in the Overview, title-emoji parsing, an
external state file, an overlaps view. Agents Orca only remembers (no terminal or chat left)
are not shown.
