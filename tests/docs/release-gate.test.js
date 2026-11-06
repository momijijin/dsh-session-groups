import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { checkRelease } from '../../scripts/qa/check-release.mjs'

/**
 * Release gate tests.
 *
 * The happy path runs the real CLI against this repository. Error branches run
 * the exported `checkRelease()` against throwaway package roots under the OS
 * temp directory, so no repository file is touched. Fixtures are intentionally
 * left in place (the workspace deletion rules forbid removing them here).
 */

const root = resolve(import.meta.dirname, '..', '..')
const gateScript = join(root, 'scripts', 'qa', 'check-release.mjs')
const currentVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

const runCli = (cwd, env = {}) =>
  spawnSync(process.execPath, [gateScript], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_REF_NAME: '', ...env },
  })

const writeFixtureFile = (dir, relativePath, content) => {
  const file = join(dir, relativePath)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

const FIXTURE_VERSION = '1.2.3'

/**
 * Build a minimal package tree that the gate accepts, with per-check overrides.
 * Every call creates a fresh temp directory; nothing is written into the repo.
 */
const makeFixture = ({
  version = FIXTURE_VERSION,
  manifestVersion = version,
  constantsVersion = version,
  lockVersion = version,
  lockRootVersion = version,
  clientVersion = version,
  files = ['lib/client.js'],
  releaseNote = true,
} = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsg-release-gate-'))
  writeFixtureFile(dir, 'package.json', JSON.stringify({ name: 'fixture-grove', version, files }, null, 2))
  writeFixtureFile(
    dir,
    'dsh.plugin.json',
    JSON.stringify({ id: 'fixture-grove', version: manifestVersion }, null, 2),
  )
  writeFixtureFile(
    dir,
    'package-lock.json',
    JSON.stringify(
      {
        name: 'fixture-grove',
        version: lockVersion,
        lockfileVersion: 3,
        packages: { '': { name: 'fixture-grove', version: lockRootVersion } },
      },
      null,
      2,
    ),
  )
  writeFixtureFile(dir, 'src/shared/constants.js', `export const PLUGIN_VERSION = '${constantsVersion}'\n`)
  writeFixtureFile(dir, 'lib/client.js', `var PLUGIN_VERSION = "${clientVersion}";\n`)
  if (releaseNote) {
    writeFixtureFile(dir, `docs/release-notes/v${version}.md`, `# ${version}\n`)
  }
  return dir
}

test('the repository tree passes the release gate', () => {
  const result = runCli(root)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /release check: OK/)
  assert.ok(result.stdout.includes(`release check: dsh-session-grove ${currentVersion}`))
  assert.match(result.stdout, /tag: not checked \(GITHUB_REF_NAME is not set\)/)
})

test('the CLI accepts a matching v<version> tag', () => {
  const result = runCli(root, { GITHUB_REF_NAME: `v${currentVersion}` })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, new RegExp(`tag: v${currentVersion.replaceAll('.', '\\.')} matches GITHUB_REF_NAME`))
})

test('a complete fixture tree passes and prints every check', () => {
  const result = checkRelease({ root: makeFixture(), env: { GITHUB_REF_NAME: `v${FIXTURE_VERSION}` } })
  assert.equal(result.ok, true)
  assert.deepEqual(result.errors, [])
  assert.ok(result.summary.some((line) => line.startsWith('versions:')))
  assert.ok(result.summary.includes(`release note: docs/release-notes/v${FIXTURE_VERSION}.md`))
  assert.ok(result.summary.includes(`bundle: lib/client.js carries PLUGIN_VERSION = "${FIXTURE_VERSION}"`))
  assert.ok(result.summary.includes('packaged paths: 1/1 exist'))
})

test('reports every version source that disagrees with package.json', () => {
  const result = checkRelease({
    root: makeFixture({
      manifestVersion: '1.2.4',
      constantsVersion: '1.2.4',
      lockVersion: '1.2.4',
      lockRootVersion: '1.2.4',
      clientVersion: '1.2.4',
    }),
  })
  assert.equal(result.ok, false)
  const joined = result.errors.join('\n')
  assert.match(joined, /dsh\.plugin\.json: version "1\.2\.4" does not match package\.json "1\.2\.3"/)
  assert.match(joined, /src\/shared\/constants\.js: version "1\.2\.4"/)
  assert.match(joined, /package-lock\.json: version "1\.2\.4"/)
  assert.match(joined, /package-lock\.json packages\[""\]: version "1\.2\.4"/)
  assert.match(joined, /lib\/client\.js: missing PLUGIN_VERSION = "1\.2\.3"/)
  assert.ok(result.errors.length >= 5, `expected at least 5 errors, got ${result.errors.length}`)
})

test('rejects a tag that does not match the package version', () => {
  const result = checkRelease({ root: makeFixture(), env: { GITHUB_REF_NAME: 'v9.9.9' } })
  assert.equal(result.ok, false)
  assert.match(
    result.errors.join('\n'),
    /GITHUB_REF_NAME: tag "v9\.9\.9" must be "v1\.2\.3" for package version 1\.2\.3/,
  )
})

test('requires a release note for the current version', () => {
  const result = checkRelease({ root: makeFixture({ releaseNote: false }) })
  assert.equal(result.ok, false)
  assert.ok(
    result.errors.some((error) => error.includes('docs/release-notes/v1.2.3.md: release note missing')),
    result.errors.join('\n'),
  )
})

test('requires the built client bundle to carry the current version', () => {
  const result = checkRelease({ root: makeFixture({ clientVersion: '1.2.2' }) })
  assert.equal(result.ok, false)
  assert.ok(
    result.errors.some((error) => error.includes('PLUGIN_VERSION = "1.2.3"')),
    result.errors.join('\n'),
  )
})

test('rejects packaged paths that do not exist', () => {
  const result = checkRelease({ root: makeFixture({ files: ['lib/client.js', 'docs/missing.md'] }) })
  assert.equal(result.ok, false)
  assert.ok(
    result.errors.some((error) => error.includes('packaged path "docs/missing.md" does not exist')),
    result.errors.join('\n'),
  )
})

test('the CLI exits non-zero and lists every failure', () => {
  const dir = makeFixture({ manifestVersion: '1.2.4', clientVersion: '1.2.2', releaseNote: false })
  const result = runCli(dir, { GITHUB_REF_NAME: 'v9.9.9' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /release check: FAILED/)
  assert.match(result.stderr, /dsh\.plugin\.json/)
  assert.match(result.stderr, /GITHUB_REF_NAME/)
  assert.match(result.stderr, /release note missing/)
  assert.match(result.stderr, /lib\/client\.js/)
})
