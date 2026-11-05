import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return entry.isFile() && entry.name.endsWith('.js') ? [path] : []
  })

const importEntries = (lines) => {
  const entries = []
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^import\b/.test(lines[i])) continue
    const start = i
    let text = lines[i]
    if (!/^import\s+['"]/.test(text) && !/\bfrom\s+['"]/.test(text)) {
      while (i + 1 < lines.length && !/\bfrom\s+['"]/.test(text)) {
        i += 1
        text += `\n${lines[i]}`
      }
    }
    entries.push({ start, end: i, text })
  }
  return entries
}

const importBindings = (text) => {
  if (/^import\s+['"]/.test(text)) return []
  const clause = text.replace(/^import\s+/, '').replace(/\s+from\s+['"][^'"]+['"][\s\S]*$/, '').trim()
  const bindings = []
  const brace = clause.match(/\{([\s\S]*?)\}/)
  for (const part of (brace?.[1] ?? '').split(',')) {
    const binding = part.trim().split(/\s+as\s+/).pop()?.trim()
    if (binding) bindings.push(binding)
  }
  const before = clause.replace(/\{[\s\S]*?\}/, '').replace(/,/g, ' ').trim()
  const namespace = before.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/)
  if (namespace) bindings.push(namespace[1])
  else if (/^[A-Za-z_$][\w$]*$/.test(before)) bindings.push(before)
  return bindings
}

test('source imports have no unused bindings', () => {
  const unused = []
  for (const file of walk(join(root, 'src'))) {
    if (!file.endsWith('.js')) continue
    const source = readFileSync(file, 'utf8')
    if (source.includes('with { type:')) continue
    const lines = source.split(/\r?\n/)
    const entries = importEntries(lines)
    if (entries.length === 0) continue
    const importLines = new Set()
    for (const entry of entries) for (let i = entry.start; i <= entry.end; i += 1) importLines.add(i)
    const body = lines.map((line, index) => (importLines.has(index) ? '' : line)).join('\n')
    for (const entry of entries) {
      for (const binding of importBindings(entry.text)) {
        if (!new RegExp(`\\b${binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(body)) {
          unused.push(`${relative(root, file)}: ${binding}`)
        }
      }
    }
  }
  assert.deepEqual(unused, [])
})
