/**
 * Local release gate: syntax-check every source/test file, then run the suite.
 *
 * This is intentionally dependency-free so it works on a clean checkout before
 * `npm install`; React/host modules are not imported here.
 */
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const collect = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.spike-homes') continue
      collect(path, out)
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(path)
    }
  }
  return out
}

const files = [...collect(join(root, 'src')), ...collect(join(root, 'tests'))]
let failed = 0
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' })
  if (result.status !== 0) {
    failed += 1
    console.error(`syntax check failed: ${relative(root, file)}`)
  }
}
if (files.length === 0) {
  console.error('no source files found')
  process.exit(1)
}
if (failed > 0) process.exit(1)

const tests = spawnSync(process.execPath, ['--test', 'tests/**/*.test.js'], {
  stdio: 'inherit',
  cwd: root,
})
if (tests.error) {
  console.error(tests.error)
  process.exit(1)
}
process.exit(tests.status ?? 1)
