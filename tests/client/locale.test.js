import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createTranslator, detectEnvironmentLocale, dictionaries, dictionaryFor, en, formatMessage, zh } from '../../src/client/locale.js'

const withDocumentLang = (lang, run) => {
  const hadDocument = Object.prototype.hasOwnProperty.call(globalThis, 'document')
  const previous = globalThis.document
  if (lang === undefined) delete globalThis.document
  else globalThis.document = { documentElement: { lang } }
  try {
    return run()
  } finally {
    if (hadDocument) globalThis.document = previous
    else delete globalThis.document
  }
}

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
  assert.equal(english('view.title'), 'Free Groups')
  const chinese = createTranslator(() => ({ active: 'zh-CN' }))
  assert.equal(chinese('view.title'), '自由分组')
  const legacy = createTranslator(() => ({ id: 'en' }))
  assert.equal(legacy('view.title'), 'Free Groups')
  const broken = createTranslator(() => {
    throw new Error('boom')
  }, () => 'zh')
  assert.equal(broken('view.title'), '自由分组')
})

test('createTranslator falls back to the document language when the host service is absent', () => {
  withDocumentLang('en-US', () => {
    const english = createTranslator(() => null)
    assert.equal(english('onboarding.title'), 'Welcome to Free Groups')
    assert.equal(english('dialog.newGroup'), 'New group')
  })
  withDocumentLang('zh-CN', () => {
    const chinese = createTranslator(() => null)
    assert.equal(chinese('onboarding.title'), '欢迎使用自由分组')
  })
})

test('host snapshot wins over the document fallback', () => {
  withDocumentLang('zh-CN', () => {
    assert.equal(createTranslator(() => ({ active: 'en' }))('view.title'), 'Free Groups')
  })
  withDocumentLang('en-US', () => {
    assert.equal(createTranslator(() => ({ active: 'zh' }))('view.title'), '自由分组')
  })
})

test('detectEnvironmentLocale uses document lang then navigator language', () => {
  withDocumentLang('en-GB', () => assert.equal(detectEnvironmentLocale(), 'en-GB'))
  withDocumentLang(undefined, () => {
    const detected = detectEnvironmentLocale()
    assert.equal(typeof detected, 'string')
    assert.ok(detected.length > 0)
  })
})

test('dictionaryFor handles en prefixes and defaults to zh', () => {
  assert.equal(dictionaryFor('en'), dictionaries.en)
  assert.equal(dictionaryFor('en-GB'), dictionaries.en)
  assert.equal(dictionaryFor('zh-Hans'), dictionaries.zh)
  assert.equal(dictionaryFor(undefined), dictionaries.zh)
})
