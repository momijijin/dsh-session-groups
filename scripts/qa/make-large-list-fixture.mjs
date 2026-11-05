#!/usr/bin/env node
// scripts/qa/make-large-list-fixture.mjs
//
// Turn a freshly seeded disposable QA home into the 0.2.3 large-list fixture:
//   * clone N valid synthetic ROOT sessions into one workspace (reusing the
//     harness's proven make-fixtures.mjs rewriter), so the ungrouped inbox holds
//     ~1,500 logical rows;
//   * seed two small groups (one nested) so the probe also exercises the
//     "groups stay intact below" layout and a real drag target;
//   * store one real, uniquely-titled session at the end of the ungrouped list
//     (the record's `ungrouped` tail renders after derived rows) so search can
//     reveal a row that starts far outside the window.
//
// Usage:
//   node scripts/qa/make-large-list-fixture.mjs \
//     --home .spike-homes/qa-0.2.3-large --extra 1500
//
// The script only writes inside the supplied disposable QA home (the real
// `~/.dsh` is never touched) and never removes files.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = { home: null, extra: 1500, groups: true }
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index]
  const next = () => process.argv[++index]
  if (key === '--home') args.home = next()
  else if (key === '--extra') args.extra = Number(next())
  else if (key === '--no-groups') args.groups = false
  else throw new Error(`unknown argument: ${key}`)
}
if (!args.home) throw new Error('--home is required')
const home = resolve(args.home)
const workspacePath = join(home, 'storages', 'workspace.json')
const sessionsRoot = join(home, 'sessions')
const groupPath = join(home, 'storages', 'dsh-session-grove.json')
const fixturePath = join(home, 'storages', 'large-list-fixture.json')
if (!existsSync(workspacePath)) throw new Error(`workspace.json not found under ${home}; run scripts/qa/setup.ps1 first`)
if (!existsSync(join(sessionsRoot))) throw new Error(`sessions/ not found under ${home}`)

if (args.extra > 0) {
  const result = spawnSync(process.execPath, [
    join(HERE, 'make-fixtures.mjs'),
    '--workspace-json', workspacePath,
    '--sessions-root', sessionsRoot,
    '--extra-per-workspace', String(args.extra),
  ], { stdio: ['ignore', 'ignore', 'inherit'] })
  if (result.status !== 0) throw new Error(`make-fixtures.mjs failed with exit ${result.status}`)
}

const doc = JSON.parse(readFileSync(workspacePath, 'utf8'))
const archived = new Set(doc?.global?.archivedSessionIds ?? [])
const workspaces = Object.values(doc?.tables?.workspaces ?? {})
const registry = []
for (const workspace of workspaces) {
  for (const id of workspace?.sessionIds ?? []) if (!archiveHas(id)) registry.push({ id, workspace })
}
function archiveHas(id) { return archived.has(id) }

// Real root sessions with a non-blank, uniquely-titled projection. Synthetic
// make-fixtures ids are intentionally ignored: their projection is a clone and
// many of them share one title.
const titles = new Map()
const real = []
for (const entry of registry) {
  if (entry.id.startsWith('session-00000000-') || entry.id.startsWith('session-10000000-')) continue
  const cachePath = join(home, 'storages', 'session_projcache', 'sessions', `${entry.id}.json`)
  if (!existsSync(cachePath)) continue
  try {
    const cache = JSON.parse(readFileSync(cachePath, 'utf8'))
    if (cache?.record?.rows?.sessionListMetadata?.val?.blank === true) continue
    const title = String(cache?.record?.rows?.title?.val ?? '').trim()
    if (!title) continue
    titles.set(title, (titles.get(title) ?? 0) + 1)
    real.push({ ...entry, title })
  } catch {
    /* unreadable projection cache: skip */
  }
}
const unique = real.filter((entry) => titles.get(entry.title) === 1 && existsSync(join(sessionsRoot, encodeWorkspaceDir(entry.workspace.path), entry.id)))
if (unique.length < 5) throw new Error(`need at least 5 uniquely-titled real root sessions for groups + search, got ${unique.length}`)

const grouped = args.groups ? unique.filter((entry) => !entry.id.startsWith('session-00000000-')).slice(0, 4) : []
const target = unique.find((entry) => !grouped.some((groupedEntry) => groupedEntry.id === entry.id))
if (!target) throw new Error('could not pick a search target outside the seeded groups')
const record = {
  version: 1,
  revision: 1,
  groups: args.groups
    ? [
        { id: 'g-large-a', name: 'Large A', icon: 'folder', parentId: null, sessionIds: grouped.slice(0, 2).map((entry) => entry.id) },
        { id: 'g-large-b', name: 'Large B', icon: 'folder', parentId: 'g-large-a', sessionIds: grouped.slice(2, 4).map((entry) => entry.id) },
      ]
    : [],
  ungrouped: [target.id],
}
writeFileSync(groupPath, JSON.stringify(record, null, 2), 'utf8')
const registryTotal = workspaces.reduce((sum, workspace) => sum + (workspace?.sessionIds?.length ?? 0), 0)
const fixture = {
  target: target.id,
  title: target.title,
  groups: record.groups,
  sessions: grouped.map((entry) => entry.id),
  registryTotal,
  archived: archived.size,
  note: 'target is a real root session stored at the end of doc.ungrouped; its projection cache is never edited',
}
writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), 'utf8')
console.log(JSON.stringify({
  extra: args.extra,
  registryTotal,
  archived: archived.size,
  groups: record.groups.length,
  target: target.id,
  title: target.title,
  fixture: fixturePath,
}))

function encodeWorkspaceDir(path) {
  const encoded = String(path).trim().replace(/^([A-Za-z]):/, '$1').replace(/[\\/]/g, '-')
  return `--${encoded}--`
}
