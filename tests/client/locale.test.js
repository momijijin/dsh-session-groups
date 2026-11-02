import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createTranslator, dictionaries, dictionaryFor, en, formatMessage, zh } from '../../src/client/locale.js'

test('zh and en dictionaries have identical key sets', () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  assert.ok(Object.keys(zh).length > 60)
})

test('locale JSON files mirror the dictionaries', () => {
  const zhJson = JSON.parse(readFileSync(new URL('../../locale/zh.json', import.meta.url), 'utf8'))
  const enJson = JSON.parse(readFileSync(new URL('../../locale/en.json', import.meta.url), 'utf8'))
  assert.deepEqual(zhJson, zh)
  assert.deepEqual(enJson, en)
})

test('formatMessage substitutes {name} placeholders and falls back to keys', () => {
  assert.equal(formatMessage(zh, 'group.sessionCount', { n: 3 }), '3 个会话')
  assert.equal(formatMessage(en, 'group.sessionCount', { n: 3 }), '3 sessions')
  assert.equal(formatMessage(zh, 'missing.key'), 'missing.key')
  assert.equal(formatMessage(zh, 'group.sessionCount'), '{n} 个会话')
})

test('createTranslator follows the host locale snapshot active field', () => {
  const english = createTranslator(() => ({ active: 'en-US' }))
  assert.equal(english('view.title'), 'Free groups')
  const chinese = createTranslator(() => ({ active: 'zh-CN' }))
  assert.equal(chinese('view.title'), '自由分组')
  const legacy = createTranslator(() => ({ id: 'en' }))
  assert.equal(legacy('view.title'), 'Free groups')
  const broken = createTranslator(() => {
    throw new Error('boom')
  })
  assert.equal(broken('view.title'), '自由分组')
})

test('dictionaryFor handles en prefixes and defaults to zh', () => {
  assert.equal(dictionaryFor('en'), dictionaries.en)
  assert.equal(dictionaryFor('en-GB'), dictionaries.en)
  assert.equal(dictionaryFor('zh-Hans'), dictionaries.zh)
  assert.equal(dictionaryFor(undefined), dictionaries.zh)
})
