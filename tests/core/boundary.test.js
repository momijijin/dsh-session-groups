import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const coreDir = fileURLToPath(new URL('../../src/core/', import.meta.url))

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return entry.isFile() && entry.name.endsWith('.js') ? [path] : []
  })

test('core modules stay pure and free of platform/locale dependencies', () => {
  for (const file of walk(coreDir)) {
    const name = file.slice(coreDir.length)
    const source = readFileSync(file, 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    assert.doesNotMatch(code, /from\s+['"](?:react|react-dom)/, `${name} imports React`)
    assert.doesNotMatch(code, /@deepseek-ai/, `${name} imports a DSH package`)
    assert.doesNotMatch(code, /from\s+['"][^'"]*(?:adapters|client|host)\//, `${name} imports an outer layer`)
    assert.doesNotMatch(code, /\b(?:document|localStorage|sessionStorage|globalThis)\b/, `${name} touches a browser global`)
    assert.doesNotMatch(code, /\bIntl\.|\btoLocale[A-Z]/, `${name} performs locale-sensitive formatting`)
    assert.doesNotMatch(code, /from\s+['"]node:/, `${name} imports a Node builtin`)
  }
})
