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
  de,
  en,
  es,
  formatMessage,
  fr,
  ja,
  pl,
  pt,
  tr,
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

test('formatMessage selects plural categories by language', () => {
  const plural = { one: '{n} item', other: '{n} items' }
  assert.equal(formatMessage({ count: plural }, 'count', { n: 1 }, 'en'), '1 item')
  assert.equal(formatMessage({ count: plural }, 'count', { n: 2 }, 'en'), '2 items')
  assert.equal(formatMessage({ count: plural }, 'count', { n: 1 }, 'ja'), '1 items')
  assert.equal(formatMessage({ count: plural }, 'count', { n: 2 }, 'zh'), '2 items')
  assert.equal(formatMessage({ count: plural }, 'count', {}, 'en'), '{n} items')
})

test('formatMessage supports CLDR categories beyond one/other', () => {
  const polish = { one: '{n} element', few: '{n} elementy', many: '{n} elementów', other: '{n} elementu' }
  const dict = { count: polish }
  assert.equal(formatMessage(dict, 'count', { n: 1 }, 'pl'), '1 element')
  assert.equal(formatMessage(dict, 'count', { n: 2 }, 'pl'), '2 elementy')
  assert.equal(formatMessage(dict, 'count', { n: 5 }, 'pl'), '5 elementów')
  assert.equal(formatMessage(dict, 'count', { n: 1.5 }, 'pl'), '1.5 elementu')
})

test('packaged count strings use plural templates', () => {
  assert.equal(formatMessage(en, 'group.sessionCount', { n: 1 }, 'en'), '1 session')
  assert.equal(formatMessage(en, 'group.sessionCount', { n: 2 }, 'en'), '2 sessions')
  assert.equal(formatMessage(de, 'group.sessionCount', { n: 1 }, 'de'), '1 Sitzung')
  assert.equal(formatMessage(fr, 'group.sessionCount', { n: 1 }, 'fr'), '1 session')
  assert.equal(formatMessage(es, 'group.sessionCount', { n: 1 }, 'es'), '1 sesión')
  assert.equal(formatMessage(pt, 'group.sessionCount', { n: 1 }, 'pt'), '1 sessão')
  assert.equal(formatMessage(pl, 'group.sessionCount', { n: 2 }, 'pl'), '2 sesje')
  assert.equal(formatMessage(pl, 'group.sessionCount', { n: 5 }, 'pl'), '5 sesji')
  assert.equal(formatMessage(tr, 'group.sessionCount', { n: 2 }, 'tr'), '2 oturum')
  assert.equal(formatMessage(ja, 'group.sessionCount', { n: 2 }, 'ja'), '2 件のセッション')
})

test('time unit strings use plural templates where the language needs them', () => {
  assert.equal(formatMessage(fr, 'time.years', { n: 1 }, 'fr'), 'il y a 1 an')
  assert.equal(formatMessage(fr, 'time.years', { n: 2 }, 'fr'), 'il y a 2 ans')
  assert.equal(formatMessage(es, 'time.years', { n: 1 }, 'es'), 'hace 1 año')
  assert.equal(formatMessage(es, 'time.years', { n: 2 }, 'es'), 'hace 2 años')
  assert.equal(formatMessage(pt, 'time.years', { n: 1 }, 'pt'), 'há 1 ano')
  assert.equal(formatMessage(pt, 'time.years', { n: 2 }, 'pt'), 'há 2 anos')
  assert.equal(formatMessage(en, 'time.minutes', { n: 1 }, 'en'), '1 min ago')
  assert.equal(formatMessage(ja, 'time.minutes', { n: 1 }, 'ja'), '1 分前')
})

test('formatMessage substitutes {name} placeholders and falls back to keys', () => {
  assert.equal(formatMessage(zh, 'group.sessionCount', { n: 3 }, 'zh'), '3 个会话')
  assert.equal(formatMessage(en, 'group.sessionCount', { n: 3 }, 'en'), '3 sessions')
  assert.equal(formatMessage(ja, 'group.sessionCount', { n: 3 }, 'ja'), '3 件のセッション')
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
  assert.equal(dictionaryFor('ko-KR'), dictionaries.ko)
  assert.equal(dictionaryFor('de-DE'), dictionaries.de)
  assert.equal(dictionaryFor('fr-CA'), dictionaries.fr)
  assert.equal(dictionaryFor('es-419'), dictionaries.es)
  assert.equal(dictionaryFor('pt-BR'), dictionaries.pt)
  assert.equal(dictionaryFor('it-IT'), dictionaries.it)
  assert.equal(dictionaryFor('nl-NL'), dictionaries.nl)
  assert.equal(dictionaryFor('pl-PL'), dictionaries.pl)
  assert.equal(dictionaryFor('tr-TR'), dictionaries.tr)
  assert.equal(dictionaryFor('unknown-language'), dictionaries.en)
  assert.equal(dictionaryFor(undefined), dictionaries.en)
})

test('the first language batch resolves each base dictionary and region variant', () => {
  for (const [localeId, language] of [
    ['ja-JP', 'ja'],
    ['ko-KR', 'ko'],
    ['de-AT', 'de'],
    ['fr-CA', 'fr'],
    ['es-MX', 'es'],
    ['pt-BR', 'pt'],
    ['it-IT', 'it'],
    ['nl-NL', 'nl'],
    ['pl-PL', 'pl'],
    ['tr-TR', 'tr'],
  ]) {
    const translate = createTranslator(() => ({ active: localeId }))
    assert.equal(translate('view.title'), dictionaries[language]['view.title'], localeId)
  }
})

test('a supported regional locale uses its base-language dictionary', () => {
  const japanese = createTranslator(() => ({ active: 'ja-JP' }))
  assert.equal(japanese('view.title'), ja['view.title'])
  assert.equal(japanese('onboarding.title'), ja['onboarding.title'])
})

test('an unsupported host locale follows the English fallback instead of Chinese', () => {
  const unsupported = createTranslator(() => ({ active: 'xx-XX' }))
  assert.equal(unsupported('view.title'), 'Free Groups')
  assert.equal(unsupported('onboarding.title'), 'Welcome to Free Groups')
})
