import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/**
 * Dead-export guard.
 *
 * The plan treats an export as dead when its name appears nowhere in `src/`
 * except its own declaration line: no other module references it and the
 * defining module does not use it internally. `src/index.js` keeps the four
 * Cordis dynamic entry names (`Config`/`apply`/`inject`/`name`) even though the
 * host resolves them reflectively instead of importing them.
 *
 * This guard intentionally covers `export const|let|var|function|class`
 * declarations. Re-export statements (`export { ... }` / `export { ... } from`)
 * are not part of the C3 scope; they are exercised through their consumers.
 */

const root = resolve(import.meta.dirname, '..', '..')
const srcDir = join(root, 'src')

/** Host entry point whose Cordis exports are resolved dynamically by the host. */
const HOST_ENTRY = 'src/index.js'
const CLIENT_ENTRY = 'src/client/index.js'
/** Dynamic entry APIs: the host resolves these names off the module. */
const DYNAMIC_ENTRIES = new Map([
  [HOST_ENTRY, new Set(['Config', 'apply', 'inject', 'name'])],
  [CLIENT_ENTRY, new Set(['inject', 'name', 'apply'])],
])

const DECLARATION_PATTERN = /^[ \t]*export\s+(?:async\s+)?(?:const|let|var|function\s*\*?|class)\s+([A-Za-z_$][\w$]*)/gm

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return entry.isFile() && entry.name.endsWith('.js') ? [path] : []
  })

const toRepoPath = (absolutePath) => relative(root, absolutePath).split(sep).join('/')

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const stripNonCode = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\r\n]*/g, '')

const countReferences = (source, name) => {
  const pattern = new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`, 'g')
  return (stripNonCode(source).match(pattern) ?? []).length
}

const lineNumberAt = (source, index) => source.slice(0, index).split(/\r?\n/).length

/**
 * @param {{ path: string, source: string }[]} files repository-relative paths
 * @returns {{ exports: { path: string, name: string, line: number }[], dead: { path: string, name: string, line: number }[] }}
 */
export const findDeadExports = (files) => {
  const sources = new Map(files.map((file) => [file.path, file.source]))
  const exports = []
  for (const file of files) {
    DECLARATION_PATTERN.lastIndex = 0
    let match
    while ((match = DECLARATION_PATTERN.exec(file.source)) !== null) {
      exports.push({ path: file.path, name: match[1], line: lineNumberAt(file.source, match.index) })
    }
  }
  const dead = []
  for (const entry of exports) {
    const dynamicApi = DYNAMIC_ENTRIES.get(entry.path)
    if (dynamicApi !== undefined && dynamicApi.has(entry.name)) continue
    let outsideReferences = 0
    for (const [path, source] of sources) {
      if (path !== entry.path) outsideReferences += countReferences(source, entry.name)
    }
    const ownLines = sources.get(entry.path).split(/\r?\n/)
    const ownSource = ownLines.filter((_, index) => index + 1 !== entry.line).join('\n')
    if (outsideReferences === 0 && countReferences(ownSource, entry.name) === 0) dead.push(entry)
  }
  return { exports, dead }
}

const readSourceFiles = () =>
  walk(srcDir).map((absolutePath) => ({
    path: toRepoPath(absolutePath),
    source: readFileSync(absolutePath, 'utf8'),
  }))

test('every exported declaration in src is referenced', () => {
  const files = readSourceFiles()
  const { exports, dead } = findDeadExports(files)
  assert.ok(exports.length > 100, `expected to parse the production export surface, parsed ${exports.length}`)
  const deadExports = dead.map((entry) => `${entry.path}:${entry.name}`).sort()
  assert.deepEqual(deadExports, [], `dead exports (no reference outside the declaration line):\n${deadExports.join('\n')}`)
})

test('the dead-export scanner detects synthetic dead declarations', () => {
  const fixture = [
    {
      path: 'src/alpha.js',
      source: [
        'export const usedByOther = 1',
        'export function locallyUsed() {}',
        'locallyUsed()',
        '// DeadClass is mentioned only in a comment',
        'export class DeadClass {}',
        'export const allowlistedInOtherFile = 2',
        'export const ordinaryIndexExport = 3',
      ].join('\n'),
    },
    {
      path: 'src/beta.js',
      source: ["import { usedByOther } from './alpha.js'", 'console.log(usedByOther)'].join('\n'),
    },
    {
      path: 'src/index.js',
      source: [
        'export const Config = {}',
        'export function apply() {}',
        'export const inject = []',
        'export const name = "dsh-session-grove"',
        'export const helper = 1',
      ].join('\n'),
    },
  ]
  const { exports, dead } = findDeadExports(fixture)
  assert.equal(exports.length, 10)
  assert.deepEqual(
    dead.map((entry) => `${entry.path}:${entry.name}`).sort(),
    [
      'src/alpha.js:DeadClass',
      'src/alpha.js:allowlistedInOtherFile',
      'src/alpha.js:ordinaryIndexExport',
      'src/index.js:helper',
    ],
  )
})

test('the dead-export allowlist is scoped to the host dynamic entry API', () => {
  assert.deepEqual([...DYNAMIC_ENTRIES.get(HOST_ENTRY)].sort(), ['Config', 'apply', 'inject', 'name'])
  assert.deepEqual([...DYNAMIC_ENTRIES.get(CLIENT_ENTRY)].sort(), ['apply', 'inject', 'name'])
  const hostSource = readFileSync(join(srcDir, 'index.js'), 'utf8')
  DECLARATION_PATTERN.lastIndex = 0
  const declared = new Set()
  let match
  while ((match = DECLARATION_PATTERN.exec(hostSource)) !== null) declared.add(match[1])
  for (const name of DYNAMIC_ENTRIES.get(HOST_ENTRY)) {
    assert.ok(declared.has(name), `allowlisted host API ${name} is no longer exported by ${HOST_ENTRY}`)
  }
})
