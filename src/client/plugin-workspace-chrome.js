/**
 * Workspace-mode chrome controller.
 *
 * Official workspace mode has no plugin slot in its header, so this controller
 * owns the overlay toggle next to the shipped search control plus the narrow
 * width-retry timer. The groups view disposes it automatically.
 */
import { installWorkspaceToggle } from './workspace-toggle.js'

export const createWorkspaceChrome = ({ getMode, getLabel, onToggle, syncSidebarWidth, isMounted, installToggle = installWorkspaceToggle }) => {
  let toggle = null
  let retryTimer = null

  const sync = () => {
    const mode = getMode()
    if (mode === 'workspace') {
      if (toggle === null) {
        toggle = installToggle({
          doc: globalThis.document,
          label: getLabel(),
          onToggle,
        })
      } else {
        toggle.update()
      }
    } else {
      toggle?.dispose()
      toggle = null
    }
    if (!syncSidebarWidth() && retryTimer === null) {
      retryTimer = setTimeout(() => {
        retryTimer = null
        if (isMounted()) sync()
      }, 50)
    }
  }

  return {
    sync,
    update: () => toggle?.update(),
    dispose: () => {
      if (retryTimer !== null) clearTimeout(retryTimer)
      retryTimer = null
      toggle?.dispose()
      toggle = null
    },
  }
}
