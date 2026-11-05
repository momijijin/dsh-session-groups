/**
 * Public locale facade for the groups client half.
 *
 * The implementation is split into four i18n modules so resources, locale-id
 * resolution, message formatting and translator selection can evolve and be
 * tested independently:
 *
 *   i18n/resources.js       packaged dictionaries + fallback language
 *   i18n/locale-id.js       id normalization + host/document resolution
 *   i18n/message-format.js  CLDR plural selection + {placeholder} interpolation
 *   i18n/translator.js      dictionary selection + createTranslator
 *
 * UI code should consume only the translator (`t`); it must not import the
 * JSON resources or inspect plural categories.
 */

export {
  FALLBACK_LANGUAGE,
  LOCALE_NS,
  de,
  dictionaries,
  en,
  es,
  fr,
  id,
  it,
  ja,
  ko,
  nl,
  pl,
  pt,
  th,
  tr,
  vi,
  zh,
} from './i18n/resources.js'
export { baseLanguage, detectEnvironmentLocale, resolveLocaleId } from './i18n/locale-id.js'
export { formatMessage } from './i18n/message-format.js'
export { createTranslator, dictionaryFor } from './i18n/translator.js'
