/**
 * Session timestamp formatting (0.2.7).
 *
 * Host session rows expose `updatedAt` as epoch milliseconds (some fixtures use
 * ISO strings). The sidebar shows a compact relative label and the absolute
 * timestamp in the `title`; missing/invalid values render nothing at all.
 * Pure functions keep the clock injectable for unit tests.
 */

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const YEAR = 365 * DAY

/** Parse `updatedAt` to epoch milliseconds, or null when missing/invalid. */
export const parseSessionTimestamp = (value) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return null
}

/**
 * Relative bucket for a timestamp. Returns `{ unit, value }` where unit is
 * `justNow|minutes|hours|days|years`; null for missing/invalid/future values.
 */
export const relativeTimeParts = (value, now = Date.now()) => {
  const timestamp = parseSessionTimestamp(value)
  if (timestamp === null) return null
  const reference = Number.isFinite(now) ? now : Date.now()
  const elapsed = reference - timestamp
  if (elapsed < 0) return null
  if (elapsed < MINUTE) return { unit: 'justNow', value: 0 }
  if (elapsed < HOUR) return { unit: 'minutes', value: Math.floor(elapsed / MINUTE) }
  if (elapsed < DAY) return { unit: 'hours', value: Math.floor(elapsed / HOUR) }
  if (elapsed < YEAR) return { unit: 'days', value: Math.floor(elapsed / DAY) }
  return { unit: 'years', value: Math.floor(elapsed / YEAR) }
}
