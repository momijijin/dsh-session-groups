/**
 * Client plugin shell: view-mode controller, slot lifecycle, HTTP document
 * state, host action wiring and modal orchestration.
 *
 * One instance per page (the plugin is mounted once). `apply` must return void —
 * Cordis validates plugin return values as effects (Gate 0: returning an object
 * raises `TypeError: Invalid effect`).
 */
import { createGroup, deleteGroup, deleteGroupTo, moveGroup, renameGroup, setGroupColor, setGroupColorHex, setGroupIcon } from '../shared/model.js'
import { createApi } from './api.js'
import { createStore, safeStorage } from './state.js'
import { createActions } from './actions.js'
import { dictionaries, createTranslator, LOCALE_NS } from './locale.js'
import { createFloatingLabel } from './floating-label.js'
import { installStyles } from './css.js'
import { createOptimisticQueue } from './optimistic.js'
import {
  diagContext,
  diagEnabled,
  diagLabel,
  diagTrace,
  getDiagnostics,
  initDiagnostics,
} from './diagnostics.js'
import { perfCount, perfEnabled, perfMark, perfNow, perfSample } from './perf.js'
import { FooterAction, GroupsViewBoundary, setRuntime } from './components.js'

/** Single sidebar slot taken over while the groups view is active. */
export const VIEW_SLOT = 'sidebar.workspaces'
/** Footer action slot entry id (always registered). */
export const FOOTER_SLOT = 'sidebar.footer.action'
export const FOOTER_ID = 'dsh-session-groups.toggle'
/** Takeover priority: the shipped browser registers at 0, lowest renders. */
export const VIEW_PRIORITY = -1

const CENTER = { x: 24, y: 120 }

/** Safe `ctx.get` (services may not exist yet during apply; feature-detect). */
const safeGet = (ctx, name) => {
  try {
    return ctx.get(name) ?? null
  } catch {
    return null
  }
}

/**
 * Create the client plugin instance.
 */
export const createPlugin = () => {
  let mounted = false
  let ctxRef = null
  let store = null
  let api = null
  let t = (key) => key
  let localeService = null
  let toastTimer = null
  let floatingLabel = null
  let occupantDisposer = null
  let footerDisposer = null
  let styleDisposer = null
  let localeDisposer = null
  let loadPromise = null
  let commitTail = Promise.resolve()
  let queue = null
  let bridge = null

  const services = () => {
    const ctx = ctxRef
    if (!ctx) return { sessions: null, workspaces: null, uiWorkspace: null, layout: null }
    return {
      sessions: safeGet(ctx, 'sessions'),
      workspaces: safeGet(ctx, 'workspaces'),
      uiWorkspace: safeGet(ctx, 'uiWorkspace'),
      layout: safeGet(ctx, 'layout'),
    }
  }

  const notify = ({ kind = 'info', message = '' } = {}) => {
    if (!store || !message) return
    store.dispatch('toast', { toast: { kind, message } })
    if (toastTimer !== null) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      toastTimer = null
      store?.dispatch('toast', { toast: null })
    }, 2600)
  }

  // --- floating drag label (V1 drag affordance; document-level overlay) ----
  // One controller owns the single overlay node: it reuses a label left in the
  // DOM by an earlier instance, hides duplicates, caches text/visibility and
  // coalesces per-frame dragover writes. Diagnostics hear only real changes.
  const floatingLabelController = () => {
    if (floatingLabel === null) {
      floatingLabel = createFloatingLabel({
        document: globalThis.document,
        position: CENTER,
        onTextChange: (text) => {
          if (diagEnabled()) diagLabel(text)
        },
        perfEnabled,
        perfNow,
        perfSample,
      })
    }
    return floatingLabel
  }
  const setFloatingLabel = (text) => {
    if (!globalThis.document) return
    floatingLabelController().setText(text)
  }

  // --- document commit queue -------------------------------------------------
  /**
   * Non-optimistic commit (dialogs: create/rename/delete/icon/move-session/
   * move-group). Serialized with the optimistic queue: pending drops flush
   * first and the mutation resolves against the latest document, so a dialog
   * action can never overwrite a newer optimistic drop with a stale snapshot.
   * `saving` stays unpublished for the same reason as 0.2.2 (no view consumer).
   */
  const commitDoc = (nextDocOrUpdater) => {
    const run = commitTail.then(async () => {
      perfMark('commitDoc:start')
      try {
        perfMark('api:commit:start')
        const committed = await queue.commitStrict(nextDocOrUpdater)
        perfMark('api:commit:end', { ok: true })
        perfMark('store:doc')
        if (typeof globalThis.requestAnimationFrame === 'function') {
          globalThis.requestAnimationFrame(() => perfMark('frame:after-doc'))
        }
        return committed
      } catch (error) {
        perfMark('api:commit:end', { ok: false, code: error?.code ?? null })
        throw error
      } finally {
        perfMark('commitDoc:end')
      }
    })
    commitTail = run.catch(() => {})
    return run
  }

  /**
   * Optimistic drop commit: the next document is dispatched immediately against
   * the current optimistic doc; persistence runs through the coalescing queue.
   * `revision` stays server-confirmed until the write settles.
   */
  const commitOptimistic = (nextDocOrUpdater) => queue.commitOptimistic(nextDocOrUpdater)

  // --- document load ---------------------------------------------------------
  const load = () => {
    if (loadPromise !== null) return loadPromise
    loadPromise = (async () => {
      store.dispatch('load-start')
      try {
        const result = await api.load()
        if (result.ok === true) {
          store.dispatch('load-success', { doc: result.doc, revision: result.revision, warning: result.warning })
          return
        }
        store.dispatch('load-error', { code: result.routeUnavailable ? 'route-unavailable' : result.code ?? 'load-failed' })
      } catch (error) {
        store.dispatch('load-error', { code: 'load-failed' })
        if (globalThis.console?.warn) globalThis.console.warn('[dsh-session-groups] load failed', error)
      } finally {
        loadPromise = null
      }
    })()
    return loadPromise
  }

  const retryLoad = () => {
    if (store.getSnapshot().docState === 'loading') return load()
    return load()
  }

  // --- slot lifecycle -------------------------------------------------------
  const reportRegistrationFailure = (error) => {
    if (globalThis.console?.warn) globalThis.console.warn('[dsh-session-groups] sidebar registration failed', error)
    notify({ kind: 'error', message: t('error.title') })
    store.dispatch('banner', { banner: { kind: 'error', code: 'registration-failed' } })
  }

  const registerOccupant = () => {
    if (occupantDisposer !== null) return
    const ctx = ctxRef
    occupantDisposer = ctx.slots.inject(VIEW_SLOT, () => {
      try {
        return ctx.slots.register({ name: VIEW_SLOT, priority: VIEW_PRIORITY }, GroupsViewBoundary)
      } catch (error) {
        // Another priority -1 occupant exists: fail soft to footer-only.
        reportRegistrationFailure(error)
        return () => {}
      }
    })
  }

  const disposeOccupant = () => {
    if (occupantDisposer === null) return
    try {
      occupantDisposer()
    } finally {
      occupantDisposer = null
    }
  }

  const setMode = (mode) => {
    if (!store) return
    const next = mode === 'groups' ? 'groups' : 'workspace'
    store.dispatch('view-mode', { mode: next })
    if (diagEnabled()) {
      diagContext({ mode: next })
      diagTrace('mode.change', { mode: next })
    }
    if (next === 'groups') {
      registerOccupant()
      if (store.getSnapshot().docState === 'idle') load()
    } else {
      disposeOccupant()
    }
  }

  const toggleMode = () => setMode(store.getSnapshot().viewMode === 'groups' ? 'workspace' : 'groups')

  // --- host actions ---------------------------------------------------------
  const getDoc = () => store.getSnapshot().doc
  const actions = createActions({ getServices: services, getDoc, commitDoc, notify, t })

  const capabilities = () => {
    const { uiWorkspace } = services()
    return {
      pin: typeof uiWorkspace?.pinSession === 'function' && typeof uiWorkspace?.unpinSession === 'function',
      archive: typeof uiWorkspace?.archiveSession === 'function',
      unarchive: typeof uiWorkspace?.unarchiveSession === 'function',
      connect: typeof uiWorkspace?.connectWorkspace === 'function',
    }
  }

  const archiveSession = async (sessionId) => {
    const result = await actions.archiveSession(sessionId)
    if (result.ok) {
      notify({ kind: 'success', message: t('toast.saved') })
      return
    }
    if (result.refusal) {
      openDialog({
        kind: 'archive-running',
        titleKey: 'dialog.archiveRunning',
        sessionId,
        activity: result.refusal.activity,
      })
      return
    }
    notify({ kind: 'error', message: t('toast.archiveFailed') })
  }

  const unarchiveSession = async (sessionId) => {
    try {
      await actions.unarchiveSession(sessionId)
    } catch {
      /* createActions already notified */
    }
  }

  const pinSession = async (sessionId, pinned) => {
    const ok = await actions.pinSession(sessionId, pinned)
    if (!ok) notify({ kind: 'error', message: t('toast.pinFailed') })
  }

  // --- dialogs --------------------------------------------------------------
  const openDialog = (dialog) => {
    if (!store) return
    store.dispatch('dialog', { dialog: { x: CENTER.x, y: CENTER.y, ...dialog } })
  }

  const closeDialog = () => store.dispatch('dialog', { dialog: null })

  const failDialog = (messageKey) => {
    const dialog = store.getSnapshot().dialog
    if (dialog) store.dispatch('dialog', { dialog: { ...dialog, error: messageKey } })
  }

  const commitDocFromAction = async (nextDoc, successKey = 'toast.saved') => {
    const committed = await commitDoc(nextDoc)
    closeDialog()
    notify({ kind: 'success', message: t(successKey) })
    return committed
  }

  /** Empty-leaf delete (0.2.9): no dialog, one commit, group-deleted toast. */
  const deleteGroupDirect = async (groupId) => {
    try {
      return await commitDocFromAction((latest) => deleteGroup(latest, groupId), 'toast.groupDeleted')
    } catch (error) {
      notify({ kind: 'error', message: t('toast.deleteFailed') })
      if (globalThis.console?.warn) globalThis.console.warn('[dsh-session-groups] direct delete failed', error)
      return null
    }
  }

  const confirmDialog = async (dialog, payload = {}) => {
    try {
      switch (dialog.kind) {
        case 'new-group': {
          const name = typeof payload.value === 'string' ? payload.value.trim() : ''
          if (name === '') return failDialog('name-required')
          const next = (latest) => createGroup(latest, { name, parentId: dialog.parentId ?? null })
          await commitDocFromAction(next)
          return
        }
        case 'rename-group': {
          const name = typeof payload.value === 'string' ? payload.value.trim() : ''
          if (name === '') return failDialog('name-required')
          await commitDocFromAction((latest) => renameGroup(latest, dialog.groupId, name))
          return
        }
        case 'rename-session': {
          const value = typeof payload.value === 'string' ? payload.value.trim() : ''
          if (value === '') return failDialog('name-required')
          await actions.renameSession(dialog.sessionId, value)
          closeDialog()
          notify({ kind: 'success', message: t('toast.saved') })
          return
        }
        case 'delete-group': {
          await commitDocFromAction(
            (latest) => deleteGroupTo(latest, dialog.groupId, payload.destinationId ?? null),
            'toast.groupDeleted'
          )
          return
        }
        case 'icon': {
          await commitDocFromAction((latest) => setGroupIcon(latest, dialog.groupId, payload.icon))
          return
        }
        case 'group-color': {
          if (typeof payload.colorHex === 'string') {
            await commitDocFromAction((latest) => setGroupColorHex(latest, dialog.groupId, payload.colorHex))
          } else {
            await commitDocFromAction((latest) => setGroupColor(latest, dialog.groupId, payload.color))
          }
          return
        }
        case 'move-session': {
          await actions.moveSession(dialog.sessionId, payload.groupId ?? null, undefined)
          closeDialog()
          notify({ kind: 'success', message: t('toast.moved') })
          return
        }
        case 'move-group': {
          await commitDocFromAction((latest) => moveGroup(latest, dialog.groupId, payload.groupId ?? null, undefined))
          return
        }
        case 'new-session': {
          if (typeof payload.workspaceId !== 'string' || payload.workspaceId === '') return failDialog('dialog.createFailed')
          const result = await actions.createSessionInGroup({ groupId: dialog.groupId, workspaceId: payload.workspaceId })
          if (store.getSnapshot().archiveFilter === 'only') {
            setArchiveFilter('all')
            notify({ kind: 'info', message: t('toast.archivedFilterChanged') })
          }
          closeDialog()
          notify({ kind: 'success', message: t('toast.saved') })
          return result
        }
        case 'archive-running': {
          const result = await actions.archiveSession(dialog.sessionId, { stopActivity: true })
          closeDialog()
          if (result.ok) notify({ kind: 'success', message: t('toast.saved') })
          else notify({ kind: 'error', message: t('toast.archiveFailed') })
          return
        }
        default:
          closeDialog()
      }
    } catch (error) {
      if (dialog.kind === 'rename-session') notify({ kind: 'error', message: t('toast.renameFailed') })
      else if (
        dialog.kind === 'delete-group' ||
        dialog.kind === 'new-group' ||
        dialog.kind === 'rename-group' ||
        dialog.kind === 'icon' ||
        dialog.kind === 'group-color' ||
        dialog.kind === 'move-group'
      ) {
        failDialog('commit-failed')
      } else notify({ kind: 'error', message: t('toast.dropFailed') })
      if (globalThis.console?.warn) globalThis.console.warn('[dsh-session-groups] dialog action failed', error)
    }
  }

  const setArchiveFilter = (filter) => store.dispatch('archive-filter', { filter })

  // --- mounting -------------------------------------------------------------
  const mount = (ctx) => {
    if (mounted) return
    mounted = true
    ctxRef = ctx
    store = createStore({ storage: safeStorage() })
    if (perfEnabled()) store.subscribe(() => perfCount('store:publish'))
    // Drag diagnostics are enabled by default in 0.2.5; localStorage
    // `dsh-session-groups.diagnostics='0'` opts out without a rebuild.
    initDiagnostics()
    api = createApi({ documentRef: globalThis.document, trace: (type, detail) => diagTrace(type, detail) })
    if (diagEnabled()) diagContext({ mode: store.getSnapshot().viewMode })
    localeService = safeGet(ctx, 'locale')
    const getLocaleSnapshot = () => {
      try {
        return localeService?.getSnapshot?.() ?? localeService?.getLocale?.() ?? null
      } catch {
        return null
      }
    }
    t = createTranslator(getLocaleSnapshot)
    queue = createOptimisticQueue({
      store,
      commit: (doc, revision) => api.commit(doc, revision),
      notify,
      t: (key, params) => t(key, params),
      trace: (type, detail) => diagTrace(type, detail),
    })

    styleDisposer = installStyles(globalThis.document)
    // Register our dictionaries with the host locale service when available.
    try {
      const disposer = localeService?.register?.(LOCALE_NS, { zh: dictionaries.zh, en: dictionaries.en })
      if (typeof disposer === 'function') localeDisposer = disposer
    } catch {
      /* locale service optional */
    }

    bridge = {
      store,
      t,
      api,
      actions,
      notify,
      archiveSession,
      unarchiveSession,
      pinSession,
      commitDoc,
      commitOptimistic,
      load,
      retryLoad,
      setMode,
      toggleMode,
      openDialog,
      confirmDialog,
      deleteGroupDirect,
      setArchiveFilter,
      setFloatingLabel,
      startDragLabel: () => {},
      showToast: (kind, message) => notify({ kind, message }),
      get capabilities() {
        return capabilities()
      },
    }
    setRuntime(bridge)

    // Footer action is always registered, whatever the view mode.
    footerDisposer = ctx.slots.inject(FOOTER_SLOT, () =>
      ctx.slots.register({ name: FOOTER_SLOT, id: FOOTER_ID, order: 100 }, FooterAction)
    )

    // Outside click / Escape close transient UI.
    const doc = globalThis.document
    const onPointerDown = (event) => {
      if (!store.getSnapshot().menu) return
      // Clicks inside a popover/dialog belong to it; the capture listener must not
      // remove the element before the click lands.
      if (typeof event?.target?.closest === 'function' && event.target.closest('.dsg-menu, .dsg-dialog')) return
      store.dispatch('menu', { menu: null })
    }
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      if (store.getSnapshot().dialog) closeDialog()
      else if (store.getSnapshot().menu) store.dispatch('menu', { menu: null })
    }
    // A row menu is anchored to a viewport point: any document scroll or window
    // resize makes that anchor stale, so close it (scrolls inside the menu itself
    // stay usable). Focus restoration happens in MenuPopover's unmount cleanup.
    const closeMenuOnViewportChange = (event) => {
      if (!store.getSnapshot().menu) return
      const target = event?.target
      if (target && typeof target.closest === 'function' && target.closest('.dsg-menu, .dsg-dialog')) return
      store.dispatch('menu', { menu: null })
    }
    doc?.addEventListener?.('pointerdown', onPointerDown, true)
    doc?.addEventListener?.('keydown', onKeyDown, true)
    doc?.addEventListener?.('scroll', closeMenuOnViewportChange, true)
    globalThis.addEventListener?.('resize', closeMenuOnViewportChange)

    // Mode controller + unload cleanup are one effect: the disposer is owned by
    // the plugin fiber (Gate 0 verified slot lifecycle).
    ctx.effect(() => {
      if (store.getSnapshot().viewMode === 'groups') {
        registerOccupant()
        load()
      }
      return () => {
        disposeOccupant()
        if (typeof footerDisposer === 'function') footerDisposer()
        footerDisposer = null
        if (typeof localeDisposer === 'function') localeDisposer()
        localeDisposer = null
        if (typeof styleDisposer === 'function') styleDisposer()
        styleDisposer = null
        doc?.removeEventListener?.('pointerdown', onPointerDown, true)
        doc?.removeEventListener?.('keydown', onKeyDown, true)
        doc?.removeEventListener?.('scroll', closeMenuOnViewportChange, true)
        globalThis.removeEventListener?.('resize', closeMenuOnViewportChange)
        floatingLabel?.dispose()
        floatingLabel = null
        queue?.dispose()
        queue = null
        getDiagnostics()?.dispose()
        if (toastTimer !== null) clearTimeout(toastTimer)
        toastTimer = null
      }
    }, 'dsh-session-groups: lifecycle')
  }

  return { mount }
}
