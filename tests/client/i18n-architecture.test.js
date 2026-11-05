import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  )
const read = (file) => readFileSync(file, 'utf8')
const rel = (file) => relative(root, file).replaceAll('\\', '/')

const clientFiles = walk(join(root, 'src', 'client')).filter((file) => file.endsWith('.js'))
const coreFiles = walk(join(root, 'src', 'core')).filter((file) => file.endsWith('.js'))
// All client UI/logic modules are in scope except the i18n implementation and
// its compatibility facade. This intentionally includes dialog-host.js,
// session-menu.js, plugin.js and the smaller components.
const uiFiles = clientFiles.filter((file) => {
  const path = rel(file)
  return !path.startsWith('src/client/i18n/') && path !== 'src/client/locale.js'
})

test('all client UI modules avoid locale resources, i18n internals and plural rules', () => {
  assert.ok(uiFiles.length >= 30, `expected full client UI scan, got ${uiFiles.length} files`)
  for (const file of uiFiles) {
    const source = read(file)
    assert.doesNotMatch(source, /locale\/.*\.json|i18n\//, file)
    assert.doesNotMatch(source, /Intl\.(?:PluralRules|Locale|DateTimeFormat)|\btoLocale[A-Z]/, file)
  }
})

test('src/core stays free of locale dictionaries, Intl and locale-sensitive formatting', () => {
  for (const file of coreFiles) {
    const source = read(file)
    assert.doesNotMatch(source, /locale\/.*\.json|i18n\//, file)
    assert.doesNotMatch(source, /\bIntl\.|\btoLocale[A-Z]/, file)
  }
})

test('locale JSON imports live only in the i18n resource modules', () => {
  const importers = clientFiles.filter((file) => /locale\/[^'"]+\.json/.test(read(file)))
  assert.deepEqual(importers.map(rel).sort(), ['src/client/i18n/resources-lazy.js', 'src/client/i18n/resources.js'])
})

test('the locale facade stays a thin re-export surface', () => {
  const facade = read(join(root, 'src', 'client', 'locale.js'))
  assert.doesNotMatch(facade, /Intl\.|\btoLocale[A-Z]|locale\/.*\.json/)
  assert.match(facade, /from '\.\/i18n\/resources\.js'/)
  assert.match(facade, /from '\.\/i18n\/translator\.js'/)
  assert.match(facade, /from '\.\/i18n\/direction\.js'/)
})
