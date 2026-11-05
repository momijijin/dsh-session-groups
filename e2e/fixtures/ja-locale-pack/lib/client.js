/**
 * Test-only client locale pack.
 *
 * Adds language definitions to the host locale catalog, activates Japanese by
 * default, and exposes a test hook for switching the active locale. This keeps
 * the component under test unaware of the test harness: the plugin only sees a
 * normal host locale pack.
 */
window.__ModuleLoader__.load({
  id: 'e2e-ja-locale-pack',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports
    const languageIds = [
      'zh-Hant',
      'zh-TW',
      'zh-HK',
      'zh-MO',
      'zh-CN',
      'zh-SG',
      'ja',
      'ko',
      'de',
      'fr',
      'es',
      'pt',
      'pt-BR',
      'it',
      'nl',
      'pl',
      'tr',
      'vi',
      'th',
      'id',
      'ru',
      'hi',
    ]

    exports.name = 'e2e-ja-locale-pack'
    exports.inject = ['locale']
    exports.apply = (ctx) => {
      try {
        const locale = ctx.get?.('locale')
        if (!locale) return
        for (const id of languageIds) {
          try {
            locale.addLanguage?.({ id, label: id, fallback: 'en' })
          } catch {
            /* already registered by another test/run */
          }
        }
        globalThis.__DSH_E2E_SET_LOCALE__ = (id) => locale.setLocale?.(id)
        globalThis.__DSH_E2E_GET_LOCALE__ = () => locale.getSnapshot?.()
        locale.setLocale?.('ja')
      } catch (error) {
        globalThis.console?.warn?.('[e2e-ja-locale-pack] failed to activate locale pack', error)
      }
    }

    return module.exports
  },
})
