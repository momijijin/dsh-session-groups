/**
 * DSH 0.2 release-line adapter.
 *
 * Keep the version-specific surface here. A future 0.3 adapter must be a new
 * file with the same shape, registered in dsh-selector.js, not an `if` in the
 * client/host business flow.
 */
import {
  CLIENT_REQUIRED,
  HOST_REQUIRED,
  detectClientCapabilities,
  detectHostCapabilities,
} from './dsh-capabilities.js'

export const DSH_0_2_ADAPTER = Object.freeze({
  id: 'dsh-0.2',
  range: '>=0.2.0-rc.2 <0.3.0',
  requiredHost: HOST_REQUIRED,
  requiredClient: CLIENT_REQUIRED,
  detectHost: detectHostCapabilities,
  detectClient: detectClientCapabilities,
  supports(version) {
    const match = /^0\.2\.(\d+)(?:[-+].*)?$/.exec(typeof version === 'string' ? version.trim() : '')
    return match !== null
  },
})
