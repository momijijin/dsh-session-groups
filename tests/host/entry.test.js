import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply, Config, inject, name } from '../../src/index.js'
import { makeContext, makeTempStore } from './helpers.js'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(path)))
    else if (entry.name.endsWith('.js')) files.push(path)
  }
  return files
}

test('the entry exports the Cordis row name and injects webServer', () => {
  assert.equal(name, 'dsh-session-groups')
  assert.deepEqual(inject, ['webServer'])
})

test('0.2.18 exposes a plugin-manager Config with diagnostics and debug probe off', () => {
  assert.equal(Config?.[Symbol.for('schemastery')], true)
  assert.equal(Config.type, 'object')
  assert.equal(Config.dict.diagnostics.type, 'boolean')
  assert.equal(Config.dict.diagnostics.meta.default, false)
  assert.equal(Config.dict.debugProbe.type, 'boolean')
  assert.equal(Config.dict.debugProbe.meta.default, false)
  for (const key of ['diagnostics', 'debugProbe', 'controlApi', 'controlDestructive', 'controlSessions']) {
    assert.equal(Config.dict[key].meta.volatile, true, `${key} must be served by the host config form`)
    assert.equal(Config.dict[key].meta.default, false, `${key} must default off`)
  }
})

test('apply registers the native control tool when the tools service is present', async (t) => {
  const temp = await makeTempStore()
  t.after(temp.cleanup)
  let registered = null
  const tools = {
    register(tool) {
      registered = tool
      return () => {
        registered = null
      }
    },
  }
  const { ctx } = makeContext({ services: { tools } })
  apply(ctx, { filePath: temp.filePath })
  assert.equal(registered?.name, 'session_groups_control')
  assert.equal(registered.parameters.required.includes('action'), true)
  assert.equal(registered.parameters.properties.action.enum.includes('doctor'), true)
  assert.equal(typeof registered.execute, 'function')
})

test('native control tool doctor reports live host compatibility, gates, storage and routes', async (t) => {
  const temp = await makeTempStore()
  t.after(temp.cleanup)
  let registered = null
  const tools = {
    register(tool) {
      registered = tool
      return () => {
        registered = null
      }
    },
  }
  const { ctx } = makeContext({ services: { tools } })
  apply(ctx, { filePath: temp.filePath })
  const report = await registered.execute({ action: 'doctor' })
  assert.equal(report.ok, true)
  assert.equal(report.protocol, 1)
  assert.equal(typeof report.plugin.version, 'string')
  assert.equal(report.plugin.supportedRange, '>=0.2.0-rc.2 <0.3.0')
  assert.equal(report.host.compatibility.supported, true)
  assert.equal(report.host.capabilities.webServerRegister, true)
  assert.equal(report.gates.controlApi, false)
  assert.equal(report.gates.controlDestructive, false)
  assert.equal(report.gates.controlSessions, false)
  assert.equal(report.storage.filePath, temp.filePath)
  assert.equal(typeof report.storage.source, 'string')
  assert.equal(report.routes.includes('/dsh-session-groups/load'), true)
})

test('apply() returns void synchronously and mounts the host routes inside ctx.effect', async (t) => {
  const temp = await makeTempStore()
  t.after(temp.cleanup)
  const { ctx, routes, logs } = makeContext()
  let ready
  const returned = apply(ctx, {
    filePath: temp.filePath,
    onReady: (value) => {
      ready = value
    },
  })

  // Cordis 4.0.5 treats the return value as the plugin effect list.
  assert.equal(returned, undefined)
  assert.equal(routes.length, 13)
  assert.equal(ready.filePath, temp.filePath)
  assert.equal(ready.diagnosticsFilePath, join(temp.storages, 'dsh-session-groups.diagnostics.ndjson'))
  assert.equal(ready.debugFilePath, join(temp.storages, 'dsh-session-groups.debug.ndjson'))
  assert.equal(ready.mounted.registered, true)
  assert.equal(typeof ready.store.load, 'function')
  assert.equal(typeof ready.storageSource, 'string')
  assert.equal(logs.info.some((line) => line.includes('host ready') && line.includes('storageSource=')), true)
  assert.equal(logs.info.some((line) => line.includes('diagnostics=')), true)
})

test('apply() is fail-soft when the composition has no webServer', async (t) => {
  const temp = await makeTempStore()
  t.after(temp.cleanup)
  const { ctx, logs } = makeContext({ webServer: null })
  let ready
  const returned = apply(ctx, {
    filePath: temp.filePath,
    onReady: (value) => {
      ready = value
    },
  })
  assert.equal(returned, undefined)
  assert.equal(ready.mounted.registered, false)
  assert.deepEqual(ready.mounted.routes, [])
  assert.equal(logs.warn.some((line) => line.includes('webServer.register is unavailable')), true)
})

test('the host half never imports @deepseek-ai/dsh-client-runtime', async () => {
  const files = [...(await walk(join(repoRoot, 'src', 'host'))), join(repoRoot, 'src', 'index.js')]
  assert.ok(files.length > 0)
  for (const file of files) {
    const text = await readFile(file, 'utf8')
    assert.equal(text.includes('dsh-client-runtime'), false, file)
  }
})

test('package.json declares the host peers required by the frozen contract', async () => {
  const manifest = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
  assert.equal(typeof manifest.peerDependencies?.['@deepseek-ai/dsh-home-paths'], 'string')
  assert.equal(typeof manifest.peerDependencies?.['@deepseek-ai/cordis'], 'string')
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
})
