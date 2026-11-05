import test from 'node:test'
import assert from 'node:assert/strict'
import { createControlTool, TOOL_NAME } from '../../src/host/tool.js'
import { sampleDoc } from './helpers.js'

const setup = (overrides = {}) => {
  let doc = { ...sampleDoc(), revision: 2 }
  let revision = 2
  const notifications = []
  const session = { id: 's-current', title: 'old title' }
  const registry = {
    archivedSessionIds: [],
    async archiveSession(id, options) {
      assert.equal(id, 's-current')
      registry.lastOptions = options
      registry.archivedSessionIds = [id]
    },
    async unarchiveSession(id) {
      registry.archivedSessionIds = registry.archivedSessionIds.filter((value) => value !== id)
    },
  }
  const services = {
    sessions: { get: (id) => (id === 's-current' ? session : undefined) },
    sessionTitle: {
      get: (value) => ({ title: value.title }),
      rename: (value, title) => {
        value.title = title
        return { title }
      },
    },
    workspaceRegistry: registry,
  }
  const tool = createControlTool({
    store: {
      async load() {
        return { kind: 'ok', doc, revision }
      },
      async commit(baseRevision, next) {
        if (baseRevision !== revision) return { kind: 'conflict', doc, revision }
        revision += 1
        doc = next
        return { kind: 'ok', doc, revision }
      },
    },
    getService: (name) => services[name] ?? null,
    controlApiEnabled: () => true,
    controlSessionsEnabled: () => true,
    controlDestructiveEnabled: () => false,
    onCommit: (nextRevision, source) => notifications.push([nextRevision, source]),
    ...overrides,
  })
  return { tool, session, registry, notifications, getDoc: () => doc, getRevision: () => revision }
}

test('native tool exposes a raw registry-ready definition without HTTP', () => {
  const { tool } = setup()
  assert.equal(tool.name, TOOL_NAME)
  assert.equal(tool.parameters.type, 'object')
  assert.equal(tool.parameters.required.includes('action'), true)
  assert.equal(tool.parameters.properties.action.enum.includes('doctor'), true)
  assert.equal(tool.parameters.properties.action.enum.includes('catalog'), true)
  assert.equal(typeof tool.execute, 'function')
  assert.equal(tool.output.schema.type, 'object')
  assert.equal(tool.output.render({}, { ok: true }).at(0).type, 'text')
})

test('native tool doctor returns the injected live compatibility report and can diagnose a closed control API', async () => {
  const report = {
    ok: true,
    protocol: 1,
    plugin: { version: 'test' },
    host: { compatibility: { supported: true, missing: [] } },
    gates: { controlApi: false, controlDestructive: false, controlSessions: false },
  }
  const { tool } = setup({ controlApiEnabled: () => false, doctorReport: async () => report })
  assert.deepEqual(await tool.execute({ action: 'doctor' }), report)

  const unavailable = setup()
  const missing = await unavailable.tool.execute({ action: 'doctor' })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'doctor-unavailable')
})

test('native tool reads state and resolves full paths', async () => {
  const { tool } = setup()
  const state = await tool.execute({ action: 'state' })
  assert.equal(state.ok, true)
  assert.equal(state.revision, 2)
  assert.equal(state.groups.length, 2)

  const resolved = await tool.execute({ action: 'resolve', path: ['施工中', '子组'] })
  assert.equal(resolved.ok, true)
  assert.equal(resolved.groupId, 'g-bbbbbbbbbbbb')
  assert.equal(resolved.revision, 2)
})

test('native tool catalog is read-only and includes icons, colors and operations', async () => {
  const { tool } = setup()
  const catalog = await tool.execute({ action: 'catalog' })
  assert.equal(catalog.ok, true)
  assert.equal(catalog.revision, undefined)
  assert.ok(catalog.icons.items.length > 70)
  assert.ok(catalog.colors.items.length >= 12)
  assert.equal(catalog.colors.formats.custom.canonical, '#rrggbb')
  assert.ok(catalog.operations.includes('session.assign'))
})

test('native tool plans and applies with CAS and stale-plan protection', async (t) => {
  const state = setup()
  const operations = [{ op: 'group.rename', groupId: 'g-aaaaaaaaaaaa', name: '改名' }]
  const plan = await state.tool.execute({ action: 'plan', baseRevision: 2, operations })
  assert.equal(plan.ok, true)
  assert.equal(typeof plan.planHash, 'string')

  const stale = await state.tool.execute({
    action: 'apply',
    baseRevision: 2,
    operations,
    planHash: 'not-the-plan',
  })
  assert.equal(stale.ok, false)
  assert.equal(stale.code, 'stale-plan')

  const applied = await state.tool.execute({
    action: 'apply',
    baseRevision: 2,
    operations,
    planHash: plan.planHash,
  })
  assert.equal(applied.ok, true)
  assert.equal(applied.revision, 3)
  assert.equal(state.getDoc().groups[0].name, '改名')
  assert.deepEqual(state.notifications, [[3, 'native-tool']])

  const conflict = await state.tool.execute({
    action: 'apply',
    baseRevision: 2,
    operations,
    planHash: plan.planHash,
  })
  assert.equal(conflict.ok, false)
  assert.equal(conflict.code, 'conflict')
})

test('native tool session actions require explicit sessionId', async () => {
  const state = setup()
  const inspected = await state.tool.execute({ action: 'session_inspect', sessionId: 's-current' })
  assert.equal(inspected.ok, true)
  assert.equal(inspected.title, 'old title')

  const missing = await state.tool.execute({ action: 'session_inspect' })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'invalid-session-id')

  const renamed = await state.tool.execute({
    action: 'session_rename',
    sessionId: 's-current',
    title: 'new title',
    expectedTitle: 'old title',
  })
  assert.equal(renamed.ok, true)
  assert.equal(state.session.title, 'new title')

  const archived = await state.tool.execute({
    action: 'session_archive',
    sessionId: 's-current',
    archived: true,
    expectedArchived: false,
  })
  assert.equal(archived.ok, true)
  assert.deepEqual(state.registry.archivedSessionIds, ['s-current'])
})

test('native tool honors control switches', async () => {
  const disabled = setup({ controlApiEnabled: () => false })
  const state = await disabled.tool.execute({ action: 'state' })
  assert.equal(state.ok, false)
  assert.equal(state.code, 'control-disabled')

  const sessionsOff = setup({ controlSessionsEnabled: () => false })
  const session = await sessionsOff.tool.execute({ action: 'session_inspect', sessionId: 's-current' })
  assert.equal(session.ok, false)
  assert.equal(session.code, 'session-controls-disabled')
})

test('native tool rejects malformed actions and plan inputs without touching the store', async () => {
  const { tool } = setup()
  assert.equal((await tool.execute({ action: 'unknown' })).code, 'invalid-action')
  assert.equal((await tool.execute({ action: 'resolve' })).code, 'invalid-path')
  assert.equal((await tool.execute({ action: 'plan', baseRevision: -1, operations: [{ op: 'group.rename' }] })).code, 'invalid-revision')
  assert.equal((await tool.execute({ action: 'plan', baseRevision: 2, operations: [] })).code, 'operations-required')
  assert.equal((await tool.execute({ action: 'apply', baseRevision: 2, operations: [{ op: 'group.rename' }] })).code, 'stale-plan')
})

test('native tool returns unsupported-version and internal failures as structured errors', async () => {
  const unsupported = setup({
    store: { async load() { return { kind: 'unsupported-version', version: 9 } } },
  })
  const version = await unsupported.tool.execute({ action: 'state' })
  assert.equal(version.ok, false)
  assert.equal(version.code, 'unsupported-version')
  assert.equal(version.version, 9)

  const thrown = setup({
    store: { async load() { throw new Error('store exploded') } },
  })
  const internal = await thrown.tool.execute({ action: 'state' })
  assert.equal(internal.ok, false)
  assert.equal(internal.code, 'internal')
  assert.match(internal.message, /store exploded/)
})

test('native tool exposes archived, missing and title-failure inspect states', async () => {
  const state = setup()
  state.registry.archivedSessionIds = ['s-archived']
  const archived = await state.tool.execute({ action: 'session_inspect', sessionId: 's-archived' })
  assert.equal(archived.ok, true)
  assert.equal(archived.live, false)
  assert.equal(archived.archived, true)
  assert.equal(archived.title, null)

  const missing = await state.tool.execute({ action: 'session_inspect', sessionId: 'missing' })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'session-not-found')

  const noServices = setup({ getService: (name) => (name === 'sessions' ? { get: () => null } : null) })
  const unavailable = await noServices.tool.execute({ action: 'session_inspect', sessionId: 's-current' })
  assert.equal(unavailable.code, 'service-unavailable')

  const titleFailure = setup({
    getService: (name) => (name === 'sessions' ? { get: () => ({ id: 's-current' }) } : name === 'sessionTitle' ? { get() { throw new Error('nope') } } : null),
  })
  const title = await titleFailure.tool.execute({ action: 'session_inspect', sessionId: 's-current' })
  assert.equal(title.ok, true)
  assert.equal(title.title, null)
})

test('native tool validates rename inputs, conflicts, no-op and failures', async () => {
  const state = setup()
  assert.equal((await state.tool.execute({ action: 'session_rename', sessionId: 's-current', title: '' })).code, 'invalid-title')
  assert.equal((await state.tool.execute({ action: 'session_rename', sessionId: 's-current', title: 'x', expectedTitle: 1 })).code, 'invalid-title')
  const mismatch = await state.tool.execute({ action: 'session_rename', sessionId: 's-current', title: 'x', expectedTitle: 'other' })
  assert.equal(mismatch.code, 'title-changed')
  assert.equal(mismatch.title, 'old title')
  const same = await state.tool.execute({ action: 'session_rename', sessionId: 's-current', title: 'old title' })
  assert.equal(same.ok, true)
  const failed = setup({
    getService: (name) => (name === 'sessions' ? { get: () => ({ id: 's-current', title: 'old' }) } : name === 'sessionTitle' ? { get: () => ({ title: 'old' }), rename() { throw new Error('rename failed') } } : null),
  })
  const failure = await failed.tool.execute({ action: 'session_rename', sessionId: 's-current', title: 'new' })
  assert.equal(failure.code, 'session-operation-failed')
  assert.match(failure.message, /rename failed/)
})

test('native tool validates archive inputs, conflicts, no-op and forwards stopActivity', async () => {
  const state = setup()
  assert.equal((await state.tool.execute({ action: 'session_archive', sessionId: 's-current', archived: 'yes' })).code, 'invalid-archived')
  assert.equal((await state.tool.execute({ action: 'session_archive', sessionId: 's-current', archived: true, expectedArchived: 'yes' })).code, 'invalid-archived')
  assert.equal((await state.tool.execute({ action: 'session_archive', sessionId: 's-current', archived: true, stopActivity: 'yes' })).code, 'invalid-stop-activity')
  assert.equal((await state.tool.execute({ action: 'session_archive', sessionId: 's-current', archived: true, expectedArchived: true })).code, 'archive-changed')
  assert.equal((await state.tool.execute({ action: 'session_archive', sessionId: 's-current', archived: false })).ok, true)
  state.registry.archivedSessionIds = ['s-current']
  assert.equal((await state.tool.execute({ action: 'session_archive', sessionId: 's-current', archived: false })).ok, true)
  assert.deepEqual(state.registry.archiveCalls, undefined)
  const archived = await state.tool.execute({ action: 'session_archive', sessionId: 's-current', archived: true, stopActivity: true })
  assert.equal(archived.ok, true)
  assert.deepEqual(state.registry.lastOptions, { stopActivity: true })
  const failed = setup({
    getService: (name) => (name === 'workspaceRegistry' ? {
      archivedSessionIds: [],
      archiveSession: async () => { throw new Error('archive failed') },
      unarchiveSession: async () => {},
    } : null),
  })
  const failure = await failed.tool.execute({ action: 'session_archive', sessionId: 's-current', archived: true })
  assert.equal(failure.code, 'session-operation-failed')
  assert.match(failure.message, /archive failed/)
})
