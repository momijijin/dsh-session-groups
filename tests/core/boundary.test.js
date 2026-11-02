import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const coreDir = fileURLToPath(new URL('../../src/core/', import.meta.url))

test('core modules do not import host, React, DOM or storage adapters', () => {
  for (const name of readdirSync(coreDir).filter((entry) => entry.endsWith('.js'))) {
    const source = readFileSync(join(coreDir, name), 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    assert.doesNotMatch(code, /from\s+['"](?:react|react-dom)/, `${name} imports React`)
    assert.doesNotMatch(code, /@deepseek-ai/, `${name} imports a DSH package`)
    assert.doesNotMatch(code, /from\s+['"][^'"]*(?:adapters|client|host)\//, `${name} imports an outer layer`)
    assert.doesNotMatch(code, /\b(?:document|localStorage|sessionStorage|globalThis)\b/, `${name} touches a browser global`)
  }
})
