/**
 * Client plugin shell: view-mode controller, slot lifecycle, HTTP document
 * state, host action wiring and modal orchestration.
 *
 * One instance per page (the plugin is mounted once). `apply` must return void —
 * Cordis validates plugin return values as effects (Gate 0: returning an object
 * raises `TypeError: Invalid effect`).
 */
import { createGroup, assignSession, deleteGroup, deleteGroupTo, moveGroup, renameGroup, setGroupColor, setGroupColorHex, setGroupIcon } from '../shared/model.js'
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
  diagnosticsEnabled,
  getDiagnostics,
  initDiagnostics,
  stopDiagnostics,
} from './diagnostics.js'
import { perfCount, perfEnabled, perfMark, perfNow, perfSample } from './perf.js'
import { installClientRuntime } from '../adapters/client-runtime.js'
import { CLIENT_REQUIRED, compatibilityReport, detectClientCapabilities } from '../adapters/dsh-capabilities.js'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { GroupsViewBoundary } from './components.js'
import { SkillRepairCard } from './skill-repair.js'
import {
  applyManagedWidth,
  clearManagedWidth,
  findLayoutNodes,
  isSidebarCollapsed,
  readSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
  updateManagedWidth,
  writeSidebarWidth,
} from './sidebar-width.js'
import { clearDialogGeometries } from './dialog-geometry.js'
import { installWorkspaceToggle } from './workspace-toggle.js'

/** Single sidebar slot taken over while the groups view is active. */
export const VIEW_SLOT = 'sidebar.workspaces'
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
  let styleDisposer = null
  let workspaceToggle = null
  let widthRetryTimer = null
  let localeDisposer = null
  let localeSubscriptionDisposer = null
  let configSlotDisposer = null
  let perfDisposer = null
  let loadPromise = null
  let commitTail = Promise.resolve()
  let queue = null
  let bridge = null
  let debugProbe = false
  let changeSource = null
  let refreshPending = false
  let refreshForced = false
  let latestSeenRevision = 0
  let storeSubscriptionDisposer = null

  const services = () => {
    const ctx = ctxRef
    if (!ctx) return { sessions: null, workspaces: null, uiWorkspace: null, layout: null, remoteAccess: null }
    return {
      sessions: safeGet(ctx, 'sessions'),
      workspaces: safeGet(ctx, 'workspaces'),
      uiWorkspace: safeGet(ctx, 'uiWorkspace'),
      layout: safeGet(ctx, 'layout'),
      remoteAccess: safeGet(ctx, 'remoteAccess'),
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
      let loadedOk = false
      try {
        const result = await api.load()
        if (result.ok === true) {
          debugProbe = result.debugProbe === true
          if (result.diagnostics === true) {
            if (!diagEnabled()) initDiagnostics({ enabled: true })
          } else if (diagEnabled()) {
            stopDiagnostics()
          }
          store.dispatch('load-success', { doc: result.doc, revision: result.revision, warning: result.warning })
          loadedOk = true
          return
        }
        store.dispatch('load-error', { code: result.routeUnavailable ? 'route-unavailable' : result.code ?? 'load-failed' })
      } catch (error) {
        store.dispatch('load-error', { code: 'load-failed' })
        if (globalThis.console?.warn) globalThis.console.warn('[dsh-session-groups] load failed', error)
      } finally {
        loadPromise = null
        // A newer revision may have arrived while this read was in flight, or
        // a refresh may have been deferred behind an optimistic write. Re-check
        // against the just-loaded snapshot before declaring the view settled.
        if (loadedOk && (refreshPending || latestSeenRevision > store.getSnapshot().revision)) {
          const pendingForce = refreshForced
          queueMicrotask(() => requestRefresh({ force: pendingForce }))
        }
      }
    })()
    return loadPromise
  }

  const retryLoad = () => {
    if (store.getSnapshot().docState === 'loading') return load()
    return load()
  }

  const requestRefresh = ({ force = false } = {}) => {
    const snapshot = store.getSnapshot()
    if (loadPromise !== null || snapshot.docState === 'loading' || snapshot.optimistic) {
      refreshPending = true
      refreshForced = refreshForced || force
      return loadPromise
    }
    if (!force && latestSeenRevision <= snapshot.revision) {
      refreshPending = false
      refreshForced = false
      return null
    }
    refreshPending = false
    refreshForced = false
    return load()
  }

  const acceptExternalRevision = (revision) => {
    if (!Number.isInteger(revision) || revision < 0) return
    latestSeenRevision = Math.max(latestSeenRevision, revision)
    if (revision <= store.getSnapshot().revision) return
    requestRefresh()
  }

  const startChangeStream = () => {
    if (storeSubscriptionDisposer === null) {
      storeSubscriptionDisposer = store.subscribe(() => {
        if (!refreshPending) return
        const snapshot = store.getSnapshot()
        if (snapshot.optimistic || snapshot.docState === 'loading') return
        requestRefresh({ force: refreshForced })
      })
    }
    const EventSourceImpl = globalThis.EventSource
    if (typeof EventSourceImpl !== 'function' || changeSource !== null) return
    try {
      changeSource = new EventSourceImpl('/dsh-session-groups/events', { withCredentials: true })
      changeSource.addEventListener?.('revision', (event) => {
        try {
          const payload = JSON.parse(event.data)
          acceptExternalRevision(payload?.revision)
        } catch {
          /* ignore malformed invalidation */
        }
      })
      changeSource.onopen = () => {
        // Reconnect recovery: catch revisions committed while the stream was down.
        requestRefresh({ force: true })
      }
    } catch {
      changeSource = null
    }
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
        // Another priority -1 occupant exists: report the takeover failure.
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

  /** Locate the host layout from whichever view currently owns the sidebar. */
  const findLiveLayoutNodes = () => {
    const doc = globalThis.document
    const groupsRoot = doc?.querySelector?.('.dsg-root')
    if (groupsRoot) return findLayoutNodes(groupsRoot)
    const officialHandle = doc?.querySelector?.('[data-side="sidebar"]')
    return officialHandle ? findLayoutNodes(officialHandle) : null
  }

  const syncSidebarWidth = () => {
    const nodes = findLiveLayoutNodes()
    if (!nodes?.supported) return false
    // Host rail mode owns the 56px width; report success so the retry timer
    // stops instead of reapplying our 264..420px override.
    if (isSidebarCollapsed(nodes)) return true
    return applyManagedWidth(nodes, readSidebarWidth(), globalThis.innerWidth || 1440) !== null
  }

  /** Restore the plugin-owned layout preferences without touching group data. */
  const resetLayout = () => {
    writeSidebarWidth(SIDEBAR_WIDTH_DEFAULT)
    store?.dispatch('reset-collapsed')
    clearDialogGeometries()
    syncSidebarWidth()
    notify({ kind: 'success', message: t('toast.layoutReset') })
    return true
  }

  /**
   * Official workspace mode has no plugin slot in its header, so render one
   * overlay action just left of the shipped search control. The same controller
   * clears automatically when the groups header returns.
   */
  const syncWorkspaceChrome = () => {
    const mode = store?.getSnapshot().viewMode
    if (mode === 'workspace') {
      if (workspaceToggle === null) {
        workspaceToggle = installWorkspaceToggle({
          doc: globalThis.document,
          label: t('footer.toGroups'),
          onToggle: () => toggleMode(),
        })
      } else {
        workspaceToggle.update()
      }
    } else {
      workspaceToggle?.dispose()
      workspaceToggle = null
    }
    if (!syncSidebarWidth() && widthRetryTimer === null) {
      widthRetryTimer = setTimeout(() => {
        widthRetryTimer = null
        if (mounted) syncWorkspaceChrome()
      }, 50)
    }
  }

  const setMode = (mode) => {
    if (!store) return
    const next = mode === 'groups' ? 'groups' : 'workspace'
    store.dispatch('view-mode', { mode: next })
    syncWorkspaceChrome()
    if (diagEnabled()) {
      diagContext({ mode: next })
      diagTrace('mode.change', { mode: next })
    }
    if (next === 'groups') {
      registerOccupant()
      // Re-read the Host document every time the groups view becomes active.
      // requestRefresh defers while an optimistic write is still unsettled.
      requestRefresh({ force: true })
    } else {
      disposeOccupant()
    }
  }

  const toggleMode = () => setMode(store.getSnapshot().viewMode === 'groups' ? 'workspace' : 'groups')

  // --- host actions ---------------------------------------------------------
  const getDoc = () => store.getSnapshot().doc
  const actions = createActions({ getServices: services, getDoc, commitDoc, notify, t, clipboard: writeClipboard })

  const capabilities = () => {
    const { uiWorkspace, remoteAccess } = services()
    return {
      fork: (sessionId) => {
        if (typeof uiWorkspace?.forkSession !== 'function') return false
        try {
          return remoteAccess?.source?.('session', sessionId, 'session/fork') === true
        } catch {
          return false
        }
      },
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

  const forkSession = async (sessionId) => {
    let childId = null
    try {
      childId = await actions.forkSession(sessionId, (id) => {
        childId = id
      })
    } catch (error) {
      const code = error?.rpcError?.code
      const messageKey =
        code === 'session/migration-required'
          ? 'toast.forkRequiresOpen'
          : code === 'session/fork-unavailable'
            ? 'toast.forkUnavailable'
            : 'toast.forkFailed'
      notify({ kind: 'error', message: t(messageKey) })
      return
    }
    if (typeof childId !== 'string' || childId === '') {
      notify({ kind: 'error', message: t('toast.forkFailed') })
      return
    }
    try {
      await commitDoc((latest) => {
        const source = latest.groups.find((group) => group.sessionIds.includes(sessionId))
        return assignSession(latest, childId, source?.id ?? null, 0)
      })
      notify({ kind: 'success', message: t('toast.forked') })
    } catch {
      notify({ kind: 'error', message: t('toast.forkPlacementFailed') })
    }
  }

  const copySessionId = async (sessionId) => {
    const copied = await actions.copySessionId(sessionId)
    notify({
      kind: copied ? 'success' : 'error',
      message: t(copied ? 'toast.sessionIdCopied' : 'toast.sessionIdCopyFailed'),
    })
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
          // Dialog moves are discoverability actions: put the session at the
          // target group's session head so the watermark cannot hide it.
          await actions.moveSession(dialog.sessionId, payload.groupId ?? null, 0)
          closeDialog()
          notify({ kind: 'success', message: t('toast.moved') })
          return
        }
        case 'move-group': {
          // Same rule for groups: the moved group becomes the first child.
          await commitDocFromAction((latest) => moveGroup(latest, dialog.groupId, payload.groupId ?? null, 0))
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
    const clientCompatibility = compatibilityReport(
      detectClientCapabilities(ctx, services()),
      CLIENT_REQUIRED,
    )
    if (!clientCompatibility.supported) {
      globalThis.console?.warn?.(
        `[dsh-session-groups] missing client capabilities: ${clientCompatibility.missing.join(', ')}`,
      )
    }
    store = createStore({ storage: safeStorage() })
    if (perfEnabled()) perfDisposer = store.subscribe(() => perfCount('store:publish'))
    // Diagnostics are opt-in (0.2.18): either the generic plugin-config switch
    // arrives in the load response, or a developer/localStorage override is set.
    if (diagnosticsEnabled()) initDiagnostics()
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
    // The host translator owns the active-locale fallback chain. Keep the local
    // translator only as a feature-detection fallback for older compositions.
    t =
      typeof localeService?.bind === 'function'
        ? localeService.bind(LOCALE_NS)
        : createTranslator(getLocaleSnapshot)
    queue = createOptimisticQueue({
      store,
      commit: (doc, revision) => api.commit(doc, revision),
      notify,
      t: (key, params) => t(key, params),
      trace: (type, detail) => diagTrace(type, detail),
    })

    styleDisposer = installStyles(globalThis.document)
    // The package detail page renders plugins.bundle.config. Use the bundle
    // slot so settings are one click from the plugin list; the row page should
    // not be the only path to configuration.
    const currentConfigForm = () => {
      try {
        return ctx.get?.('configForms')?.get?.('dsh-session-groups') ?? null
      } catch {
        return null
      }
    }
    try {
      configSlotDisposer = ctx.slots?.inject?.('plugins.bundle.config', () =>
        ctx.slots.register(
          {
            name: 'plugins.bundle.config',
            key: 'dsh-session-groups',
            inject: () => ({ form: currentConfigForm() }),
          },
          SkillRepairCard,
        ),
      )
    } catch {
      /* compatible with host versions without the plugins settings slot */
    }
    // Register our dictionaries with the host locale service when available.
    // Register only the locales the host currently exposes. Do not call
    // addLanguage and do not add a plugin picker: extra locale files remain
    // dormant until the host catalog supports them.
    try {
      const disposer = localeService?.register?.(LOCALE_NS, { zh: dictionaries.zh, en: dictionaries.en })
      if (typeof disposer === 'function') localeDisposer = disposer
      const unsubscribe = localeService?.subscribe?.(() => {
        try {
          store?.dispatch('locale-changed')
        } catch {
          /* locale refresh must not break the view */
        }
      })
      if (typeof unsubscribe === 'function') localeSubscriptionDisposer = unsubscribe
    } catch {
      /* locale service optional */
    }

    bridge = {
      store,
      t,
      api,
      actions,
      get debugProbe() {
        return debugProbe
      },
      refreshRuntimeConfig: () => requestRefresh({ force: true }),
      notify,
      archiveSession,
      unarchiveSession,
      forkSession,
      copySessionId,
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
      resetLayout,
      setFloatingLabel,
      startDragLabel: () => {},
      showToast: (kind, message) => notify({ kind, message }),
      get capabilities() {
        return capabilities()
      },
      compatibility: clientCompatibility,
    }
    installClientRuntime(bridge)
    startChangeStream()

    const onWindowResize = () => {
      if (updateManagedWidth(readSidebarWidth(), globalThis.innerWidth || 1440) === null) syncSidebarWidth()
      workspaceToggle?.update()
    }
    globalThis.addEventListener?.('resize', onWindowResize)
    syncWorkspaceChrome()

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
        if (widthRetryTimer !== null) clearTimeout(widthRetryTimer)
        widthRetryTimer = null
        workspaceToggle?.dispose()
        workspaceToggle = null
        globalThis.removeEventListener?.('resize', onWindowResize)
        clearManagedWidth()
        if (typeof localeDisposer === 'function') localeDisposer()
        localeDisposer = null
        if (typeof localeSubscriptionDisposer === 'function') localeSubscriptionDisposer()
        localeSubscriptionDisposer = null
        if (typeof configSlotDisposer === 'function') configSlotDisposer()
        configSlotDisposer = null
        if (typeof storeSubscriptionDisposer === 'function') storeSubscriptionDisposer()
        storeSubscriptionDisposer = null
        changeSource?.close?.()
        changeSource = null
        refreshPending = false
        refreshForced = false
        latestSeenRevision = 0
        if (typeof perfDisposer === 'function') perfDisposer()
        perfDisposer = null
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
