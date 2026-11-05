/**
 * React components for the groups sidebar (plain `createElement`, no JSX).
 *
 * Components are registered into DSH slots and receive the framework standard
 * toolkit as props (`useSessions`, `useWorkspaces`, `useSessionStatus`,
 * `usePanelInfo`, `…`) plus the slot owner share. Everything host-derived is read
 * from those hooks; the only local state is this plugin's view store.
 */
import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import { useGroupsSidebarWidth } from './groups-view-width.js'
import { useGroupsViewState } from './groups-view-state.js'
import { useGroupsSearchReveal } from './groups-view-search.js'
import { createMenuHandlers } from './groups-view-menu-handlers.js'
import { createDialogHandlers } from './groups-view-dialog-handlers.js'
import { clientRuntime as rt } from '../adapters/client-runtime.js'
import { findGroup, moveGroup } from '../shared/model.js'
import { currentGroupIdOf, findGroupsFlat } from '../core/dialog-selection.js'
import { MenuPopover, Toast } from './session-menu.js'
import { DialogHost } from './dialog-host.js'
import { countTreeSessions, sessionTitle } from '../core/filter.js'
import { applyDrop, hitTest, sameDropTarget, stickyDropTarget, ungroupedBodyTarget } from '../core/drag.js'
import { diagContext, diagDragEnd, diagDragStart, diagDropState, diagEnabled, diagHandler, diagRender, diagTargetChange, diagTrace } from './diagnostics.js'
import { GROUP_DRAG_MIME, groupHeaderZoneFromRect, isCurrentGroupPosition, resolveGroupDrop } from '../core/group-drag.js'
import { perfDragOver, perfDropTarget, perfEnabled, perfMark, perfNow, perfRender, perfSample } from './perf.js'
import { readOnboardingDone, writeOnboardingDone } from './state.js'
import { SIDEBAR_WIDTH_MIN } from './sidebar-width.js'
import { expandAncestors, isExpanded } from '../core/tree.js'
import { GROUP_DROP_NOOP, useViewStore, usePerfCommit, dispatch, toast, TextButton, DropPlaceholder, GROUP_PLACEHOLDER_HEIGHT } from './components-primitives.js'
import { SessionRow, GroupNode } from './components-rows.js'
import { UngroupedSection } from './components-ungrouped.js'
import { ResizeHandle } from './components-resize-handle.js'
import { OnboardingCard, Header, Banner, Rail, FlatFallback, ErrorBoundary } from './components-header.js'
const h = createElement
// ---------------------------------------------------------------------------
// Runtime bridge is installed by plugin.js through the DSH client adapter.
// ---------------------------------------------------------------------------
// Session row
// ---------------------------------------------------------------------------
/**
 * 0.2.20: a stream/frame snapshot rebuilds the whole tree. The row only needs
 * to repaint when display data, status, workspace, archive flag or active
 * highlight changes; handlers are the stable proxy supplied by GroupsView.
 * Comparison policy lives in src/core/session-row.js.
 */
// Ungrouped section (virtualized)
// ---------------------------------------------------------------------------
/**
 * Estimated initial viewport for the first render before the real `.dsg-tree`
 * metrics are measured. Pure arithmetic lives in src/core/layout.js; the host
 * viewport probe stays here.
 */
// Resize handle (groups view, wide only)
// ---------------------------------------------------------------------------
/**
 * Six-pixel separator pinned to the right edge of the sidebar column. Dragging
 * reports live clamped widths; commit persists. Pointer capture is best-effort
 * because synthetic pointer events may not be capturable.
 */
// Search combobox (groups view header, second row)
// ---------------------------------------------------------------------------
/** Stable id so `aria-controls` points at the listbox while it is rendered. */
// Header / banner / toast / dialogs / menus / rail / footer / flat fallback
// ---------------------------------------------------------------------------
/**
 * Three-row view-options popover (feedback item 3): the archive tri-state moves
 * out of the always-visible header into the official-style view menu. Each row
 * is 30px, carries the current check and dispatches the existing
 * `archive-filter` action before closing.
 */
export const GroupsView = (props) => {
  const store = useViewStore()
  const wide = props?.wide !== false
  const perfRenderStart = perfEnabled() ? perfNow() : 0
  perfRender('GroupsView')
  diagRender('GroupsView')
  const {
    sessions,
    workspaces,
    statuses,
    runningSessions,
    blockedSessions,
    unreadSessions,
    byId,
    workspaceItems,
    archivedSessionIds,
    currentId,
    highlightCurrent,
    tree,
  } = useGroupsViewState({ store, props })

  // Stable handler proxy owns no data itself; every call reads the latest
  // handlersRef, so memoized rows can keep a stable handler identity.
  const handlersRef = useRef(null)
  const stableHandlers = useMemo(
    () =>
      new Proxy(
        {},
        {
          get: (_target, property) => (...args) => handlersRef.current?.[property]?.(...args),
        },
      ),
    [],
  )
  const [dragState, setDragState] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const [onboardingOpen, setOnboardingOpen] = useState(() => !readOnboardingDone())
  const dismissOnboarding = () => {
    writeOnboardingDone()
    setOnboardingOpen(false)
  }
  // Latest committed target, compared with stable equality before every React
  // update. Dragover fires continuously while the pointer rests on one row and
  // rebuilds an equivalent object each time; updating state unconditionally
  // re-rendered the whole tree on every event (0.2.2 perf probe: 48 renders for
  // 45 stationary dragovers, 800 SessionRow renders for 30 paced dragovers).
  const dropTargetRef = useRef(null)
  /**
   * Drop-target setter used by every drag handler: skips React when the stable
   * target descriptor is unchanged. The opt-in probe records set attempts and
   * the ones that actually changed the rendered target.
   */
  const setDropTargetTracked = (next) => {
    if (next === null) dragTargetLockRef.current = null
    if (sameDropTarget(dropTargetRef.current, next)) {
      if (perfEnabled()) perfDropTarget(false)
      return
    }
    // Diagnostics: record the stable target transition before React updates; the
    // helper also emits placeholder insert/remove for the placeholder kinds.
    if (diagEnabled()) diagTargetChange(dropTargetRef.current, next)
    dropTargetRef.current = next
    if (!perfEnabled()) {
      setDropTarget(next)
      return
    }
    const started = perfNow()
    setDropTarget(next)
    perfDropTarget(true, perfNow() - started)
  }
  // Search highlight is a transient DOM class (1.5 s) on the revealed row: the
  // rows are plain React nodes and the class must survive the host-triggered
  // re-render right after openSession without adding new view-store state.
  const autoExpandRef = useRef({ groupId: null, timer: null })
  const dragRef = useRef(null)
  const dragTargetLockRef = useRef(null)
  const suppressedClickRef = useRef(null)
  // Pointerdown origin for the group row: a dragstart always targets the
  // draggable row, so the button check must be captured on pointerdown (where the
  // target really is the `+`/`…` button) and consumed by onGroupDragStart.
  const buttonPointerRef = useRef(null)
  dragRef.current = dragState
  /** Locked target for the current resting pointer position (0.2.21). */
  const stickyTargetFor = (event) =>
    stickyDropTarget(dragTargetLockRef.current, event?.clientX, event?.clientY)
  const lockTargetAt = (event, target) => {
    if (!target || !event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return
    dragTargetLockRef.current = { x: event.clientX, y: event.clientY, target }
  }
  // Sidebar width override state. `preferredWidth` is the persisted preference;
  // the applied width is always its viewport clamp, so a narrow viewport never
  // destroys the stored preference.
  const rootRef = useRef(null)
  /** True only when the drag pointer is definitely outside the sidebar root. */
  const pointerOutsideRoot = (event) => {
    const root = rootRef.current
    const rect = root?.getBoundingClientRect?.()
    if (!rect) return false
    const x = event?.clientX
    const y = event?.clientY
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false
    return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom
  }
  // Imperative bridge to the virtualized ungrouped list (search reveal).
  const virtualRef = useRef(null)
  const {
    viewportWidth,
    appliedWidth,
    maxAppliedWidth,
    widthSupported,
    handleWidthChange,
    handleWidthCommit,
    handleWidthReset,
  } = useGroupsSidebarWidth({ wide, docState: store?.docState, rootRef })
  const t = rt()?.t ?? ((key) => key)
  const { clearSearchHit, revealSearchRow, selectSearchResult } = useGroupsSearchReveal({ rootRef, tree, store, t, virtualRef })
  const direction = rt()?.direction === 'rtl' ? 'rtl' : 'ltr'
  // Auto-expand ancestors of the current session when the view opens.
  useEffect(() => {
    if (!store || store.docState !== 'ready' || !currentId) return
    const entry = findGroup(store.doc, currentGroupIdOf(store.doc, currentId))
    if (!entry) return
    const ancestors = expandAncestors(store.collapsed, store.doc, entry.id)
    if (ancestors !== store.collapsed) store.update({ collapsed: ancestors })
  }, [currentId, store?.docState, store?.doc])
  usePerfCommit('groups-view', perfRenderStart)
  if (!wide) return h(Rail, { props })
  if (store === null) return h('div', { class: 'dsg-root', 'data-testid': 'session-groups-view', dir: direction }, t('flat.title'))
  // Flat fallback for load/route/commit failures (CONTRACTS §6).
  if (store.docState === 'error') return h(FlatFallback, { props, store, reason: store.banner?.code === 'route-unavailable' ? 'route-unavailable' : 'error' })
  const ungroupedCount = tree.ungrouped.length
  // Diagnostics run context: every traced event carries the current revision,
  // optimistic flag, tree counts, viewport and applied sidebar width. Building
  // the patch object is skipped entirely when diagnostics are off.
  if (diagEnabled()) {
    diagContext({
      mode: store.viewMode,
      revision: store.revision,
      optimistic: store.optimistic === true,
      groups: store.doc.groups.length,
      ungrouped: ungroupedCount,
      visibleSessions: countTreeSessions(tree),
      viewport: globalThis.innerWidth || viewportWidth,
      sidebarWidth: appliedWidth,
    })
  }
  // Row components read current/drop state; merge it into the snapshot handed down.
  const viewState = {
    ...store,
    currentSessionId: highlightCurrent,
    dropTarget,
    draggedGroupId: dragState?.kind === 'group' ? dragState.groupId : null,
  }
  const treeEmpty = tree.groups.length === 0 && tree.ungrouped.length === 0
  const commitDrop = async (source, target) => {
    perfMark('commitDrop:start', { kind: target?.kind ?? null })
    if (diagEnabled()) {
      const accepted = Boolean(source && target && target.kind !== 'invalid')
      diagTrace(accepted ? 'drop.accept' : 'drop.reject', {
        dragKind: source?.kind ?? null,
        kind: target?.kind ?? null,
        sessionId: source?.sessionId ?? null,
        targetSessionId: target?.sessionId ?? null,
        groupId: target?.groupId ?? null,
      })
      diagDropState(accepted ? 'accepted' : 'invalid', { kind: target?.kind ?? null })
    }
    setDropTargetTracked(null)
    setDragState(null)
    if (!source || !target || target.kind === 'invalid') return
    const visibleUngrouped = tree.ungrouped.map((node) => node.session.id)
    try {
      // Optimistic (0.2.4): resolve against the current optimistic doc so the
      // row moves in this tick; the queue persists/coalesces/reconciles async.
      await rt()?.commitOptimistic((currentDoc) => applyDrop(currentDoc, source, target, visibleUngrouped).doc)
    } catch (error) {
      if (error?.reported === true) return
      toast('error', t('toast.dropFailed'))
      if (globalThis.console?.warn) globalThis.console.warn('[dsh-session-grove] drop failed', error)
    }
  }
  /**
   * Commit a group drag. The gesture stores only the stable target descriptor;
   * the numeric parent/index is resolved inside the queued updater against the
   * latest confirmed doc (B5). A same-parent/current-position drop throws the
   * no-op sentinel before the queue sends any request, so no revision is bumped.
   */
  const commitGroupDrop = async (draggedId, target) => {
    perfMark('commitGroupDrop:start', { kind: target?.kind ?? null })
    if (diagEnabled()) {
      diagTrace('drop.accept', {
        dragKind: 'group',
        kind: target?.kind ?? null,
        groupId: draggedId,
        targetId: target?.targetId ?? null,
        parentId: target?.parentId ?? null,
        beforeGroupId: target?.beforeGroupId ?? null,
      })
      diagDropState('accepted', { kind: target?.kind ?? null })
    }
    setDropTargetTracked(null)
    setDragState(null)
    dragRef.current = null
    rt()?.setFloatingLabel?.(null)
    try {
      await rt()?.commitOptimistic((latest) => {
        const resolved = resolveGroupDrop({ doc: latest, draggedId, target })
        if (resolved.invalid) {
          const error = new Error(resolved.reason)
          error.groupDropInvalid = true
          throw error
        }
        if (isCurrentGroupPosition(latest, draggedId, resolved, target)) throw GROUP_DROP_NOOP
        return moveGroup(latest, draggedId, resolved.parentId, resolved.index)
      })
    } catch (error) {
      if (error === GROUP_DROP_NOOP) return
      if (error?.reported === true) return
      if (error?.groupDropInvalid) {
        toast('error', t('drag.groupInvalid'))
        return
      }
      if (error?.message === 'depth-exceeded') {
        toast('error', t('drag.depthExceeded'))
        return
      }
      if (error?.message === 'cycle') {
        toast('error', t('drag.groupInvalid'))
        return
      }
      toast('error', t('toast.dropFailed'))
      if (globalThis.console?.warn) globalThis.console.warn('[dsh-session-grove] group drop failed', error)
    }
  }
  const clearAutoExpand = () => {
    const current = autoExpandRef.current
    if (current.timer !== null) clearTimeout(current.timer)
    if (current.timer !== null && diagEnabled()) diagTrace('autoexpand.cancel', { groupId: current.groupId })
    autoExpandRef.current = { groupId: null, timer: null }
  }
  const scheduleAutoExpand = (groupId) => {
    const collapsedNow = !isExpanded(store.collapsed, groupId)
    if (!collapsedNow) return clearAutoExpand()
    const current = autoExpandRef.current
    if (current.groupId === groupId && current.timer !== null) return
    clearAutoExpand()
    if (diagEnabled()) diagTrace('autoexpand.schedule', { groupId, delayMs: 500 })
    const timer = setTimeout(() => {
      if (diagEnabled()) diagTrace('autoexpand.fire', { groupId })
      dispatch('expand-group', { id: groupId })
      autoExpandRef.current = { groupId: null, timer: null }
    }, 500)
    autoExpandRef.current = { groupId, timer }
  }
  const rowDragOver = (event, target) => {
    const drag = dragRef.current
    if (!drag) return
    const sticky = stickyTargetFor(event)
    if (sticky) {
      // The placeholder itself moved the row under the pointer. Keep the
      // already-rendered target until the pointer deliberately moves.
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    setDropTargetTracked(target)
    lockTargetAt(event, target)
  }
  const ungroupedBodyRows = (container) =>
    [...(container?.querySelectorAll?.('[data-session-id]') ?? [])].map((row) => {
      const rect = row.getBoundingClientRect()
      return { sessionId: row.getAttribute('data-session-id'), top: rect.top, height: rect.height }
    })
  const groupOwnedIds = (groupId) => {
    const group = findGroup(store.doc, groupId)
    return group ? group.sessionIds : []
  }
  const groupDragId = () => (dragRef.current?.kind === 'group' ? dragRef.current.groupId : null)
  /** Translate the view drop-target vocabulary to the resolver target shape. */
  const resolveTargetFor = (viewTarget) => {
    switch (viewTarget?.kind) {
      case 'group-before':
        return { kind: 'before', targetId: viewTarget.targetId }
      case 'group-after':
        return { kind: 'after', targetId: viewTarget.targetId }
      case 'group-child':
        return { kind: 'child', parentId: viewTarget.parentId, beforeGroupId: viewTarget.beforeGroupId ?? null }
      case 'group-root-end':
        return { kind: 'root-end' }
      default:
        return null
    }
  }
  /**
   * Live indicator for a group drop. Invalid targets (self/descendant, missing
   * anchors) render the forbidden state and never accept the drop.
   */
  const previewGroupDrop = (event, viewTarget, label) => {
    const draggedId = groupDragId()
    if (!draggedId) return
    if (stickyTargetFor(event)) {
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      return
    }
    const resolved = resolveGroupDrop({ doc: store.doc, draggedId, target: resolveTargetFor(viewTarget) })
    if (resolved.invalid) {
      setDropTargetTracked({ ...viewTarget, kind: 'group-forbidden' })
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
      rt()?.setFloatingLabel?.(t('drag.groupInvalid'))
      return
    }
    rowDragOver(event, viewTarget)
    rt()?.setFloatingLabel?.(label)
  }
  /** Top/bottom edge zone of a group header; the middle 50% is invalid. */
  const groupHeaderZone = (row, clientY) => groupHeaderZoneFromRect(row?.getBoundingClientRect?.(), clientY)
  /** Consume the click synthesized right after a dragstart (400 ms guard). */
  const consumeDragClick = (groupId) => {
    const marker = suppressedClickRef.current
    if (!marker) return false
    suppressedClickRef.current = null
    return marker.groupId === groupId && Date.now() - marker.at <= 400
  }
  const handlers = {
    ...createMenuHandlers({ t, dragRef, consumeDragClick, handleWidthReset, selectSearchResult }),
    ...createDialogHandlers({ store, t, byId, workspaceItems, currentId }),
    onDragStart: (sessionId) => {
      const row = byId[sessionId]
      dragRef.current = {
        kind: 'session',
        sessionId,
        label: sessionTitle(row, { blankLabel: t('session.blank'), untitledLabel: t('session.untitled') }),
      }
      // Never trace the session title: the id is the only session identity in
      // the diagnostics file (privacy rule in diagnostics.js).
      if (diagEnabled()) diagDragStart('session', { sessionId })
      suppressedClickRef.current = null
      dragTargetLockRef.current = null
      setDragState(dragRef.current)
      rt()?.startDragLabel?.(dragRef.current.label)
    },
    onGroupPointerDown: (event, group) => {
      const target = event.target
      const insideButton = target && typeof target.closest === 'function' && target.closest('button')
      if (!insideButton) {
        buttonPointerRef.current = null
        return
      }
      const marker = { groupId: group.id, at: Date.now() }
      buttonPointerRef.current = marker
      const doc = globalThis.document
      const clear = () => {
        if (buttonPointerRef.current === marker) buttonPointerRef.current = null
        doc?.removeEventListener?.('pointerup', clear, true)
        doc?.removeEventListener?.('pointercancel', clear, true)
      }
      doc?.addEventListener?.('pointerup', clear, true)
      doc?.addEventListener?.('pointercancel', clear, true)
    },
    onGroupDragStart: (event, group) => {
      // A dragstart always targets the draggable row, never the inner button, so
      // the origin is remembered from pointerdown. Without this, a slight
      // movement while pressing `+`/`…` starts a real group drag (and its drop
      // can reorder/reparent) even though the click is suppressed afterwards.
      const pointer = buttonPointerRef.current
      buttonPointerRef.current = null
      const fromButton =
        pointer !== null && pointer !== undefined && pointer.groupId === group.id && Date.now() - pointer.at <= 5000
      const origin = event.target
      const originIsButton = origin && typeof origin.closest === 'function' && origin.closest('button')
      if (fromButton || originIsButton) {
        event.preventDefault()
        return
      }
      if (event.dataTransfer) {
        event.dataTransfer.setData(GROUP_DRAG_MIME, group.id)
        event.dataTransfer.setData('text/plain', group.name)
        event.dataTransfer.effectAllowed = 'move'
      }
      const drag = { kind: 'group', groupId: group.id, label: group.name }
      dragRef.current = drag
      if (diagEnabled()) diagDragStart('group', { groupId: group.id, name: group.name })
      suppressedClickRef.current = { groupId: group.id, at: Date.now() }
      dragTargetLockRef.current = null
      setDragState(drag)
      setDropTargetTracked(null)
      rt()?.startDragLabel?.(group.name)
    },
    onDragEnd: () => {
      if (diagEnabled()) diagDragEnd()
      buttonPointerRef.current = null
      clearAutoExpand()
      dragRef.current = null
      setDragState(null)
      setDropTargetTracked(null)
      rt()?.setFloatingLabel?.(null)
    },
    /**
     * Clear the insertion placeholder as soon as the pointer leaves the row.
     * Moving into a child of the same row (or into the placeholder that is
     * pushing the row) must not clear it, otherwise the layout would oscillate.
     */
    onDragLeave: (event) => {
      if (!dragRef.current) return
      // Layout shift can fire dragleave on the row that just moved; a stationary
      // pointer must not tear down the locked placeholder.
      if (stickyTargetFor(event)) return
      const current = event?.currentTarget
      const next = event?.relatedTarget
      if (current && next && typeof current.contains === 'function' && current.contains(next)) return
      if (next && typeof next.closest === 'function' && next.closest('.dsg-drop-placeholder')) return
      // Moving between rows/gaps inside one group body must not remove the
      // placeholder; the next row's dragover will retarget it.
      if (next && typeof next.closest === 'function' && next.closest('.dsg-group-line')) return
      // A dragleave between rows/gaps is a transient boundary, not leaving the
      // sidebar. Clearing here removed the placeholder for one frame and the
      // next dragover reinserted it at the same place (visible flicker).
      if (!pointerOutsideRoot(event)) return
      clearAutoExpand()
      setDropTargetTracked(null)
      rt()?.setFloatingLabel?.(null)
    },
    onPlaceholderDragOver: (event) => {
      if (!dragRef.current) return
      // Keep the resolved target alive while the pointer is over the gap.
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    },
    onPlaceholderDrop: (event, target) => {
      const drag = dragRef.current
      if (!drag) return
      event.preventDefault()
      event.stopPropagation()
      clearAutoExpand()
      rt()?.setFloatingLabel?.(null)
      if (drag.kind === 'group') {
        const resolved = resolveTargetFor(target)
        if (!resolved) return
        commitGroupDrop(drag.groupId, resolved)
        return
      }
      commitDrop(drag, target)
    },
    onDragOverSession: (event, sessionId, groupId, ungrouped) => {
      const drag = dragRef.current
      if (!drag || drag.kind !== 'session') return
      if (stickyTargetFor(event)) {
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
        return
      }
      const rect = event.currentTarget.getBoundingClientRect()
      const target = hitTest({
        source: drag,
        rowKind: 'session',
        pointerY: event.clientY,
        rowTop: rect.top,
        rowHeight: rect.height,
        targetGroupId: ungrouped ? null : groupId,
        targetSessionId: sessionId,
      })
      if (target.kind === 'invalid') {
        // Never let a self-row/unknown-row invalid target fall through to the
        // wider ungrouped body handler: that handler used to retarget the drop
        // to the top of the ungrouped list and made the placeholder oscillate.
        event.preventDefault()
        event.stopPropagation()
        if (sessionId !== drag.sessionId) {
          setDropTargetTracked(null)
        }
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
        return
      }
      rowDragOver(event, target)
      const label = groupId
        ? t('drag.sessionIntoGroup', { name: findGroup(store.doc, groupId)?.name ?? '' })
        : t('drag.sessionOut')
      rt()?.setFloatingLabel?.(label)
    },
    onDropSession: (event, sessionId, groupId, ungrouped) => {
      const drag = dragRef.current
      if (!drag || drag.kind !== 'session') return
      event.preventDefault()
      event.stopPropagation()
      const sticky = stickyTargetFor(event)
      if (sticky) {
        clearAutoExpand()
        rt()?.setFloatingLabel?.(null)
        return commitDrop(drag, sticky)
      }
      clearAutoExpand()
      rt()?.setFloatingLabel?.(null)
      // Resolve from this drop event instead of the react state mirror: a
      // dragover and drop can arrive in one tick (synthetic E2E / fast pointer),
      // and the state may not have committed yet.
      const rect = event.currentTarget.getBoundingClientRect()
      const target = hitTest({
        source: drag,
        rowKind: 'session',
        pointerY: event.clientY,
        rowTop: rect.top,
        rowHeight: rect.height,
        targetGroupId: ungrouped ? null : groupId,
        targetSessionId: sessionId,
      })
      if (!target || target.kind === 'invalid') return commitDrop(drag, { kind: 'invalid' })
      return commitDrop(drag, target)
    },
    onDragOverGroup: (event, groupId) => {
      const drag = dragRef.current
      if (!drag) return
      const sticky = stickyTargetFor(event)
      if (sticky) {
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = sticky.kind === 'group-forbidden' ? 'none' : 'move'
        return
      }
      if (drag.kind === 'group') {
        const name = findGroup(store.doc, groupId)?.name ?? ''
        const zone = groupHeaderZone(event.currentTarget, event.clientY)
        if (zone === null) {
          setDropTargetTracked({ kind: 'group-forbidden', targetId: groupId })
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
          rt()?.setFloatingLabel?.(t('drag.groupInvalid'))
          return
        }
        previewGroupDrop(event, { kind: `group-${zone}`, targetId: groupId }, t(zone === 'before' ? 'drag.groupBefore' : 'drag.groupAfter', { name }))
        return
      }
      rowDragOver(event, { kind: 'group-append', groupId })
      scheduleAutoExpand(groupId)
      rt()?.setFloatingLabel?.(t('drag.sessionIntoGroup', { name: findGroup(store.doc, groupId)?.name ?? '' }))
    },
    onDropGroup: (event, groupId) => {
      const drag = dragRef.current
      if (drag?.kind === 'group') {
        event.preventDefault()
        event.stopPropagation()
        clearAutoExpand()
        setDropTargetTracked(null)
        rt()?.setFloatingLabel?.(null)
        const zone = groupHeaderZone(event.currentTarget, event.clientY)
        if (zone === null) {
          toast('error', t('drag.groupInvalid'))
          return
        }
        commitGroupDrop(drag.groupId, { kind: zone, targetId: groupId })
        return
      }
      event.preventDefault()
      event.stopPropagation()
      clearAutoExpand()
      rt()?.setFloatingLabel?.(null)
      commitDrop(drag, { kind: 'group-append', groupId })
    },
    onDragOverGroupHead: (event, groupId) => {
      const drag = dragRef.current
      if (!drag || drag.kind !== 'session') return
      // The line also owns the tiny gaps between session rows. A gap is not a
      // "group head" drop zone: treating it as one made the placeholder jump to
      // the group top while the pointer slowly crossed a 2px gap. Only the area
      // above the first visible session is the group-head zone.
      const firstRow = event.currentTarget?.querySelector?.('[data-session-id]')
      const firstRect = firstRow?.getBoundingClientRect?.()
      if (firstRect && Number.isFinite(firstRect.top) && event.clientY >= firstRect.top) {
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
        return
      }
      rowDragOver(event, { kind: 'group-head', groupId })
      scheduleAutoExpand(groupId)
    },
    onDropGroupHead: (event, groupId) => {
      const drag = dragRef.current
      if (!drag || drag.kind !== 'session') return
      event.preventDefault()
      event.stopPropagation()
      clearAutoExpand()
      rt()?.setFloatingLabel?.(null)
      commitDrop(drag, { kind: 'group-head', groupId })
    },
    onDragOverGroupSlot: (event, parentId, beforeGroupId) => {
      const drag = dragRef.current
      if (!drag || drag.kind !== 'group') return
      const name = findGroup(store.doc, parentId)?.name ?? ''
      previewGroupDrop(event, { kind: 'group-child', parentId, beforeGroupId }, t('drag.groupInto', { name }))
    },
    onDropGroupSlot: (event, parentId, beforeGroupId) => {
      const drag = dragRef.current
      // A session dragged across the slot keeps its existing group-head drop
      // behaviour (event bubbles to the body line); only group drags land here.
      if (!drag || drag.kind !== 'group') return
      event.preventDefault()
      event.stopPropagation()
      commitGroupDrop(drag.groupId, { kind: 'child', parentId, beforeGroupId })
    },
    onDragOverUngrouped: (event) => {
      const drag = dragRef.current
      if (!drag) return
      if (drag.kind === 'group') {
        // The implicit ungrouped inbox is session-only. It is not a custom-group
        // parent, so a group drag never paints an insertion target here.
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
        setDropTargetTracked(null)
        rt()?.setFloatingLabel?.(t('ungrouped.sessionsOnly'))
        return
      }
      // Header only: this is the explicit "top of ungrouped" target.
      rowDragOver(event, { kind: 'ungrouped' })
      rt()?.setFloatingLabel?.(t('drag.sessionOut'))
    },
    /**
     * Body-level fallback for virtual gaps/spacers. A session row owns its own
     * dragover; this handler only sees gaps and empty body space, so it must
     * resolve against visible rows rather than jumping to the section top.
     */
    onDragOverUngroupedBody: (event) => {
      const drag = dragRef.current
      if (!drag) return
      if (drag.kind === 'group') {
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
        setDropTargetTracked(null)
        rt()?.setFloatingLabel?.(t('ungrouped.sessionsOnly'))
        return
      }
      if (event.target?.closest?.('[data-session-id], .dsg-drop-placeholder')) return
      const target = ungroupedBodyTarget(ungroupedBodyRows(event.currentTarget), event.clientY)
      rowDragOver(event, target)
      rt()?.setFloatingLabel?.(t('drag.sessionOut'))
    },
    onDropUngrouped: (event) => {
      const drag = dragRef.current
      if (drag?.kind === 'group') {
        event.preventDefault()
        event.stopPropagation()
        setDropTargetTracked(null)
        clearAutoExpand()
        rt()?.setFloatingLabel?.(null)
        toast('info', t('ungrouped.sessionsOnly'))
        return
      }
      event.preventDefault()
      event.stopPropagation()
      clearAutoExpand()
      rt()?.setFloatingLabel?.(null)
      // Header drop is always the explicit top-of-section target.
      commitDrop(drag, { kind: 'ungrouped' })
    },
    onDropUngroupedBody: (event) => {
      const drag = dragRef.current
      if (drag?.kind === 'group') {
        event.preventDefault()
        event.stopPropagation()
        setDropTargetTracked(null)
        clearAutoExpand()
        rt()?.setFloatingLabel?.(null)
        toast('info', t('ungrouped.sessionsOnly'))
        return
      }
      event.preventDefault()
      event.stopPropagation()
      clearAutoExpand()
      rt()?.setFloatingLabel?.(null)
      const current = dropTargetRef.current
      const target =
        current && (current.kind === 'session-before' || current.kind === 'session-after' || current.kind === 'ungrouped')
          ? current
          : ungroupedBodyTarget(ungroupedBodyRows(event.currentTarget), event.clientY)
      commitDrop(drag, target)
    },
  }
  // Time every drag handler for the opt-in perf probe and for diagnostics
  // (0.2.5, default on). Handlers stay unwrapped when both are off.
  if (perfEnabled() || diagEnabled()) {
    const isDragHandler = (name) =>
      name.startsWith('onDrag') ||
      name.startsWith('onDrop') ||
      name.startsWith('onGroupDrag') ||
      name.startsWith('onPlaceholderDrag') ||
      name.startsWith('onPlaceholderDrop')
    for (const name of Object.keys(handlers)) {
      if (!isDragHandler(name)) continue
      const original = handlers[name]
      handlers[name] = (event, ...args) => {
        const timed = perfEnabled() || diagEnabled()
        const started = timed ? perfNow() : 0
        try {
          return original(event, ...args)
        } finally {
          if (!timed) return
          const elapsed = perfNow() - started
          if (diagEnabled()) diagHandler(name, elapsed, event)
          if (!perfEnabled()) return
          if (name.startsWith('onDragOver')) {
            perfDragOver(name.slice(2), elapsed)
          } else if (name.startsWith('onDrop')) {
            perfSample('dropHandlerMs', elapsed)
            perfMark('drop:event', { handler: name, ms: Math.round(elapsed * 100) / 100 })
          }
        }
      }
    }
  }
  // 0.2.20: stable handler facade for memoized rows. Every call reads the
  // latest render's closure, so memoization cannot dispatch stale drag/doc data.
  handlersRef.current = handlers
  return h(
    'div',
    { ref: rootRef, class: 'dsg-root', 'data-testid': 'session-groups-view', dir: direction, 'data-mode': store.viewMode, 'data-wide': 'true', 'data-narrow': appliedWidth !== null && appliedWidth <= 320 ? 'true' : 'false', 'data-optimistic': store.optimistic ? 'true' : 'false' },
    h(Header, { store: viewState, handlers: stableHandlers, sessionsById: byId, workspaces: workspaceItems, archivedSessionIds, runningSessions, blockedSessions, unreadSessions }),
    wide && widthSupported && appliedWidth !== null
      ? h(ResizeHandle, {
          width: appliedWidth,
          min: SIDEBAR_WIDTH_MIN,
          max: maxAppliedWidth,
          onChange: handleWidthChange,
          onCommit: handleWidthCommit,
          onReset: handleWidthReset,
        })
      : null,
    h(Banner, { store, handlers: stableHandlers }),
    onboardingOpen
      ? h(OnboardingCard, {
          t,
          onCreate: () => {
            dismissOnboarding()
            stableHandlers.openNewGroup(null, null)
          },
          onDismiss: dismissOnboarding,
        })
      : null,
    !onboardingOpen && treeEmpty && store.docState !== 'loading'
      ? h(
          'div',
          { class: 'dsg-empty-state', 'data-testid': 'session-groups-empty-state' },
          h('div', { class: 'dsg-empty-state-title' }, t('empty.groupsTitle')),
          h('div', { class: 'dsg-empty-state-body' }, t('empty.groupsBody')),
          TextButton({
            label: t('empty.createGroup'),
            testId: 'session-groups-empty-create',
            onClick: () => stableHandlers.openNewGroup(null, null),
          })
        )
      : null,
    store.docState === 'loading'
      ? h('div', { class: 'dsg-empty' }, t('flat.title'))
      : h(
          'div',
          { class: 'dsg-tree', role: 'tree', 'aria-label': t('view.title') },
          h(UngroupedSection, { node: tree.ungrouped, store: viewState, props, handlers: stableHandlers, virtualRef }),
          ...tree.groups.map((node) => h(GroupNode, { key: node.group.id, node, depth: 0, props, handlers: stableHandlers, store: viewState })),
          // Group dragged to the root end: a group-row-height placeholder after
          // the last group makes the insertion point unmistakable.
          dropTarget?.kind === 'group-root-end'
            ? h(DropPlaceholder, { target: dropTarget, store: viewState, handlers: stableHandlers, height: GROUP_PLACEHOLDER_HEIGHT })
            : null
        ),
    h(Toast, { store }),
    h(MenuPopover, { store, handlers: stableHandlers }),
    h(DialogHost, { store, props })
  )
}
/** Export the error boundary wrapped occupant used by the slot registration. */
export const GroupsViewBoundary = (props) =>
  h(
    ErrorBoundary,
    {
      fallback: (error) =>
        h(FlatFallback, {
          props,
          store: rt()?.store?.getSnapshot() ?? null,
          reason: 'render-error',
        }),
    },
    h(GroupsView, props)
  )
// Keep the module-level runtime reachable for plugin.js helpers.
export const __internal = { findGroupsFlat, currentGroupIdOf }