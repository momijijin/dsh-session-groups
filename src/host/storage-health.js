/**
 * Read-only storage health inspection for the compatibility doctor.
 *
 * Deliberately does not use the store: `load()` quarantines a corrupt record
 * and creates a new file, which a diagnostic must never do. This module only
 * reads the record, its `.bak`, and the quarantine family.
 */
import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { DOC_VERSION } from '../shared/constants.js'
import { normalizeColorHex, validateDoc } from '../shared/model.js'

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const normalizeGroups = (groups) =>
  Array.isArray(groups)
    ? groups.map((group) => {
        if (!isObject(group) || group.colorHex === undefined) return group
        const hex = normalizeColorHex(group.colorHex)
        return hex && hex !== group.colorHex ? { ...group, colorHex: hex } : group
      })
    : groups

/**
 * Classify one record body without touching the filesystem.
 * @param {string} text
 * @returns {{status: string, revision: number|null, error: string|null}}
 */
const classifyText = (text) => {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { status: 'corrupt', revision: null, error: error instanceof Error ? error.message : String(error) }
  }
  if (!isObject(parsed)) {
    return { status: 'corrupt', revision: null, error: 'document is not a JSON object' }
  }
  const revision = Number.isInteger(parsed.revision) ? parsed.revision : null
  if (typeof parsed.version === 'number' && parsed.version > DOC_VERSION) {
    return {
      status: 'unsupported-version',
      revision,
      error: `document version ${String(parsed.version)} is newer than ${String(DOC_VERSION)}`,
    }
  }
  if (parsed.version !== DOC_VERSION) {
    return { status: 'invalid', revision, error: `version must be ${String(DOC_VERSION)}` }
  }
  const verdict = validateDoc({ ...parsed, groups: normalizeGroups(parsed.groups) })
  if (!verdict.ok) return { status: 'invalid', revision, error: verdict.errors.join('; ') }
  return { status: 'ok', revision, error: null }
}

/**
 * Inspect the optional backup without mutating it.
 * @param {string} path
 */
const inspectFile = async (path) => {
  try {
    return { exists: true, ...classifyText(await readFile(path, 'utf8')) }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { exists: false, status: 'missing', revision: null, error: null }
    }
    return {
      exists: true,
      status: 'unreadable',
      revision: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Inspect one record path without mutating anything.
 *
 * `backup` is kept as a boolean for backward compatibility; `backupStatus`,
 * `backupRevision` and `backupError` describe whether that backup is usable.
 *
 * @param {string} filePath
 * @returns {Promise<{
 *   status: string,
 *   revision: number|null,
 *   error: string|null,
 *   backup: boolean,
 *   backupStatus: string,
 *   backupRevision: number|null,
 *   backupError: string|null,
 *   quarantined: number
 * }>}
 */
export const inspectStorageHealth = async (filePath) => {
  const directory = dirname(filePath)
  const result = {
    status: 'missing',
    revision: null,
    error: null,
    backup: false,
    backupStatus: 'missing',
    backupRevision: null,
    backupError: null,
    quarantined: 0,
  }

  const backup = await inspectFile(`${filePath}.bak`)
  result.backup = backup.exists
  result.backupStatus = backup.status
  result.backupRevision = backup.revision
  result.backupError = backup.error

  try {
    const prefix = `${basename(filePath, '.json')}.corrupt-`
    const entries = await readdir(directory)
    result.quarantined = entries.filter((name) => name.startsWith(prefix) && name.endsWith('.json')).length
  } catch {
    result.quarantined = 0
  }

  const primary = await inspectFile(filePath)
  result.status = primary.status
  result.revision = primary.revision
  result.error = primary.error
  return result
}
