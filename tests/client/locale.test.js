import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  FALLBACK_LANGUAGE,
  baseLanguage,
  createTranslator,
  detectEnvironmentLocale,
  dictionaries,
  dictionaryFor,
  en,
  formatMessage,
  ja,
  zh,
} from '../../src/client/locale.js'

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

test('all packaged dictionaries have identical key sets', () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  assert.deepEqual(Object.keys(ja).sort(), Object.keys(en).sort())
  assert.ok(Object.keys(en).length > 60)
})

test('locale JSON files mirror the dictionaries', () => {
  for (const [language, dictionary] of Object.entries(dictionaries)) {
    const json = JSON.parse(readFileSync(new URL(`../../locale/${language}.json`, import.meta.url), 'utf8'))
    assert.deepEqual(json, dictionary)
  }
})

test('formatMessage substitutes {name} placeholders and falls back to keys', () => {
  assert.equal(formatMessage(zh, 'group.sessionCount', { n: 3 }), '3 个会话')
  assert.equal(formatMessage(en, 'group.sessionCount', { n: 3 }), '3 sessions')
  assert.equal(formatMessage(ja, 'group.sessionCount', { n: 3 }), ja['group.sessionCount'].replace('{n}', '3'))
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

test('dictionaryFor handles base language prefixes and falls back to English', () => {
  assert.equal(FALLBACK_LANGUAGE, 'en')
  assert.equal(baseLanguage('ja-JP'), 'ja')
  assert.equal(baseLanguage('zh_Hant_TW'), 'zh')
  assert.equal(baseLanguage(undefined), '')
  assert.equal(dictionaryFor('en'), dictionaries.en)
  assert.equal(dictionaryFor('en-GB'), dictionaries.en)
  assert.equal(dictionaryFor('zh-Hans'), dictionaries.zh)
  assert.equal(dictionaryFor('zh-TW'), dictionaries.zh)
  assert.equal(dictionaryFor('ja-JP'), dictionaries.ja)
  assert.equal(dictionaryFor('ko-KR'), dictionaries.en)
  assert.equal(dictionaryFor('unknown-language'), dictionaries.en)
  assert.equal(dictionaryFor(undefined), dictionaries.en)
})

test('a supported regional locale uses its base-language dictionary', () => {
  const japanese = createTranslator(() => ({ active: 'ja-JP' }))
  assert.equal(japanese('view.title'), ja['view.title'])
  assert.equal(japanese('onboarding.title'), ja['onboarding.title'])
})

test('an unsupported host locale follows the English fallback instead of Chinese', () => {
  const korean = createTranslator(() => ({ active: 'ko-KR' }))
  assert.equal(korean('view.title'), 'Free Groups')
  assert.equal(korean('onboarding.title'), 'Welcome to Free Groups')
})
