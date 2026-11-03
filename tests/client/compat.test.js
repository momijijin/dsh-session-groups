import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CLIENT_REQUIRED,
  HOST_REQUIRED,
  SUPPORTED_DSH_RANGE,
  compatibilityReport,
  detectClientCapabilities,
  detectHostCapabilities,
} from '../../src/adapters/dsh-capabilities.js'

test('host capability preflight reports the required webServer signature', () => {
  const full = detectHostCapabilities({
    webServer: { register() {} },
    get: (name) => (name === 'webServer' ? { register() {} } : undefined),
  })
  assert.equal(full.webServerRegister, true)
  assert.deepEqual(compatibilityReport(full, HOST_REQUIRED), { supported: true, missing: [] })

  const missing = detectHostCapabilities({ get: () => undefined })
  assert.equal(missing.webServerRegister, false)
  assert.deepEqual(compatibilityReport(missing, HOST_REQUIRED), {
    supported: false,
    missing: ['webServerRegister'],
  })
})

test('host preflight does not touch a service that throws before inject', () => {
  const ctx = {
    get: (name) => {
      if (name === 'tools') throw new Error('tools requires inject')
      return undefined
    },
  }
  Object.defineProperty(ctx, 'tools', {
    get() {
      throw new Error('tools requires inject')
    },
  })
  const capabilities = detectHostCapabilities(ctx)
  assert.equal(capabilities.toolsRegister, false)
  assert.deepEqual(compatibilityReport(capabilities, HOST_REQUIRED).missing, ['webServerRegister'])
})

test('optional host services do not block the sidebar view', () => {
  const capabilities = detectHostCapabilities({
    webServer: { register() {} },
    get: (name) => (name === 'sessions' ? {} : undefined),
  })
  assert.equal(capabilities.sessionsService, true)
  assert.equal(capabilities.workspaceRegistryService, false)
  assert.deepEqual(compatibilityReport(capabilities, HOST_REQUIRED), { supported: true, missing: [] })
})

test('client capability preflight requires slots and the sessions service only', () => {
  const capabilities = detectClientCapabilities(
    { slots: { register() {}, inject() {} }, get: () => undefined },
    { sessions: {}, workspaces: null, uiWorkspace: null },
  )
  assert.deepEqual(compatibilityReport(capabilities, CLIENT_REQUIRED), { supported: true, missing: [] })
  assert.equal(capabilities.slotsInject, true)
  assert.equal(capabilities.workspacesService, false)

  const missing = detectClientCapabilities({}, {})
  assert.deepEqual(compatibilityReport(missing, CLIENT_REQUIRED), {
    supported: false,
    missing: ['slotsRegister', 'sessionsService'],
  })
})

test('supported range mirrors the DSH 0.2 release line', () => {
  assert.equal(SUPPORTED_DSH_RANGE, '>=0.2.0-rc.2 <0.3.0')
})
