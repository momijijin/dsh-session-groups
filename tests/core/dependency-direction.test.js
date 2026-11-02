import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url))

const layerOf = (file) => {
  const rel = relative(srcDir, file).replace(/\\/g, '/')
  if (rel.startsWith('shared/')) return 'shared'
  if (rel.startsWith('core/')) return 'core'
  if (rel.startsWith('adapters/')) return 'adapters'
  if (rel.startsWith('client/')) return 'client'
  if (rel.startsWith('host/')) return 'host'
  return 'root'
}

const allowed = {
  shared: new Set(['shared']),
  core: new Set(['core', 'shared']),
  adapters: new Set(['adapters', 'core', 'shared']),
  client: new Set(['client', 'core', 'shared', 'adapters']),
  host: new Set(['host', 'core', 'shared']),
  root: new Set(['host', 'core', 'shared']),
}

const walk = (dir) => {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(path)
  }
  return out
}

test('static imports point only inward (shared <- core <- adapters/client/host)', () => {
  const violations = []
  for (const file of walk(srcDir)) {
    const source = readFileSync(file, 'utf8')
    const fromLayer = layerOf(file)
    for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      const specifier = match[1]
      if (!specifier.startsWith('.')) continue
      // Locale JSON files are package resources, not code layers.
      if (specifier.endsWith('.json')) continue
      const target = resolve(dirname(file), specifier)
      const toLayer = layerOf(target)
      if (!allowed[fromLayer].has(toLayer)) {
        violations.push(`${relative(srcDir, file)} -> ${relative(srcDir, target)} (${fromLayer} -> ${toLayer})`)
      }
    }
  }
  assert.deepEqual(violations, [])
})

test('every core module loads in a plain Node process without DSH adapters', async () => {
  for (const file of walk(join(srcDir, 'core'))) {
    const mod = await import(new URL(`file:///${file.replace(/\\/g, '/')}`))
    assert.ok(mod && typeof mod === 'object')
  }
})
