/**
 * Plugin settings slot wiring for the package-detail page.
 *
 * The package detail page renders `plugins.bundle.config`; this module owns the
 * config-form lookup and the SkillRepairCard slot registration. The card is
 * injected by the composition root so this module stays React-free and can be
 * tested without a browser.
 */

const currentConfigForm = (ctx) => {
  try {
    return ctx.get?.('configForms')?.get?.('dsh-session-grove') ?? null
  } catch {
    return null
  }
}

/**
 * Register the settings card against the live Cordis context.
 * @param {object} ctx
 * @param {unknown} card
 * @returns {(() => void) | null} slot disposer, or null when unsupported
 */
export const installSettingsSlot = (ctx, card) => {
  try {
    const disposer = ctx.slots?.inject?.('plugins.bundle.config', () =>
      ctx.slots.register(
        {
          name: 'plugins.bundle.config',
          key: 'dsh-session-grove',
          inject: () => ({ form: currentConfigForm(ctx) }),
        },
        card,
      ),
    )
    return typeof disposer === 'function' ? disposer : null
  } catch {
    return null
  }
}
