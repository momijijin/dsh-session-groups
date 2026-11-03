/**
 * Read-only storage health inspection for the compatibility doctor.
 *
 * Deliberately does not use the store: `load()` quarantines a corrupt record
 * and creates a new file, which a diagnostic must never do. This module only
 * reads the record, its `.bak`, and the quarantine family.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { DOC_VERSION } from '../shared/constants.js'
import { normalizeColorHex, validateDoc } from '../shared/model.js'

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const exists = async (path) => {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

const normalizeGroups = (groups) =>
  Array.isArray(groups)
    ? groups.map((group) => {
        if (!isObject(group) || group.colorHex === undefined) return group
        const hex = normalizeColorHex(group.colorHex)
        return hex && hex !== group.colorHex ? { ...group, colorHex: hex } : group
      })
    : groups

/**
 * Inspect one record path without mutating anything.
 * @param {string} filePath
 * @returns {Promise<{status: string, revision: number|null, error: string|null, backup: boolean, quarantined: number}>}
 */
export const inspectStorageHealth = async (filePath) => {
  const directory = dirname(filePath)
  const result = {
    status: 'missing',
    revision: null,
    error: null,
    backup: false,
    quarantined: 0,
  }

  try {
    result.backup = await exists(`${filePath}.bak`)
  } catch {
    result.backup = false
  }

  try {
    const prefix = `${basename(filePath, '.json')}.corrupt-`
    const entries = await readdir(directory)
    result.quarantined = entries.filter((name) => name.startsWith(prefix) && name.endsWith('.json')).length
  } catch {
    result.quarantined = 0
  }

  let text
  try {
    text = await readFile(filePath, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      result.status = 'unreadable'
      result.error = error instanceof Error ? error.message : String(error)
    }
    return result
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    result.status = 'corrupt'
    result.error = error instanceof Error ? error.message : String(error)
    return result
  }
  if (!isObject(parsed)) {
    result.status = 'corrupt'
    result.error = 'document is not a JSON object'
    return result
  }
  result.revision = Number.isInteger(parsed.revision) ? parsed.revision : null
  if (typeof parsed.version === 'number' && parsed.version > DOC_VERSION) {
    result.status = 'unsupported-version'
    result.error = `document version ${String(parsed.version)} is newer than ${String(DOC_VERSION)}`
    return result
  }
  if (parsed.version !== DOC_VERSION) {
    result.status = 'invalid'
    result.error = `version must be ${String(DOC_VERSION)}`
    return result
  }
  const verdict = validateDoc({ ...parsed, groups: normalizeGroups(parsed.groups) })
  if (!verdict.ok) {
    result.status = 'invalid'
    result.error = verdict.errors.join('; ')
    return result
  }
  result.status = 'ok'
  return result
}
