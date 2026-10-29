/**
 * Revisioned, atomically written JSON store for the group document.
 *
 * Frozen contract: docs/CONTRACTS.md §2 "File".
 * Target: `<dshHomePath('storages')>/dsh-session-groups.json`.
 *
 * - missing file -> empty document, revision 0;
 * - JSON parse failure -> quarantine as `dsh-session-groups.corrupt-<ts>.json`,
 *   empty doc + warning `corrupt-file`;
 * - shape/invariant failure -> same quarantine, warning `invalid-file`;
 * - `version > 1` -> `unsupported-version`, never overwritten;
 * - write path: unique temp name -> fsync -> copy previous to `.bak` ->
 *   rename -> directory fsync (where supported); Windows EPERM/EBUSY retried
 *   3x with 20ms backoff;
 * - every public operation runs on one promise tail (in-process
 *   serialization; V1 is single-window, no cross-process lock).
 *
 * Shared model owns document validation: `validateDoc` from
 * `src/shared/model.js` (icon is opaque string <= 64 chars there, per Gate 0
 * ruling C7; the store never re-normalizes icons).
 */

import { randomBytes } from 'node:crypto'
import { copyFile, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { DOC_VERSION } from '../shared/constants.js'
import { emptyDoc, normalizeColorHex, validateDoc } from '../shared/model.js'
import { RECORD_FILE_NAME } from './constants.js'

const RETRYABLE_CODES = new Set(['EACCES', 'EPERM', 'EBUSY', 'EMFILE', 'ENFILE'])
const WRITE_ATTEMPTS = 4
const WRITE_RETRY_DELAY_MS = 20

const sleep = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })

/** Retry the transient Windows sharing/lock failures an atomic replace can hit. */
const withRetries = async (operation) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      const code = error?.code ?? ''
      if (attempt >= WRITE_ATTEMPTS || !RETRYABLE_CODES.has(code)) throw error
      await sleep(WRITE_RETRY_DELAY_MS)
    }
  }
}

const pathExists = async (path) => {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Normalize valid custom hex values before validation (0.2.7). Short/uppercase
 * forms are canonicalized; invalid values stay untouched so validateDoc keeps
 * rejecting them (and load keeps the existing quarantine policy).
 */
const normalizeGroupColorHex = (groups) =>
  Array.isArray(groups)
    ? groups.map((group) => {
        if (!isObject(group) || group.colorHex === undefined) return group
        const hex = normalizeColorHex(group.colorHex)
        return hex && hex !== group.colorHex ? { ...group, colorHex: hex } : group
      })
    : groups

const errorMessage = (error) => (error instanceof Error ? error.message : String(error))

/** Best-effort directory fsync (Windows cannot open a directory as a file). */
const syncDirectory = async (directory) => {
  let handle
  try {
    handle = await open(directory, 'r')
    await handle.sync()
  } catch {
    // Durability point unavailable on this platform; file fsync already ran.
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

const quarantineTimestamp = (now) => new Date(now()).toISOString().replaceAll(':', '-').replaceAll('.', '-')

/**
 * Create the store over one record file.
 *
 * Accepted shapes (frozen contract leaves the internal factory to Host, the
 * integration harness documents `{ dir, fileName }`; the bridge also accepts
 * the explicit `filePath` used by unit tests):
 *   createStore({ dir, fileName })
 *   createStore({ filePath })
 *
 * @param {{ filePath?: string, dir?: string, fileName?: string, now?: () => number }} options
 */
export const createStore = (options = {}) => {
  const { filePath: explicitPath, dir, fileName, now = () => Date.now() } = options
  const filePath =
    typeof explicitPath === 'string' && explicitPath.length > 0
      ? explicitPath
      : typeof dir === 'string' && dir.length > 0 && typeof fileName === 'string' && fileName.length > 0
        ? join(dir, fileName)
        : undefined
  if (filePath === undefined) {
    throw new Error('createStore: pass { filePath } or { dir, fileName }')
  }
  const directory = dirname(filePath)
  const backupPath = `${filePath}.bak`
  const expectedName = RECORD_FILE_NAME

  let tail = Promise.resolve()
  const enqueue = (task) => {
    const run = tail.then(task, task)
    tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  const temporaryPathForWrite = () => `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`

  const quarantinePath = async () => {
    const stamp = quarantineTimestamp(now)
    let candidate = join(directory, `${basename(expectedName, '.json')}.corrupt-${stamp}.json`)
    for (let suffix = 1; await pathExists(candidate); suffix += 1) {
      candidate = join(directory, `${basename(expectedName, '.json')}.corrupt-${stamp}-${suffix}.json`)
    }
    return candidate
  }

  /** Move an untrusted file aside; copy+remove fallback if rename is blocked. */
  const quarantine = async (reason, detail) => {
    const target = await quarantinePath()
    let quarantinedTo = null
    try {
      await withRetries(() => rename(filePath, target))
      quarantinedTo = target
    } catch {
      try {
        await withRetries(() => copyFile(filePath, target))
        await withRetries(() => rm(filePath, { force: true }))
        quarantinedTo = target
      } catch {
        // Leaving the untrusted file in place is safer than deleting it; the
        // next commit overwrites it, and the warning still reports the problem.
        quarantinedTo = null
      }
    }
    return { kind: 'ok', doc: emptyDoc(), revision: 0, exists: false, warning: reason, detail, quarantinedTo }
  }

  /** Read and classify the current file. Never mutates a trusted document. */
  const readState = async () => {
    let text
    try {
      text = await readFile(filePath, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return { kind: 'ok', doc: emptyDoc(), revision: 0, exists: false }
      throw error
    }

    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      return await quarantine('corrupt-file', `invalid JSON: ${errorMessage(error)}`)
    }
    if (!isObject(parsed)) {
      return await quarantine('corrupt-file', 'document is not a JSON object')
    }
    if (typeof parsed.version === 'number' && parsed.version > DOC_VERSION) {
      return { kind: 'unsupported-version', version: parsed.version, path: filePath }
    }
    if (parsed.version !== DOC_VERSION) {
      return await quarantine(
        'invalid-file',
        `version must be ${String(DOC_VERSION)} (got ${JSON.stringify(parsed.version)})`,
      )
    }
    // 0.2.7: a hand-edited valid custom hex (short/uppercase) is normalized to
    // the canonical lowercase #rrggbb before validation. Truly invalid values
    // (alpha, named colors, malformed strings) stay untouched and are rejected
    // below, preserving the existing quarantine policy.
    parsed.groups = normalizeGroupColorHex(parsed.groups)
    const verdict = validateDoc(parsed)
    if (!verdict.ok) {
      return await quarantine('invalid-file', verdict.errors.join('; '))
    }
    return { kind: 'ok', doc: parsed, revision: parsed.revision, exists: true }
  }

  /**
   * Persist one validated document. The caller owns the revision decision.
   * @param {object} doc validated document
   * @param {number} revision host-owned revision to stamp
   */
  const writeDoc = async (doc, revision) => {
    const persisted = {
      version: DOC_VERSION,
      revision,
      groups: doc.groups,
      ungrouped: doc.ungrouped,
    }
    await mkdir(directory, { recursive: true })
    const text = `${JSON.stringify(persisted, null, 2)}\n`
    const temporaryPath = temporaryPathForWrite()
    const handle = await open(temporaryPath, 'w')
    try {
      await handle.writeFile(text, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      if (await pathExists(filePath)) {
        await withRetries(() => copyFile(filePath, backupPath))
      }
      await withRetries(() => rename(temporaryPath, filePath))
      await syncDirectory(directory)
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    }
    return persisted
  }

  const validateForWrite = (doc) => {
    // The host owns `revision`: whatever the caller put in the document is
    // ignored (clients send it only as `baseRevision`). Validate the frozen
    // shape/invariants via the shared model on a revision-stamped candidate.
    const candidate = {
      version: isObject(doc) ? doc.version : undefined,
      revision: 0,
      groups: isObject(doc) ? normalizeGroupColorHex(doc.groups) : undefined,
      ungrouped: isObject(doc) ? doc.ungrouped : undefined,
    }
    const verdict = validateDoc(candidate)
    if (!verdict.ok) {
      return { ok: false, errors: verdict.errors, candidate }
    }
    return { ok: true, errors: [], candidate }
  }

  return {
    path: filePath,
    backupPath,

    /** Read the current document. */
    load() {
      return enqueue(readState)
    },

    /** Host-owned write: stamp revision = current + 1. */
    save(doc) {
      return enqueue(async () => {
        const current = await readState()
        if (current.kind === 'unsupported-version') {
          throw Object.assign(new Error(`unsupported document version ${String(current.version)}`), {
            code: 'unsupported-version',
          })
        }
        const verdict = validateForWrite(doc)
        if (!verdict.ok) {
          throw Object.assign(new Error(verdict.errors.join('; ')), { code: 'invalid', errors: verdict.errors })
        }
        return await writeDoc(verdict.candidate, current.revision + 1)
      })
    },

    /**
     * Compare-and-set commit: read, compare baseRevision, validate, write all
     * on the same serialized critical section.
     */
    commit(baseRevision, doc) {
      return enqueue(async () => {
        const current = await readState()
        if (current.kind === 'unsupported-version') return current
        if (current.revision !== baseRevision) {
          return { kind: 'conflict', doc: current.doc, revision: current.revision }
        }
        const verdict = validateForWrite(doc)
        if (!verdict.ok) return { kind: 'invalid', errors: verdict.errors }
        const persisted = await writeDoc(verdict.candidate, current.revision + 1)
        return { kind: 'ok', doc: persisted, revision: persisted.revision }
      })
    },
  }
}
