import test from 'node:test'
import assert from 'node:assert/strict'
import { directionForLocale, isRtlLocale } from '../../src/client/i18n/direction.js'

test('RTL direction is detected from the base language and Intl textInfo', () => {
  assert.equal(isRtlLocale('ar'), true)
  assert.equal(isRtlLocale('ar-EG'), true)
  assert.equal(isRtlLocale('he'), true)
  assert.equal(isRtlLocale('fa-IR'), true)
  assert.equal(isRtlLocale('ur-PK'), true)
  assert.equal(directionForLocale('ar'), 'rtl')
  assert.equal(directionForLocale('ar-200'), 'rtl')
})

test('LTR direction stays explicit for non-RTL locales and unknown ids', () => {
  for (const id of ['en', 'en-US', 'zh', 'zh-Hant', 'ja', 'ru', 'hi', '', undefined]) {
    assert.equal(directionForLocale(id), 'ltr', String(id))
  }
})
