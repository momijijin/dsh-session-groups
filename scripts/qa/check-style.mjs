/**
 * Zero-dependency style guard.
 *
 * The project does not add ESLint/Prettier without an explicit dependency
 * decision, so this keeps the mechanical formatting rules enforceable in CI:
 * no tabs, no trailing whitespace, final newline, no UTF-8 BOM.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, extname } from 'node:path'

const root = process.cwd()
const roots = ['src', 'tests', 'scripts', 'e2e']
const extensions = new Set(['.js', '.mjs', '.cjs'])
const skipDirs = new Set(['node_modules', '.git', '.spike-homes', 'lib'])

const collect = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || skipDirs.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) collect(path, out)
    else if (entry.isFile() && extensions.has(extname(entry.name))) out.push(path)
  }
  return out
}

const files = roots.flatMap((dir) => {
  try {
    return collect(join(root, dir))
  } catch {
    return []
  }
})
const failures = []
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const label = relative(root, file)
  if (text.charCodeAt(0) === 0xfeff) failures.push(`${label}: UTF-8 BOM`)
  if (!text.endsWith('\n')) failures.push(`${label}: missing final newline`)
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].includes('\t')) failures.push(`${label}:${index + 1}: tab character`)
    if (/[ \t]+$/.test(lines[index])) failures.push(`${label}:${index + 1}: trailing whitespace`)
  }
}
if (failures.length > 0) {
  console.error(`style check: FAILED (${failures.length})`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}
console.log(`style check: OK (${files.length} files)`)
