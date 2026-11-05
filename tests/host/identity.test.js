import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../..', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (match) => match.slice(1))
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8')
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  )

test('package, manifest and bundle use the dsh-session-grove identity', () => {
  const pkg = JSON.parse(read('package.json'))
  const manifest = JSON.parse(read('dsh.plugin.json'))
  const patch = read('cordis.patch.yml')
  assert.equal(pkg.name, 'dsh-session-grove')
  assert.equal(manifest.id, 'dsh-session-grove')
  assert.equal(manifest.name, 'dsh-session-grove')
  assert.match(patch, /id: dsh-session-grove/)
  assert.match(patch, /name: 'dsh-session-grove'/)
})

test('host paths and client namespaces use grove, not the legacy prefix', () => {
  const host = read('src', 'host', 'constants.js')
  assert.match(host, /BASE_PATH = '\/dsh-session-grove'/)
  assert.match(host, /RECORD_FILE_NAME = 'dsh-session-grove\.json'/)
  assert.match(host, /CONTROL_TOKEN_FILE_NAME = 'dsh-session-grove\.control-token'/)
  assert.match(host, /DIAGNOSTICS_FILE_NAME = 'dsh-session-grove\.diagnostics\.ndjson'/)

  const state = read('src', 'client', 'state.js')
  assert.match(state, /VIEW_MODE_KEY = 'dsh-session-grove\.view\.v1'/)
  assert.match(state, /ARCHIVE_FILTER_KEY = 'dsh-session-grove\.archive\.v1'/)

  const activeSources = [
    ...walk(join(root, 'src')),
    join(root, 'package.json'),
    join(root, 'dsh.plugin.json'),
    join(root, 'cordis.patch.yml'),
  ]
  for (const file of activeSources) {
    assert.equal(readFileSync(file, 'utf8').includes('dsh-session-groups'), false, `legacy identity in ${file}`)
  }
})

test('control skill and native tool use the grove names', () => {
  const skillDir = join(root, 'skills', 'session-grove-control')
  assert.equal(existsSync(skillDir), true)
  assert.equal(existsSync(join(root, 'skills', 'session-groups-control')), false)
  const skill = read('skills', 'session-grove-control', 'SKILL.md')
  assert.match(skill, /^---\r?\nname: session-grove-control/m)
  assert.match(skill, /session_grove_control/)
  const tool = read('src', 'host', 'tool.js')
  assert.match(tool, /TOOL_NAME = 'session_grove_control'/)
})

test('the rename does not add an automatic legacy-data migration', () => {
  // Intentional product decision for the identity reset: old files stay on
  // disk but are not read. A future migration must be an explicit feature.
  const activeSources = walk(join(root, 'src')).map((file) => readFileSync(file, 'utf8')).join('\n')
  assert.doesNotMatch(activeSources, /dsh-session-groups\.json/)
  assert.doesNotMatch(activeSources, /dsh-session-groups\.control-token/)
  assert.doesNotMatch(activeSources, /dsh-session-groups\.diagnostics/)
  assert.doesNotMatch(activeSources, /session-groups-control/)
})
