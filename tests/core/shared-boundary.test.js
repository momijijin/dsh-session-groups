import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const sharedDir = fileURLToPath(new URL('../../src/shared/', import.meta.url))

test('shared domain kernel stays free of React, DSH, DOM and storage', () => {
  for (const name of readdirSync(sharedDir).filter((entry) => entry.endsWith('.js'))) {
    const source = readFileSync(join(sharedDir, name), 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    assert.doesNotMatch(code, /from\s+['"](?:react|react-dom)/, `${name} imports React`)
    assert.doesNotMatch(code, /@deepseek-ai/, `${name} imports a DSH package`)
    assert.doesNotMatch(code, /from\s+['"][^'"]*(?:adapters|client|host)\//, `${name} imports an outer layer`)
    // `globalThis.crypto` is the one allowed platform capability in the shared
    // domain kernel (UUID generation); DOM/storage globals remain forbidden.
    assert.doesNotMatch(code, /\b(?:document|localStorage|sessionStorage)\b/, `${name} touches a browser global`)
  }
})
