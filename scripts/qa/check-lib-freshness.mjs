/**
 * Verify the committed lib/ output matches a fresh build from src/.
 *
 * The gate rebuilds into lib/ and compares content hashes before/after; a stale
 * bundle (or a source change without a rebuild) fails. It is intentionally
 * dependency-free and uses the same build script as the release workflow.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const libDir = join(root, 'lib')
if (!existsSync(libDir)) {
  console.error('lib freshness: lib/ does not exist; run npm run build')
  process.exit(1)
}

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (entry.isFile()) out.push(path)
  }
  return out
}
const digest = () => {
  const hash = createHash('sha256')
  for (const file of walk(libDir).sort()) {
    hash.update(relative(libDir, file).replaceAll('\\', '/'))
    hash.update('\0')
    hash.update(readFileSync(file, 'utf8').replaceAll('\r\n', '\n'))
    hash.update('\0')
  }
  return hash.digest('hex')
}

const before = digest()
execFileSync(process.execPath, [join(root, 'scripts', 'build-client.mjs')], { cwd: root, stdio: 'inherit' })
const after = digest()
if (before !== after) {
  console.error(`lib freshness: FAILED; lib/ was stale (${before.slice(0, 12)} -> ${after.slice(0, 12)})`)
  process.exit(1)
}
console.log(`lib freshness: OK (${after.slice(0, 12)})`)
