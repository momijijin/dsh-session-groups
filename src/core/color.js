import { groupColor, groupColorHex } from '../shared/model.js'

/**
 * Effective group color for the wrapper custom property: a valid hex color
 * wins, otherwise the named palette token is used.
 *
 * Pure string policy; React applies it as a CSS custom property.
 *
 * @param {{ color?: string, colorHex?: string } | null | undefined} group
 * @returns {string}
 */
export const groupColorCss = (group) =>
  groupColorHex(group) ?? `var(--dsg-color-${groupColor(group)})`
