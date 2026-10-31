/**
 * Host-half constants shared by the store, routes, and the Cordis entry.
 *
 * Frozen contract: docs/CONTRACTS.md §2.
 */

export const BASE_PATH = '/dsh-session-groups'

export const LOAD_PATH = `${BASE_PATH}/load`

export const COMMIT_PATH = `${BASE_PATH}/commit`

/** Diagnostics trace ingest route (0.2.5, additive; append-only NDJSON). */
export const DIAGNOSTICS_PATH = `${BASE_PATH}/diagnostics`

/** Diagnostics trace file under the Harness `storages` directory. */
export const DIAGNOSTICS_FILE_NAME = 'dsh-session-groups.diagnostics.ndjson'

/** Directory under the Harness home that holds the record file. */
export const STORAGE_DIR_NAME = 'storages'

/** Record file name under the storages directory. */
export const RECORD_FILE_NAME = 'dsh-session-groups.json'

/** Wire body ceiling from the contract: 256 KiB. */
export const MAX_BODY_BYTES = 256 * 1024

/** Diagnostics batch ceiling: bounded body and bounded event count. */
export const MAX_DIAGNOSTICS_BODY_BYTES = 256 * 1024
export const MAX_DIAGNOSTICS_EVENTS = 500

/** 0.2.18: keep the local trace bounded; truncate before appending past 8 MiB. */
export const MAX_DIAGNOSTICS_FILE_BYTES = 8 * 1024 * 1024
