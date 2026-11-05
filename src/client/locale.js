/**
 * Locale dictionaries + translator for the groups client half.
 *
 * The plugin registers these dictionaries with the host locale service when it
 * exists and re-renders on locale changes (the service exposes
 * getSnapshot/subscribe); without the service it falls back to Chinese.
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
 * Create a translator bound to a host locale snapshot getter.
 * Host snapshots use `active`; `id` is kept for older compositions.
 * @param {() => ({ active?: string, id?: string } | null | undefined)} [getLocaleSnapshot]
 */
export const createTranslator = (getLocaleSnapshot) => (key, params) => {
  let localeId = 'zh'
  try {
    const snapshot = getLocaleSnapshot?.()
    localeId = snapshot?.active ?? snapshot?.id ?? 'zh'
  } catch {
    localeId = 'zh'
  }
  return formatMessage(dictionaryFor(localeId), key, params)
}


