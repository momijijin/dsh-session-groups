/**
 * DSH client adapter: the one process-local runtime bridge installed by
 * plugin.js. This is intentionally outside `src/core`; DSH slot/locale/store
 * wiring may change between host versions while core policy stays put.
 */

let runtime = null

/** @param {object} value */
export const installClientRuntime = (value) => {
  runtime = value
}

/** @returns {object | null} */
export const clientRuntime = () => runtime
