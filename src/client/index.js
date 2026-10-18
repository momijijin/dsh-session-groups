/**
 * Client bundle entry.
 *
 * This module is bundled by `scripts/build-client.mjs` into a single CJS factory
 * and wrapped as:
 *
 *   window.__ModuleLoader__.load({ id: 'dsh-session-groups', factory: (require) => module.exports })
 *
 * `react` / `react/jsx-runtime` stay external (platform modules) so the host's
 * single React copy is used; the removed client-runtime package is never imported
 * (CONTRACTS §7 — see docs for the exact forbidden package name).
 */
import { createPlugin } from './plugin.js'

/** Cordis plugin dependency list (the slot registry is required). */
export const inject = ['slots']

/** Stable plugin name for loader diagnostics. */
export const name = 'dsh-session-groups'

const plugin = createPlugin()

/**
 * Mount the client half. Returns void: Cordis inspects an async/plugin return
 * value as an effect list and rejects plain objects (Gate 0 finding).
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  plugin.mount(ctx)
}
