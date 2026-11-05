import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../..', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (match) => match.slice(1))
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  )
const read = (file) => readFileSync(file, 'utf8')

const clientFiles = walk(join(root, 'src', 'client')).filter((file) => file.endsWith('.js'))
const coreFiles = walk(join(root, 'src', 'core')).filter((file) => file.endsWith('.js'))
const uiFiles = clientFiles.filter((file) => /components[^/\\]*\.js$/.test(file) || file.endsWith(join('client', 'main-session-view.js')))

test('UI modules do not import locale resources, i18n internals or plural rules', () => {
  for (const file of uiFiles) {
    const source = read(file)
    assert.doesNotMatch(source, /locale\/.*\.json|i18n\/resources|i18n\/message-format|Intl\.PluralRules/, file)
    assert.doesNotMatch(source, /from ['"]\.\/i18n\//, file)
  }
})

test('src/core stays free of locale dictionaries and Intl plural selection', () => {
  for (const file of coreFiles) {
    const source = read(file)
    assert.doesNotMatch(source, /locale\/.*\.json|Intl\.PluralRules|from ['"]\.\.\/client\/i18n/, file)
  }
})

test('locale JSON imports live only in the i18n resources module', () => {
  const importers = clientFiles.filter((file) => /locale\/[^'"]+\.json/.test(read(file)))
  assert.deepEqual(
    importers.map((file) => file.slice(root.replace(/[\\/]$/, '').length + 1).replaceAll('\\', '/')),
    ['src/client/i18n/resources.js'],
  )
})

test('the locale facade stays a thin re-export surface', () => {
  const facade = read(join(root, 'src', 'client', 'locale.js'))
  assert.doesNotMatch(facade, /Intl\.PluralRules|locale\/.*\.json/)
  assert.match(facade, /from '\.\/i18n\/resources\.js'/)
  assert.match(facade, /from '\.\/i18n\/translator\.js'/)
})
