/**
 * Plugin settings slot wiring for the package-detail page.
 *
 * The package detail page renders `plugins.bundle.config`; this module owns the
 * config-form lookup and the SkillRepairCard slot registration. It is optional:
 * hosts without the bundle-config slot simply get null.
 */
import { SkillRepairCard } from './skill-repair.js'

const currentConfigForm = (ctx) => {
  try {
    return ctx.get?.('configForms')?.get?.('dsh-session-grove') ?? null
  } catch {
    return null
  }
}

/**
 * Register the settings card against the live Cordis context.
 * @returns {(() => void) | null} slot disposer, or null when unsupported
 */
export const installSettingsSlot = (ctx) => {
  try {
    const disposer = ctx.slots?.inject?.('plugins.bundle.config', () =>
      ctx.slots.register(
        {
          name: 'plugins.bundle.config',
          key: 'dsh-session-grove',
          inject: () => ({ form: currentConfigForm(ctx) }),
        },
        SkillRepairCard,
      ),
    )
    return typeof disposer === 'function' ? disposer : null
  } catch {
    return null
  }
}
