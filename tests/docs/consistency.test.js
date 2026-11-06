import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', '..')
const read = (file) => readFileSync(resolve(root, file), 'utf8')
const json = (file) => JSON.parse(read(file))

test('current version is consistent across package, manifest, constants and lockfile', () => {
  const version = json('package.json').version
  assert.equal(json('dsh.plugin.json').version, version)
  assert.equal(json('package-lock.json').version, version)
  assert.equal(json('package-lock.json').packages[''].version, version)
  assert.match(read('src/shared/constants.js'), new RegExp(`PLUGIN_VERSION = '${version.replaceAll('.', '\\.')}'`))
})

test('all packaged locale dictionaries are complete and aligned', () => {
  const files = readdirSync(resolve(root, 'locale')).filter((name) => name.endsWith('.json')).sort()
  assert.equal(files.length, 19)
  const reference = Object.keys(JSON.parse(readFileSync(resolve(root, 'locale', 'en.json'), 'utf8'))).sort()
  assert.equal(reference.length, 292)
  for (const file of files) {
    const keys = Object.keys(JSON.parse(readFileSync(resolve(root, 'locale', file), 'utf8'))).sort()
    assert.deepEqual(keys, reference, file)
  }
})

test('current release note exists and TEST-MATRIX/CHANGELOG/bundle name the current version', () => {
  const version = json('package.json').version
  const escaped = version.replaceAll('.', '\\.')
  assert.ok(readdirSync(resolve(root, 'docs/release-notes')).includes(`v${version}.md`))
  assert.match(read('docs/TEST-MATRIX.md'), new RegExp(`Status: \`${escaped}\``))
  assert.match(read('CHANGELOG.md'), new RegExp(`## ${escaped} `))
  assert.match(read('lib/client.js'), new RegExp(`PLUGIN_VERSION = "${escaped}"`))
})
