#!/usr/bin/env node
/**
 * Release gate for dsh-session-grove.
 *
 * Dependency-free by design: this script runs both locally and inside
 * `.github/workflows/release.yml`, before the package is uploaded.
 *
 * It enforces the structural invariants that a tag-only release must satisfy:
 *   1. `package.json`, `dsh.plugin.json`, `src/shared/constants.js` and the
 *      `package-lock.json` root all carry the same version.
 *   2. When `GITHUB_REF_NAME` is set (release workflow), the tag is exactly
 *      `v<package.version>`.
 *   3. `docs/release-notes/v<version>.md` exists.
 *   4. `lib/client.js` carries `PLUGIN_VERSION = "<version>"`.
 *   5. Every path listed in `package.json.files` exists.
 *
 * All problems are collected before exiting, so one run reports every
 * mismatch instead of only the first one.
 */

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const readTextFile = (rootDir, relativePath, errors) => {
  const file = join(rootDir, relativePath)
  if (!existsSync(file)) {
    errors.push(`${relativePath}: file not found`)
    return null
  }
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    errors.push(`${relativePath}: cannot read (${error.message})`)
    return null
  }
}

const readJsonFile = (rootDir, relativePath, errors) => {
  const text = readTextFile(rootDir, relativePath, errors)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch (error) {
    errors.push(`${relativePath}: invalid JSON (${error.message})`)
    return null
  }
}

/**
 * Run every release check against a package root.
 *
 * @param {object} [options]
 * @param {string} [options.root] package root (defaults to `process.cwd()`)
 * @param {Record<string, string | undefined>} [options.env] environment used
 *   for the `GITHUB_REF_NAME` tag check (defaults to `process.env`)
 * @returns {{
 *   ok: boolean,
 *   version: string | null,
 *   tag: string | null,
 *   errors: string[],
 *   summary: string[],
 * }}
 */
export function checkRelease({ root = process.cwd(), env = process.env } = {}) {
  const rootDir = resolve(root)
  const errors = []

  const pkg = readJsonFile(rootDir, 'package.json', errors)
  const version =
    pkg && typeof pkg.version === 'string' && pkg.version.trim() !== '' ? pkg.version.trim() : null
  if (pkg && version === null) errors.push('package.json: missing non-empty string "version"')

  const compareVersion = (label, value) => {
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`${label}: version missing`)
      return
    }
    if (version === null) return // package.json itself is already reported
    if (value !== version) {
      errors.push(`${label}: version "${value}" does not match package.json "${version}"`)
    }
  }

  // 1. Version sources: manifest, constants module and lockfile root.
  const manifest = readJsonFile(rootDir, 'dsh.plugin.json', errors)
  if (manifest) compareVersion('dsh.plugin.json', manifest.version)

  const constants = readTextFile(rootDir, 'src/shared/constants.js', errors)
  if (constants !== null) {
    const match = constants.match(/export const PLUGIN_VERSION = '([^']*)'/)
    if (match) compareVersion('src/shared/constants.js', match[1])
    else errors.push('src/shared/constants.js: PLUGIN_VERSION declaration not found')
  }

  const lock = readJsonFile(rootDir, 'package-lock.json', errors)
  if (lock) {
    compareVersion('package-lock.json', lock.version)
    const lockRoot = lock.packages?.['']
    if (lockRoot) compareVersion('package-lock.json packages[""]', lockRoot.version)
    else errors.push('package-lock.json: packages[""] root entry not found')
  }

  // 2. Release tag must be exactly v<package.version>.
  const rawRef = typeof env?.GITHUB_REF_NAME === 'string' ? env.GITHUB_REF_NAME.trim() : ''
  let tag = null
  let tagLine = 'tag: not checked (GITHUB_REF_NAME is not set)'
  if (rawRef !== '') {
    tag = rawRef
    if (version === null) {
      errors.push(`GITHUB_REF_NAME: cannot verify tag "${rawRef}" without a package.json version`)
      tagLine = `tag: ${rawRef} (package version unknown)`
    } else {
      const expectedTag = `v${version}`
      if (rawRef === expectedTag) {
        tagLine = `tag: ${rawRef} matches GITHUB_REF_NAME`
      } else {
        errors.push(`GITHUB_REF_NAME: tag "${rawRef}" must be "${expectedTag}" for package version ${version}`)
        tagLine = `tag: ${rawRef} (expected ${expectedTag})`
      }
    }
  }

  // 3. Release note for the current version.
  const noteRel = version === null ? null : `docs/release-notes/v${version}.md`
  if (noteRel !== null) {
    const notePath = join(rootDir, noteRel)
    if (!existsSync(notePath)) errors.push(`${noteRel}: release note missing`)
    else if (!statSync(notePath).isFile()) errors.push(`${noteRel}: release note is not a file`)
  }

  // 4. The built client bundle must be stamped with the current version.
  const clientRel = 'lib/client.js'
  const clientSource = readTextFile(rootDir, clientRel, errors)
  if (clientSource !== null && version !== null) {
    const stamp = `PLUGIN_VERSION = "${version}"`
    if (!clientSource.includes(stamp)) {
      errors.push(`${clientRel}: missing ${stamp}; rebuild the client bundle after a version bump`)
    }
  }

  // 5. Every packaged path must exist (directories are allowed).
  let declaredPaths = 0
  let presentPaths = 0
  if (pkg) {
    if (!Array.isArray(pkg.files)) {
      errors.push('package.json: "files" must be an array')
    } else {
      declaredPaths = pkg.files.length
      if (declaredPaths === 0) errors.push('package.json: "files" must not be empty')
      for (const entry of pkg.files) {
        if (typeof entry !== 'string' || entry.trim() === '') {
          errors.push('package.json: "files" contains an empty or non-string entry')
          continue
        }
        const normalized = entry.replaceAll('\\', '/')
        if (isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) {
          errors.push(`package.json files entry "${entry}" must be relative`)
          continue
        }
        const absolute = resolve(rootDir, normalized)
        const relativePath = relative(rootDir, absolute)
        if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
          errors.push(`package.json files entry "${entry}" escapes the package root`)
          continue
        }
        if (!existsSync(absolute)) {
          errors.push(`packaged path "${entry}" does not exist`)
          continue
        }
        presentPaths += 1
      }
    }
  }

  const summary = []
  if (version !== null) {
    summary.push(
      `versions: ${version} (package.json, dsh.plugin.json, src/shared/constants.js, package-lock.json)`,
    )
  }
  if (noteRel !== null) summary.push(`release note: ${noteRel}`)
  if (clientSource !== null && version !== null) {
    summary.push(`bundle: lib/client.js carries PLUGIN_VERSION = "${version}"`)
  }
  summary.push(tagLine)
  summary.push(`packaged paths: ${presentPaths}/${declaredPaths} exist`)

  return { ok: errors.length === 0, version, tag, errors, summary }
}

const invokedPath = process.argv[1]
const isDirectRun = (() => {
  if (!invokedPath) return false
  try {
    return realpathSync(invokedPath) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()

if (isDirectRun) {
  const result = checkRelease()
  if (result.ok) {
    console.log(`release check: dsh-session-grove ${result.version}`)
    for (const line of result.summary) console.log(`  ${line}`)
    console.log('release check: OK')
  } else {
    const plural = result.errors.length === 1 ? 'error' : 'errors'
    console.error(`release check: FAILED (${result.errors.length} ${plural})`)
    for (const error of result.errors) console.error(`  - ${error}`)
    process.exitCode = 1
  }
}
