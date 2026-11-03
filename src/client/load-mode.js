/**
 * Decide whether a document read should replace the visible tree with the
 * loading placeholder.
 *
 * Initial reads must show loading. A background refresh triggered by an
 * external revision (native tool / HTTP commit) must keep the current tree
 * visible: otherwise every AI-driven move flashes the whole sidebar.
 *
 * @param {{ background?: boolean, docState?: string }} options
 * @returns {boolean}
 */
export const shouldShowLoading = ({ background = false, docState = 'loading' } = {}) =>
  !background || docState !== 'ready'
