/**
 * Locale id normalization and host/environment resolution.
 *
 * No dictionaries or formatting live here; this module only answers "which
 * locale id is active?" for the translator layer.
 */
import { FALLBACK_LANGUAGE } from './resources.js'

/**
 * Normalize a BCP 47-style locale (`ja-JP`, `zh_Hant_TW`, ...) to its base
 * language. Region and script dictionaries are not handled yet; unsupported
 * variants fall back through the same base-language lookup.
 * @param {unknown} localeId
 * @returns {string}
 */
export const baseLanguage = (localeId) => {
  if (typeof localeId !== 'string') return ''
  const normalized = localeId.trim().toLowerCase().replaceAll('_', '-')
  return normalized.split('-')[0] ?? ''
}

/**
 * Browser language visible to a client plugin. The host locale service keeps
 * `<html lang>` in sync with its active locale; navigator is only a secondary
 * fallback because the browser language can disagree with the DSH UI language.
 * @returns {string} a locale id, or an empty string when no browser hint exists
 */
export const detectEnvironmentLocale = () => {
  try {
    const lang = globalThis.document?.documentElement?.lang
    if (typeof lang === 'string' && lang.trim() !== '') return lang.trim()
  } catch {
    /* no document in tests/host worker */
  }
  try {
    const navigator = globalThis.navigator
    const first = Array.isArray(navigator?.languages) ? navigator.languages[0] : navigator?.language
    if (typeof first === 'string' && first.trim() !== '') return first.trim()
  } catch {
    /* optional browser API */
  }
  return ''
}

/**
 * Resolve the active locale from the host snapshot, then the document language,
 * then the browser language. Host snapshots use `active`; `id` is kept for
 * older compositions.
 * @param {() => ({ active?: string, id?: string } | null | undefined)} [getLocaleSnapshot]
 * @param {() => string} [getEnvironmentLocale]
 * @returns {string}
 */
export const resolveLocaleId = (getLocaleSnapshot, getEnvironmentLocale = detectEnvironmentLocale) => {
  try {
    const snapshot = getLocaleSnapshot?.()
    const active = snapshot?.active ?? snapshot?.id
    if (typeof active === 'string' && active.trim() !== '') return active.trim()
  } catch {
    /* malformed or unavailable host service */
  }
  try {
    const environment = getEnvironmentLocale?.()
    if (typeof environment === 'string' && environment.trim() !== '') return environment.trim()
  } catch {
    /* optional environment probe */
  }
  return FALLBACK_LANGUAGE
}
