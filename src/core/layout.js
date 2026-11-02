/**
 * Pure layout arithmetic for the groups tree. Host-specific viewport probes
 * live in the adapter layer; this module receives a number and returns a number.
 */

/**
 * Initial virtual-list estimate before the real tree mount is measured.
 * Keeps a minimum viewport of 240px and a 700px fallback when the host does not
 * expose a finite positive innerHeight.
 *
 * @param {number} viewportHeight
 * @returns {number}
 */
export const estimatedTreeHeight = (viewportHeight) => {
  const height = Number(viewportHeight)
  return Number.isFinite(height) && height > 0 ? Math.max(240, height - 220) : 700
}
