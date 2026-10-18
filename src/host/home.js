/**
 * Harness-home resolution for the record file.
 *
 * Frozen contract: docs/CONTRACTS.md §0/§2.
 * - Prefer the host's own `dshHomePath('storages')` helper from
 *   `@deepseek-ai/dsh-home-paths` (declared in peerDependencies, which is what
 *   makes the linked-plugin import resolve through app-boot's module routing).
 * - Fallback order: `profileContext.home` (the launcher's own answer) ->
 *   `$DSH_HOME` -> `~/.dsh`; the winning source is reported in the startup log
 *   so Gate 1 can audit where records live.
 * - Resolution is synchronous so `apply()` can stay a plain void-returning
 *   Cordis plugin (async apply also works, but the frozen entry shape is sync).
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { RECORD_FILE_NAME, STORAGE_DIR_NAME } from './constants.js'
import { serviceOf } from './service.js'

// Re-exported for the host-home contract: `dshHomePath('storages')` is the
// documented resolution entry point.
export { dshHomePath }

/**
 * Resolve the storages directory for this host.
 * @param {object} ctx plugin context (reads `profileContext` as a fallback).
 * @param {{ storageDir?: string, homePathModule?: object | null }} config
 *   test seams: a direct directory override or an injected home-path module.
 * @returns {{ dir: string, source: string }}
 */
export const resolveStorageDir = (ctx, config = {}) => {
  if (typeof config.storageDir === 'string' && config.storageDir.length > 0) {
    return { dir: config.storageDir, source: 'config.storageDir' }
  }

  const homePathModule =
    config.homePathModule === null ? undefined : (config.homePathModule ?? { dshHomePath })
  if (homePathModule !== undefined && typeof homePathModule.dshHomePath === 'function') {
    try {
      return { dir: homePathModule.dshHomePath(STORAGE_DIR_NAME), source: 'dshHomePath("storages")' }
    } catch {
      // Fall through to the profile/environment answers.
    }
  }

  const profileContext = serviceOf(ctx, 'profileContext')
  if (typeof profileContext?.home === 'string' && profileContext.home.length > 0) {
    return { dir: join(profileContext.home, STORAGE_DIR_NAME), source: 'profileContext.home' }
  }
  if (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.length > 0) {
    return { dir: join(process.env.DSH_HOME, STORAGE_DIR_NAME), source: 'DSH_HOME' }
  }
  return { dir: join(homedir(), '.dsh', STORAGE_DIR_NAME), source: 'homedir()/.dsh' }
}

/**
 * Resolve the full record-file path plus the storage directory and source.
 * @param {object} ctx plugin context.
 * @param {{ filePath?: string, storageDir?: string, homePathModule?: object | null }} config
 */
export const resolveRecordPath = (ctx, config = {}) => {
  const storage = resolveStorageDir(ctx, config)
  const filePath =
    typeof config.filePath === 'string' && config.filePath.length > 0
      ? config.filePath
      : join(storage.dir, RECORD_FILE_NAME)
  return { filePath, storageDir: storage.dir, storageSource: storage.source }
}
