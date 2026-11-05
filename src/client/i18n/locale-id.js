/**
 * Locale id normalization and host/environment resolution.
 *
 * No dictionaries or formatting live here; this module only answers "which
 * locale id is active?" for the translator layer.
 */
import { FALLBACK_LANGUAGE } from './resources.js'

/**
 * Normalize a BCP 47-style locale id for lookups.
 * @param {unknown} localeId
 * @returns {string}
 */
export const normalizeLocaleId = (localeId) => {
  if (typeof localeId !== 'string') return ''
  return localeId.trim().toLowerCase().replaceAll('_', '-')
}

/**
 * Normalize a BCP 47-style locale (`ja-JP`, `zh_Hant_TW`, ...) to its base
 * language. Region/script variants are resolved separately before this base
 * fallback.
 * @param {unknown} localeId
 * @returns {string}
 */
export const baseLanguage = (localeId) => {
  const normalized = normalizeLocaleId(localeId)
  return normalized.split('-')[0] ?? ''
}

const REGION_SCRIPTS = Object.freeze({ tw: 'hant', hk: 'hant', mo: 'hant', cn: 'hans', sg: 'hans', my: 'hans' })

/**
 * Ordered dictionary candidates for a locale id: exact id, explicit script,
 * maximized script, known region script, then base language. The registry
 * lookup is case-insensitive; this is what makes `zh-TW` select `zh-Hant`
 * while `zh-CN` keeps the Simplified `zh` resource.
 * @param {unknown} localeId
 * @returns {string[]}
 */
export const localeCandidates = (localeId) => {
  const normalized = normalizeLocaleId(localeId)
  if (normalized === '') return []
  const parts = normalized.split('-')
  const language = parts[0]
  const candidates = [normalized]
  const explicitScript = parts.find((part) => /^[a-z]{4}$/.test(part))
  if (explicitScript) candidates.push(`${language}-${explicitScript}`)
  try {
    const script = new Intl.Locale(normalized).maximize?.().script
    if (script) candidates.push(`${language}-${script.toLowerCase()}`)
  } catch {
    /* Intl.Locale is optional in older hosts */
  }
  const region = parts.find((part) => /^[a-z]{2}$/.test(part))
  if (region && REGION_SCRIPTS[region]) candidates.push(`${language}-${REGION_SCRIPTS[region]}`)
  candidates.push(language)
  return [...new Set(candidates)]
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
