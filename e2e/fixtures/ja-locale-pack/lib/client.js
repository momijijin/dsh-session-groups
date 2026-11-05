/**
 * Test-only client locale pack.
 *
 * Adds a Japanese language definition to the host locale catalog and makes it
 * active. This is intentionally a separate plugin so the isolated A+ fixture
 * proves the target plugin reacts to a third-party language pack rather than
 * registering the language itself.
 */
window.__ModuleLoader__.load({
  id: 'e2e-ja-locale-pack',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports

    exports.name = 'e2e-ja-locale-pack'
    exports.inject = ['locale']
    exports.apply = (ctx) => {
      try {
        const locale = ctx.get?.('locale')
        if (!locale) return
        try {
          locale.addLanguage?.({ id: 'ja', label: '日本語', fallback: 'en' })
        } catch {
          /* already registered by another test/run */
        }
        locale.setLocale?.('ja')
      } catch (error) {
        globalThis.console?.warn?.('[e2e-ja-locale-pack] failed to activate Japanese', error)
      }
    }

    return module.exports
  },
})
