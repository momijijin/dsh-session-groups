/**
 * Locale-aware absolute time formatting.
 *
 * The i18n layer owns `Intl.DateTimeFormat`; UI components receive the already
 * formatted title through the runtime bridge instead of calling locale APIs.
 */
import { normalizeLocaleId } from './locale-id.js'

/** @param {unknown} value @param {string} [localeId] */
export const formatDateTime = (value, localeId = 'en') => {
  const timestamp = typeof value === 'number' ? value : Date.parse(String(value))
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null
  const locale = normalizeLocaleId(localeId) || 'en'
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
  } catch {
    try {
      return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
    } catch {
      return new Date(timestamp).toISOString()
    }
  }
}
