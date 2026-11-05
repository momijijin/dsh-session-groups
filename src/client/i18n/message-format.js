/**
 * Pure message formatting: plural category selection and {placeholder}
 * interpolation. It has no React, DOM, storage or host-service knowledge; the
 * UI only calls the translator function that wraps this module.
 */
import { FALLBACK_LANGUAGE, en } from './resources.js'

/**
 * Resolve a string or plural template for the active locale. Plural templates
 * are plain objects keyed by CLDR categories (`one`, `other`, ...); `Intl`
 * chooses the category from `params.n`. Without a numeric count, `other` is the
 * stable fallback.
 * @param {string | Record<string, string> | undefined} template
 * @param {string} localeId
 * @param {Record<string, unknown>} params
 * @returns {string | undefined}
 */
export const selectPluralTemplate = (template, localeId, params) => {
  if (!template || typeof template !== 'object') return template
  const count = Number(params?.n)
  const fallback = template.other ?? template.one ?? Object.values(template)[0]
  if (!Number.isFinite(count)) return fallback
  try {
    const category = new Intl.PluralRules(localeId || FALLBACK_LANGUAGE).select(count)
    return template[category] ?? fallback
  } catch {
    try {
      const category = new Intl.PluralRules(FALLBACK_LANGUAGE).select(count)
      return template[category] ?? fallback
    } catch {
      return fallback
    }
  }
}

/**
 * Translate one key with `{name}` placeholder substitution.
 * Missing keys fall back to the English dictionary, then to the key itself.
 * English is the stable fallback so an unsupported third-party language never
 * silently renders Chinese. Object values are CLDR plural templates.
 * @param {Record<string, string | Record<string, string>>} dict
 * @param {string} key
 * @param {Record<string, unknown>} [params]
 * @param {string} [localeId]
 */
export const formatMessage = (dict, key, params = {}, localeId = FALLBACK_LANGUAGE) => {
  const selected = dict?.[key] ?? en[key] ?? key
  const template = selectPluralTemplate(selected, localeId, params)
  if (!params || typeof template !== 'string') return template
  return template.replace(/\{(\w+)\}/g, (match, name) => (Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match))
}
