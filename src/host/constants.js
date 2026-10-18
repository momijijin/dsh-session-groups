/**
 * Host-half constants shared by the store, routes, and the Cordis entry.
 *
 * Frozen contract: docs/CONTRACTS.md §2.
 */

export const BASE_PATH = '/dsh-session-groups'

export const LOAD_PATH = `${BASE_PATH}/load`

export const COMMIT_PATH = `${BASE_PATH}/commit`

/** Directory under the Harness home that holds the record file. */
export const STORAGE_DIR_NAME = 'storages'

/** Record file name under the storages directory. */
export const RECORD_FILE_NAME = 'dsh-session-groups.json'

/** Wire body ceiling from the contract: 256 KiB. */
export const MAX_BODY_BYTES = 256 * 1024
