import test from 'node:test'
import assert from 'node:assert/strict'
import { createControlTool, TOOL_NAME } from '../../src/host/tool.js'
import { sampleDoc } from './helpers.js'

const setup = (overrides = {}) => {
  let doc = sampleDoc()
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
  assert.equal(typeof tool.execute, 'function')
  assert.equal(tool.output.schema.type, 'object')
  assert.equal(tool.output.render({}, { ok: true }).at(0).type, 'text')
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
