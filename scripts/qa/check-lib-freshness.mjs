/**
 * Verify the committed lib/ output matches a fresh build from src/.
 *
 * Builds into a system temp directory and compares normalized content hashes;
 * the repository's lib/ is never modified. A stale bundle (or a source change
 * without a rebuild) fails.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'

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
const digest = (dir) => {
  const hash = createHash('sha256')
  for (const file of walk(dir).sort()) {
    hash.update(relative(dir, file).replaceAll('\\', '/'))
    hash.update('\0')
    hash.update(readFileSync(file, 'utf8').replaceAll('\r\n', '\n'))
    hash.update('\0')
  }
  return hash.digest('hex')
}

const expected = digest(libDir)
const tmp = mkdtempSync(join(tmpdir(), 'dsh-grove-lib-'))
execFileSync(process.execPath, [join(root, 'scripts', 'build-client.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, DSH_GROVE_BUILD_OUT: tmp },
})
const built = digest(tmp)
if (expected !== built) {
  console.error(`lib freshness: FAILED; lib/ is stale (${expected.slice(0, 12)} -> ${built.slice(0, 12)})`)
  process.exit(1)
}
console.log(`lib freshness: OK (${expected.slice(0, 12)})`)
