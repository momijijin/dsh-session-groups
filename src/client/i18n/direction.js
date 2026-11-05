/**
 * Text direction for a locale id.
 *
 * The packaged dictionaries only include Arabic among RTL languages today, but
 * the fallback set/I18n.Locale probe keeps this generic for a future `he`/`fa`
 * or third-party RTL pack.
 */
import { baseLanguage, normalizeLocaleId } from './locale-id.js'

const RTL_BASE_LANGUAGES = new Set(['ar', 'arc', 'ckb', 'dv', 'fa', 'he', 'ku', 'ps', 'ur', 'yi'])

/** @param {unknown} localeId */
export const isRtlLocale = (localeId) => {
  const normalized = normalizeLocaleId(localeId)
  if (normalized === '') return false
  if (RTL_BASE_LANGUAGES.has(baseLanguage(normalized))) return true
  try {
    return new Intl.Locale(normalized).textInfo?.direction === 'rtl'
  } catch {
    return false
  }
}

/** @param {unknown} localeId */
export const directionForLocale = (localeId) => (isRtlLocale(localeId) ? 'rtl' : 'ltr')
