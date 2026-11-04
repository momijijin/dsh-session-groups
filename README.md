# dsh-session-groups

[English](README.md) | [中文](README.zh.md)

A free-form grouping layer over the shipped DSH Desktop workspace/session sidebar. Official workspace and session management remain authoritative: each session keeps its workspace membership and log, while this plugin stores a separate group assignment. A group can therefore contain sessions from different workspaces.

- assigning a session to a group changes only this plugin's group record and its placement in the Free groups view;
- official workspace membership, the workspace registry and session logs are never changed;
- session titles and archive state change only through explicit user actions or the opt-in `controlSessions` API;
- `workspace.json` is never written.

Current version: **0.3.0-beta.69**  
Tested baseline: DSH Desktop 2.0.18 / `@deepseek-ai/dsh` 0.2.1-rc.2

See [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) for the `engines.dsh` range, the `dsh-0.2` adapter selector and runtime capability checks.

### Platform support

The runtime is platform-neutral JavaScript. It does not invoke PowerShell and has no `process.platform` or `child_process` branches in `src/`. The PowerShell files under `scripts/qa/` are maintainer-only test harnesses and are not shipped in the npm package.

Current verification status:

| Platform | Node/unit tests | Build/package | Real DSH UI |
|---|---|---|---|
| Windows | verified locally | verified locally | verified locally |
| Linux | verified by GitHub Actions | verified by GitHub Actions | not verified |
| macOS | not verified | not verified | not verified |

The current CI is an Ubuntu Node-level gate, not a cross-platform certification. Treat Linux/macOS DSH UI support as experimental until a real host/UI pass exists. Ordinary users install through dshmarket; the local tarball and CLI are maintainer/debug paths only.

## Features

### View

- switch between Free groups and the shipped Workspace view;
- drag-resize the sidebar from 264px to 80% of the viewport (default 420px);
- double-click the resize handle to restore the default width;
- persist view mode, width, collapsed groups, archive filter and dialog geometry.

### Groups

- create root groups and up to 8 nested levels;
- rename, change icon, choose a palette color or a custom `#RRGGBB`;
- drag to reorder, reparent and carry the subtree;
- move-up/move-down menu fallback;
- collapse and expand;
- delete an empty leaf directly;
- choose destinations for child sessions and child groups before deleting a non-empty group;
- create a session inside a group (choose a workspace when needed).

### Sessions

- assign sessions from different workspaces to the same group;
- drag a session out of a group back to Ungrouped;
- open, rename, archive/unarchive and assign to a group;
- hover archive/unarchive action;
- session menu fork and Copy Session ID;
- fork uses the last completed turn and places the child at the head of the source group (or at the top of Ungrouped when the source is ungrouped);
- official session status rendering;
- virtualized Ungrouped list.

### Search and filters

- search session titles, workspaces and group paths;
- selecting a result expands ancestors, scrolls to the row and highlights it;
- archived results are dimmed and cannot be opened;
- archive tri-state: hidden / all / archived only.

### Header status

Three statistics buttons only:

- **Running** (spinner);
- **Waiting for input** (pause);
- **Unread** (mail).

Each popover lists sessions grouped by group and opens a session on click.  
Running / waiting / unread are mutually exclusive primary states; background job counts are not included.

### Dialogs

- draggable title bar and eight-direction resize;
- backdrop click does not close; Cancel/Escape closes;
- compact layout using theme tokens;
- 5px custom draggable scrollbar without fade arrows.

### First run

A one-time card explains that groups only change display placement and how to create groups and drag sessions. The card can be dismissed and its state is stored in `localStorage`. When there are no groups and no sessions, an empty-state action creates the first group.

### View options

The top-right view options contain:

- archive tri-state;
- **Reset layout**: restores sidebar width, expansion and dialog geometry without touching group data;
- version and scope information.

## Installation

### dshmarket (recommended)

Install from **dshmarket** and search for:

```text
dsh-session-groups
```

The market entry is being prepared. Once it is listed, install and update the plugin entirely through dshmarket; users should not need a local path or a terminal command.

Updates are owned by dshmarket / the plugin manager. The plugin does not self-update and does not know where its next version is hosted. If you previously installed a local tarball, reinstall once from the market so the installed source is bound to the catalog.

### Maintainer/developer install

Local tarball and command-line installation are maintainer/debug workflows only. They are documented in [docs/RELEASE.md](docs/RELEASE.md); ordinary users should use the market entry.

## Data

The group record is stored at:

```text
<dshHome>/storages/dsh-session-groups.json
```

- writes use revision comparison and a serialized queue;
- conflicts load the latest revision;
- a corrupt record is quarantined first; a valid `.bak` is restored automatically, otherwise the plugin starts with an empty document;
- a single-slot `.bak` is kept before successful commits;
- official workspace and session data are never written.

Local UI preferences:

- `dsh-session-groups.view.v1`
- `dsh-session-groups.archive.v1`
- `dsh-session-groups.collapsed.v1`
- `dsh-session-groups.width.v1`
- `dsh-session-groups.onboarded.v1`
- `dsh-session-groups.dialog.geometry.v9`

Uninstalling the plugin restores the shipped workspace view. The group record and local preferences remain and are restored on reinstall. To remove all traces, delete the record, `.bak` and the localStorage keys above.

## Configuration

The plugin manager exposes five switches, all off by default. They live on the first layer of the **Plugins → dsh-session-groups** detail page; no component-row drill-down is needed. All controls use the standard DSH `Switch` and `Tooltip`.

| Setting | Default | Effect |
|---|---|---|
| `diagnostics` | off | drag HUD and local NDJSON trace; applies live |
| `debugProbe` | off | temporary dialog layout probe and `.debug.ndjson` route; never enable in production |
| `controlApi` | off | master switch for the native `session_groups_control` tool and browser/debug control routes |
| `controlDestructive` | off | allow destructive control operations such as group deletion; requires explicit confirmation |
| `controlSessions` | off | allow session rename and archive changes; requires `controlApi` |

`debugProbe` routes stay registered but return `404 debug-disabled` when off and never write a debug file.  
`diagnostics` routes stay registered but reject writes when off; enabling/disabling updates the client HUD on the next configuration refresh.  
`controlApi` routes stay registered but return `404 control-disabled` when off; when enabled they are local-only and still use the host connection fence.  
Background job monitoring was rolled back in 0.3.0-beta.1; the plugin does not subscribe to `ctx.jobs`.

## Settings card

- the configuration card is rendered on the first layer of the plugin detail page;
- all five options have `[ⓘ]` details covering behavior, when to enable, security impact and side effects;
- `controlDestructive` is not a plain switch: enabling it opens a dangerous-action confirmation and requires an explicit "I understand the risk" click;
- the second-layer component rows keep source/status metadata only.

## AI control

The primary AI channel is the Host-native tool:

```text
session_groups_control
```

It runs in the DSH Host process, without HTTP, a browser cookie, the control token or the CLI. `controlApi` must be enabled; `controlSessions` controls session rename/archive; `controlDestructive` controls deletion.

After every group commit (native tool or HTTP), the Host publishes the new revision through `/dsh-session-groups/events`; browsers reload and reconcile. Returning to the groups view also reloads the latest snapshot.

`doctor` is a read-only compatibility diagnostic available even when `controlApi` is off. It returns host capabilities, adapter/version range, control gates, storage paths, storage health (status/revision, backupStatus/backupRevision/backupError, quarantine), service presence and mounted routes.

Tool actions:

```text
state
resolve
plan
apply
session_inspect
session_rename
session_archive
doctor
```

`state` returns a stable `revision`, each group's `id`/`path`/icon/color and sessionIds.  
`resolve` maps a complete path array to an id; missing paths return `group-not-found`, duplicate siblings return `ambiguous-path` with candidates.  
`plan` returns `changes` and `planHash`; `apply` must send the same `planHash` and `baseRevision` and commits with CAS.

Session actions require an explicit `sessionId`; a missing id is `invalid-session-id` and the plugin never guesses the "most recent" session. Rename supports `expectedTitle`; archive supports `expectedArchived`; archiving a running session requires explicit `stopActivity: true`.

### Copy-paste AI prompts

Enable **AI control API** first; the rename prompt also needs **session operations**. No CLI, HTTP request, cookie or token is involved — paste the prompt into a DSH session and let the agent call `session_groups_control`.

#### Batch-create a project hierarchy

> Use `session_groups_control` to create (or reuse) this hierarchy:
>
> `<Project> project group` — icon `server`, color `blue`
> - `Designing` — icon `book`, color `purple`
> - `In development` — icon `play-circle`, color `blue`
> - `Paused` — icon `clock`, color `orange`
> - `Done` — icon `check-circle`, color `green`
> - `Cancelled` — icon `x-circle`, color `red`
>
> Reuse existing groups and add only missing children. Run `state`/`resolve` first; if a path is missing or ambiguous, ask me. Then `plan`, show me the changes and `planHash`, and `apply` with the same `planHash` and `baseRevision`.

#### Rename and assign in one instruction

> Rename the current session to `<new title>` and assign it to `<Project> project group / In development` using `session_groups_control`. Use the current session's explicit `sessionId`; never guess it. Rename first, then plan/apply `session.assign`. If either step fails, stop and report which step failed. This is two sequential operations, not one transaction.

### HTTP routes (browser/debug)

These routes are for browser settings pages and local debugging, not the primary AI path:

```text
GET  /dsh-session-groups/control/doctor
GET  /dsh-session-groups/control/state
POST /dsh-session-groups/control/resolve
POST /dsh-session-groups/control/plan
POST /dsh-session-groups/control/apply
POST /dsh-session-groups/control/session/inspect
POST /dsh-session-groups/control/session/rename
POST /dsh-session-groups/control/session/archive
```

The real DSH Desktop host browser fence runs before plugin routes. The CLI exchanges the DSH web cookie using `DSH_WEB_URL` (including `?token=`) and then sends the plugin Bearer token. `doctor` works while `controlApi` is off; other control routes remain behind their own gates:

```powershell
$env:DSH_HOME = "$env:USERPROFILE\.dsh"
$env:DSH_WEB_URL = "http://127.0.0.1:43120/?token=token-printed-at-startup"
node scripts/session-groups-control.mjs doctor
```

The native tool remains the primary AI path; the CLI is only for local read-only diagnosis and debugging. `doctor` exits non-zero when host compatibility is unsupported, so it can gate pre/post-upgrade scripts.

`group.create` plan results do not contain a `groupId`: ids are generated only during apply; call `state` afterwards to read them.

The plugin writes a local control token at:

```text
<dshHome>/storages/dsh-session-groups.control-token
```

The POSIX mode is `0600`. Windows does not enforce POSIX modes as ACLs; on a multi-user machine verify the effective ACL separately. When `controlApi` is off, control routes other than `doctor` still return 404; the token cannot bypass the host browser fence.

The bundled skill is `skills/session-groups-control/SKILL.md`. When `controlApi` is enabled, the plugin installs it to `<dshHome>/skills/session-groups-control/SKILL.md`; the settings card can verify or repair a missing/damaged managed skill without reinstalling the plugin. A user-owned file with the same name is never overwritten.

Diagnostics are written to:

```text
<dshHome>/storages/dsh-session-groups.diagnostics.ndjson
```

Only while `diagnostics` is on. It contains drag events, ids and timings, never session transcripts. The file is not rotated automatically.

## Language

- follows the host language; there is no plugin-level language switch;
- registers `zh` and `en`; other locale JSON files are kept as future resources and are not added to the host locale catalog automatically;
- only languages implemented by the host are enabled; user-created group, session and workspace names are never translated.

## Known limitations

- header status counts only sessions that are explicitly grouped or explicitly ungrouped; derived ungrouped sessions are not counted;
- group, collapsed and dialog state are per-window; multi-window conflicts show 409 and are not merged live;
- search returns at most 20 matches and matches titles/workspaces/group paths only;
- the width override depends on the DSH sidebar DOM; if the host changes the layout it fails soft and group functionality is unaffected;
- dialog drag/resize uses pointer input; there is no keyboard move/resize;
- writes use an in-process queue plus a short-lived `<record>.lock` file for cross-process serialization; stale locks are reclaimed after the owner PID dies or the lock is 30 seconds old;
- large-list lazy rendering remains deferred; the current Ungrouped list is virtualized, but a collapsed subtree is still built by `buildRenderTree`;
- the dshmarket catalog entry is not published yet; local tarball installs are for the beta period;
- current release validation is **450 unit/contract tests** plus the user's real desktop pass; `e2e/groups.spec.mjs` is a historical manual script, while the default automated A+ is `e2e/isolated.spec.mjs`.

## Documentation

- [Current documentation index](docs/INDEX.md)
- [Compatibility policy](docs/COMPATIBILITY.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Release and verification](docs/RELEASE.md)
- [Test results](docs/TEST-RESULTS.md)

Historical V1/V1.1 contracts and plans are indexed separately and are not current behavior.

## Development

```powershell
npm test
npm run check:coverage
npm run build
node --check lib/client.js
npm pack
```

- `npm test`: 450 unit/contract tests;
- `npm run check:coverage`: Node built-in coverage (currently about 93.54% lines / 82.16% branches / 88.65% functions, `src/**` scope);
- layers: `src/core` is the pure-function core and `src/adapters` holds DSH-version-specific adapters; see `docs/ARCHITECTURE.md`;
- `npm run check:all`: syntax check plus the test suite;
- `npm run check:core`: load and test `src/core` without DSH;
- `scripts/qa/clean-profile.ps1`: isolated profile install/uninstall validation, never the real `~/.dsh`;
- `scripts/qa/lifecycle-isolated.ps1`: isolated install → uninstall → reinstall with record hash preservation;
- `scripts/qa/start-isolated-web.ps1` + `npm run test:isolated`: A+ isolated Playwright smoke, including two-window concurrent CAS;
- build artifact: `lib/client.js`;
- package: `dsh-session-groups-0.3.0-beta.69.tgz`;
- release steps: `docs/RELEASE.md`;
- test summary: `docs/TEST-RESULTS.md`.

## License

MIT. See [LICENSE](LICENSE).
