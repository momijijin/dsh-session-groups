/**
 * Locale dictionaries + translator for the groups client half.
 *
 * The plugin registers these dictionaries with the host locale service when it
 * exists and re-renders on locale changes (the service exposes
 * getSnapshot/subscribe). The packaged dictionaries are also used directly so a
 * host composition that does not expose its locale translator still follows the
 * active document language instead of falling back to Chinese.
 * `locale/zh.json` / `locale/en.json` are the packaged source of truth and are
 * imported into the client bundle at build time.
 */

/** Locale namespace owned by this plugin. */
export const LOCALE_NS = 'dsh-session-grove'

import zh from '../../locale/zh.json' with { type: 'json' }
import en from '../../locale/en.json' with { type: 'json' }

export { zh, en }

/** Dictionaries keyed by host locale id prefix. */
export const dictionaries = Object.freeze({ zh, en })

/** Pick a dictionary for a locale id (`en*` -> English, else Chinese). */
export const dictionaryFor = (localeId) => (typeof localeId === 'string' && localeId.toLowerCase().startsWith('en') ? en : zh)

/**
 * Translate one key with `{name}` placeholder substitution.
 * Missing keys fall back to the Chinese dictionary, then to the key itself.
 */
export const formatMessage = (dict, key, params = {}) => {
  const template = dict?.[key] ?? zh[key] ?? key
  if (!params || typeof template !== 'string') return template
  return template.replace(/\{(\w+)\}/g, (match, name) => (Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match))
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
  return 'zh'
}

/**
 * Create a translator bound to a host locale snapshot getter.
 * @param {() => ({ active?: string, id?: string } | null | undefined)} [getLocaleSnapshot]
 * @param {() => string} [getEnvironmentLocale]
 */
export const createTranslator = (getLocaleSnapshot, getEnvironmentLocale = detectEnvironmentLocale) => (key, params) =>
  formatMessage(dictionaryFor(resolveLocaleId(getLocaleSnapshot, getEnvironmentLocale)), key, params)



