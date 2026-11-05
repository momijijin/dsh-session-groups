import test from 'node:test'
import assert from 'node:assert/strict'

import { formatDateTime } from '../../src/client/i18n/date-format.js'
import { parseSessionTimestamp, relativeTimeParts } from '../../src/client/time.js'

const now = Date.UTC(2026, 9, 29, 8, 0, 0)
const minute = 60 * 1000

test('parseSessionTimestamp accepts epoch ms and ISO strings, rejects invalid values', () => {
  assert.equal(parseSessionTimestamp(now), now)
  assert.equal(parseSessionTimestamp('2026-10-29T08:00:00.000Z'), now)
  assert.equal(parseSessionTimestamp(0), null)
  assert.equal(parseSessionTimestamp(-5), null)
  assert.equal(parseSessionTimestamp(''), null)
  assert.equal(parseSessionTimestamp('not-a-date'), null)
  assert.equal(parseSessionTimestamp(null), null)
  assert.equal(parseSessionTimestamp({}), null)
})

test('relativeTimeParts bucketing: just now/minutes/hours/days/years', () => {
  assert.deepEqual(relativeTimeParts(now - 30 * 1000, now), { unit: 'justNow', value: 0 })
  assert.deepEqual(relativeTimeParts(now - minute, now), { unit: 'minutes', value: 1 })
  assert.deepEqual(relativeTimeParts(now - 59 * minute, now), { unit: 'minutes', value: 59 })
  assert.deepEqual(relativeTimeParts(now - 60 * minute, now), { unit: 'hours', value: 1 })
  assert.deepEqual(relativeTimeParts(now - 23 * 60 * minute, now), { unit: 'hours', value: 23 })
  assert.deepEqual(relativeTimeParts(now - 24 * 60 * minute, now), { unit: 'days', value: 1 })
  assert.deepEqual(relativeTimeParts(now - 364 * 24 * 60 * minute, now), { unit: 'days', value: 364 })
  assert.deepEqual(relativeTimeParts(now - 365 * 24 * 60 * minute, now), { unit: 'years', value: 1 })
  assert.equal(relativeTimeParts(now + minute, now), null, 'future timestamps are invalid')
  assert.equal(relativeTimeParts(undefined, now), null)
})

test('formatDateTime returns a locale-aware stamp and null when invalid', () => {
  const text = formatDateTime(now, 'en-US')
  assert.equal(typeof text, 'string')
  assert.ok(text.length > 0)
  assert.equal(formatDateTime('nope', 'en-US'), null)
  assert.equal(formatDateTime(0, 'en-US'), null)
})
