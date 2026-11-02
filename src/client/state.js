/**
 * Client view state for the global session groups sidebar.
 *
 * Pure, React-free module: tests import it directly; the bundle wires it to
 * components. The store owns only *view* state (mode, filters, expansion, menus,
 * loaded doc snapshot). Host-owned data (titles, archive flags, workspace
 * membership) is never copied here beyond the current confirmed doc.
 */
import { ARCHIVE_FILTERS } from '../shared/constants.js'
import { emptyDoc } from '../shared/model.js'

/** localStorage key for the sidebar mode (`groups` | `workspace`). */
export const VIEW_MODE_KEY = 'dsh-session-groups.view.v1'
/** localStorage key for the archive tri-state filter. */
export const ARCHIVE_FILTER_KEY = 'dsh-session-groups.archive.v1'
/** localStorage key for persisted group expansion (collapsed ids only). */
export const COLLAPSED_KEY = 'dsh-session-groups.collapsed.v1'
/** localStorage key for the one-time groups-view onboarding card. */
export const ONBOARDING_KEY = 'dsh-session-groups.onboarded.v1'

/** Modes understood by the sidebar controller. */
export const VIEW_MODES = Object.freeze(['workspace', 'groups'])

/** Safe localStorage accessor (SSR / tests / disabled storage return null). */
export const safeStorage = () => {
  try {
    const storage = globalThis.localStorage
    if (storage && typeof storage.getItem === 'function') return storage
  } catch {
    /* storage may be blocked by the host document policy */
  }
  return null
}

/** Read the persisted view mode; default is the shipped workspace browser. */
export const readViewMode = (storage = safeStorage()) => {
  try {
    return storage?.getItem(VIEW_MODE_KEY) === 'groups' ? 'groups' : 'workspace'
  } catch {
    return 'workspace'
  }
}

/** Persist the view mode (best effort: blocked storage keeps session state only). */
export const writeViewMode = (mode, storage = safeStorage()) => {
  try {
    storage?.setItem(VIEW_MODE_KEY, mode === 'groups' ? 'groups' : 'workspace')
  } catch {
    /* ignore */
  }
}

/** Read the persisted archive filter; default hides archived sessions. */
export const readArchiveFilter = (storage = safeStorage()) => {
  try {
    const raw = storage?.getItem(ARCHIVE_FILTER_KEY)
    return ARCHIVE_FILTERS.includes(raw) ? raw : 'hidden'
  } catch {
    return 'hidden'
  }
}

/** Persist the archive filter. */
export const writeArchiveFilter = (filter, storage = safeStorage()) => {
  try {
    storage?.setItem(ARCHIVE_FILTER_KEY, ARCHIVE_FILTERS.includes(filter) ? filter : 'hidden')
  } catch {
    /* ignore */
  }
}

/** Read persisted collapsed group ids; malformed storage falls back to all expanded. */
export const readCollapsed = (storage = safeStorage()) => {
  try {
    const raw = storage?.getItem(COLLAPSED_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const collapsed = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (id && value === true) collapsed[id] = true
    }
    return collapsed
  } catch {
    return {}
  }
}

/** Persist collapsed group ids; best effort, never blocks the tree. */
export const writeCollapsed = (collapsed, storage = safeStorage()) => {
  try {
    const normalized = {}
    for (const [id, value] of Object.entries(collapsed ?? {})) {
      if (id && value === true) normalized[id] = true
    }
    storage?.setItem(COLLAPSED_KEY, JSON.stringify(normalized))
  } catch {
    /* ignore */
  }
}

/** Whether the user has dismissed the first-run onboarding card. */
export const readOnboardingDone = (storage = safeStorage()) => {
  try {
    return storage?.getItem(ONBOARDING_KEY) === '1'
  } catch {
    return false
  }
}

/** Persist the onboarding dismissal; best effort. */
export const writeOnboardingDone = (storage = safeStorage()) => {
  try {
    storage?.setItem(ONBOARDING_KEY, '1')
  } catch {
    /* ignore */
  }
}

/** Initial snapshot for {@link createStore}. */
const initialSnapshot = (storage) => ({
  viewMode: readViewMode(storage),
  archiveFilter: readArchiveFilter(storage),
  doc: emptyDoc(),
  revision: 0,
  /** idle | loading | ready | error */
  docState: 'idle',
  warning: null,
  /** last host-confirmed doc; commit failures revert to this */
  lastConfirmed: null,
  /** whether `doc` contains optimistic (not yet persisted) mutations */
  optimistic: false,
  /** group ids expanded in the tree (missing = expanded) */
  collapsed: readCollapsed(storage),
  /** current popover/menu descriptor, at most one at a time */
  menu: null,
  /** current modal descriptor (rename/new/delete/move/archive-running) */
  dialog: null,
  /** { kind, message } transient toast */
  toast: null,
  /** banner for load/commit/route failures */
  banner: null,
  /** in-flight doc write indicator */
  saving: false,
})

/**
 * Create the view store.
 * @param {{ storage?: Storage | null }} [options]
 * @returns {{
 *   getSnapshot: () => object,
 *   subscribe: (listener: () => void) => () => void,
 *   update: (patch: object | ((snapshot: object) => object)) => object,
 *   dispatch: (action: string, payload?: object) => object
 * }}
 */
export const createStore = ({ storage = safeStorage() } = {}) => {
  let snapshot = initialSnapshot(storage)
  const listeners = new Set()

  const getSnapshot = () => snapshot

  const subscribe = (listener) => {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const publish = (next) => {
    if (next.collapsed !== snapshot.collapsed) writeCollapsed(next.collapsed, storage)
    snapshot = next
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        /* a broken subscriber must not take down the view */
      }
    }
    return snapshot
  }

  const update = (patch) => {
    const next = typeof patch === 'function' ? patch(snapshot) : patch
    if (!next || next === snapshot) return snapshot
    return publish({ ...snapshot, ...next })
  }

  /**
   * Small action vocabulary so components never mutate the snapshot directly.
   * @param {string} action
   * @param {object} [payload]
   */
  const dispatch = (action, payload = {}) => {
    switch (action) {
      case 'view-mode': {
        const mode = payload.mode === 'groups' ? 'groups' : 'workspace'
        if (mode === snapshot.viewMode) return snapshot
        writeViewMode(mode, storage)
        return publish({ ...snapshot, viewMode: mode })
      }
      case 'archive-filter': {
        const filter = ARCHIVE_FILTERS.includes(payload.filter) ? payload.filter : 'hidden'
        if (filter === snapshot.archiveFilter) return snapshot
        writeArchiveFilter(filter, storage)
        return publish({ ...snapshot, archiveFilter: filter })
      }
      case 'load-start':
        return publish({ ...snapshot, docState: 'loading', banner: null })
      case 'load-success':
        return publish({
          ...snapshot,
          docState: 'ready',
          doc: payload.doc,
          revision: payload.revision,
          lastConfirmed: payload.doc,
          warning: payload.warning ?? null,
          optimistic: false,
          banner: payload.warning ? { kind: 'warning', code: payload.warning } : null,
        })
      case 'load-error':
        return publish({ ...snapshot, docState: 'error', banner: { kind: 'error', code: payload.code ?? 'load-failed' } })
      case 'doc': {
        const doc = payload.doc
        const revision = payload.revision ?? snapshot.revision
        return publish({ ...snapshot, doc, revision, lastConfirmed: doc, optimistic: false, banner: null })
      }
      case 'optimistic-doc':
        // Apply a drop to the view immediately. The revision is deliberately
        // untouched: it stays the last server-confirmed base for the async write.
        return publish({ ...snapshot, doc: payload.doc, optimistic: true })
      case 'optimistic-confirmed': {
        const keepDoc = payload.keepDoc === true
        return publish({
          ...snapshot,
          doc: keepDoc ? snapshot.doc : payload.confirmedDoc ?? snapshot.doc,
          revision: payload.revision ?? snapshot.revision,
          lastConfirmed: payload.confirmedDoc ?? snapshot.lastConfirmed,
          optimistic: keepDoc,
          banner: null,
        })
      }
      case 'optimistic-rollback':
        return publish({
          ...snapshot,
          doc: snapshot.lastConfirmed ?? snapshot.doc,
          optimistic: false,
          banner: payload.code
            ? { kind: payload.code === 'conflict' ? 'warning' : 'error', code: payload.code }
            : snapshot.banner,
        })
      case 'saving':
        return publish({ ...snapshot, saving: Boolean(payload.saving) })
      case 'commit-conflict':
        return publish({
          ...snapshot,
          doc: payload.doc ?? snapshot.doc,
          revision: payload.revision ?? snapshot.revision,
          lastConfirmed: payload.doc ?? snapshot.lastConfirmed,
          optimistic: false,
          banner: { kind: 'warning', code: 'conflict' },
        })
      case 'commit-error':
        return publish({ ...snapshot, banner: { kind: 'error', code: payload.code ?? 'commit-failed' } })
      case 'toggle-group': {
        const id = payload.id
        const collapsed = { ...snapshot.collapsed }
        if (collapsed[id]) delete collapsed[id]
        else collapsed[id] = true
        return publish({ ...snapshot, collapsed })
      }
      case 'expand-group': {
        if (!payload.id || !snapshot.collapsed[payload.id]) return snapshot
        const collapsed = { ...snapshot.collapsed }
        delete collapsed[payload.id]
        return publish({ ...snapshot, collapsed })
      }
      case 'collapse-group': {
        if (!payload.id) return snapshot
        return publish({ ...snapshot, collapsed: { ...snapshot.collapsed, [payload.id]: true } })
      }
      case 'reset-collapsed': {
        if (Object.keys(snapshot.collapsed).length === 0) return snapshot
        return publish({ ...snapshot, collapsed: {} })
      }
      case 'menu':
        return publish({ ...snapshot, menu: payload.menu ?? null })
      case 'dialog':
        return publish({ ...snapshot, dialog: payload.dialog ?? null })
      case 'toast':
        return publish({ ...snapshot, toast: payload.toast ?? null })
      case 'banner':
        return publish({ ...snapshot, banner: payload.banner ?? null })
      case 'locale-changed':
        return publish({ ...snapshot, localeRevision: (snapshot.localeRevision ?? 0) + 1 })
      default:
        return snapshot
    }
  }

  return { getSnapshot, subscribe, update, dispatch }
}
