/**
 * Menu/dialog/action handlers for the groups view.
 *
 * Kept apart from drag mechanics: these handlers open DSH dialogs, menus and
 * optimistic move steps. They receive a small context from GroupsView and do
 * not own drag state.
 */
import { clientRuntime as rt } from '../adapters/client-runtime.js'
import { childrenOf, findGroup, moveGroup } from '../shared/model.js'
import { assignSession } from '../shared/model.js'
import { currentColorHexOf, currentColorOf, currentGroupIdOf, currentIconOf, currentParentOf, deleteGroupNeedsDialog } from '../core/dialog-selection.js'
import { GROUP_DROP_NOOP } from './components-primitives.js'
import { sessionTitle } from '../core/filter.js'
import { menuAnchorFromEvent, menuAnchorFromRow } from '../core/menu-position.js'
import { sessionContainer } from '../core/tree.js'
import { GROUP_ICONS } from '../shared/constants.js'
import { workspaceChoices } from './actions.js'
import { dispatch, toast } from './components-primitives.js'

export const createMenuHandlers = (ctx) => {
  const { store, byId, workspaceItems, currentId, t, dragRef, handleWidthReset, selectSearchResult, consumeDragClick } = ctx

  const sessionMenuState = (event, sessionNode) => {
    const row = sessionNode.session
    const point = menuAnchorFromEvent(event, { width: globalThis.innerWidth, height: globalThis.innerHeight })
    return {
      kind: 'session',
      x: point.x,
      y: point.y,
      anchorX: point.anchorX,
      anchorY: point.anchorY,
      sessionId: row.id,
      title: sessionTitle(row, { blankLabel: t('session.blank'), untitledLabel: t('session.untitled') }),
      archived: sessionNode.archived === true,
      blank: sessionNode.session.blank === true,
    }
  }

  const openSessionMenu = (event, sessionNode) => {
    dispatch('menu', { menu: sessionMenuState(event, sessionNode) })
  }
  const openSessionMenuAtRow = (rowElement, sessionNode) => {
    const row = sessionNode.session
    const point = menuAnchorFromRow(rowElement, { width: globalThis.innerWidth, height: globalThis.innerHeight })
    dispatch('menu', {
      menu: {
        kind: 'session',
        x: point.x,
        y: point.y,
        anchorX: point.anchorX,
        anchorY: point.anchorY,
        sessionId: row.id,
        title: sessionTitle(row, { blankLabel: t('session.blank'), untitledLabel: t('session.untitled') }),
        archived: sessionNode.archived === true,
        blank: sessionNode.session.blank === true,
      },
    })
  }
  const openGroupMenu = (event, group) => {
    const point = menuAnchorFromEvent(event, { width: globalThis.innerWidth, height: globalThis.innerHeight })
    dispatch('menu', { menu: { kind: 'group', x: point.x, y: point.y, anchorX: point.anchorX, anchorY: point.anchorY, groupId: group.id } })
  }
  const openGroupMenuAtRow = (rowElement, group) => {
    const point = menuAnchorFromRow(rowElement, { width: globalThis.innerWidth, height: globalThis.innerHeight })
    dispatch('menu', { menu: { kind: 'group', x: point.x, y: point.y, anchorX: point.anchorX, anchorY: point.anchorY, groupId: group.id } })
  }

  const moveGroupStep = (groupId, delta) => {
    const task = rt()?.commitOptimistic((latest) => {
      const group = findGroup(latest, groupId)
      if (!group) throw GROUP_DROP_NOOP
      const siblings = childrenOf(latest, group.parentId)
      const currentIndex = siblings.findIndex((item) => item.id === groupId)
      const nextIndex = currentIndex + delta
      if (currentIndex === -1 || nextIndex < 0 || nextIndex >= siblings.length) throw GROUP_DROP_NOOP
      return moveGroup(latest, groupId, group.parentId, nextIndex)
    })
    task?.catch((error) => {
      if (error === GROUP_DROP_NOOP || error?.reported === true) return
      toast('error', t('toast.dropFailed'))
      if (globalThis.console?.warn) globalThis.console.warn('[dsh-session-grove] group move failed', error)
    })
  }

  const moveSessionStep = (sessionId, delta) => {
    const task = rt()?.commitOptimistic((latest) => {
      const container = sessionContainer(latest, sessionId)
      if (!container.ids) throw GROUP_DROP_NOOP
      const currentIndex = container.ids.indexOf(sessionId)
      const nextIndex = currentIndex + delta
      if (currentIndex === -1 || nextIndex < 0 || nextIndex >= container.ids.length) throw GROUP_DROP_NOOP
      return assignSession(latest, sessionId, container.groupId, nextIndex)
    })
    task?.catch((error) => {
      if (error === GROUP_DROP_NOOP || error?.reported === true) return
      toast('error', t('toast.dropFailed'))
      if (globalThis.console?.warn) globalThis.console.warn('[dsh-session-grove] session move failed', error)
    })
  }

  return {
    toggleGroup: (id) => dispatch('toggle-group', { id }),
    onGroupClick: (id) => {
      if (consumeDragClick(id)) return
      dispatch('toggle-group', { id })
    },
    moveGroupStep,
    moveSessionStep,
    retryLoad: () => rt()?.retryLoad(),
    openSession: (id) => rt()?.actions.openSession(id),
    setArchiveFilter: (filter) => dispatch('archive-filter', { filter }),
    resetLayout: () => {
      rt()?.resetLayout?.()
      handleWidthReset()
    },
    searchSelect: (entry) => selectSearchResult(entry),
    openRunningSession: (sessionId, archived) => selectSearchResult({ sessionId, archived }),
    searchArchived: () => toast('info', t('search.archivedDisabled')),
    openNewGroup: (event, parentId) => rt()?.openDialog({ kind: 'new-group', parentId, titleKey: parentId ? 'dialog.newSubgroup' : 'dialog.newGroup' }),
    openRenameGroup: (groupId) => rt()?.openDialog({ kind: 'rename-group', groupId, titleKey: 'dialog.renameGroup', value: findGroup(store.doc, groupId)?.name ?? '' }),
    openIconGroup: (groupId) =>
      rt()?.openDialog({ kind: 'icon', groupId, titleKey: 'group.icon', icons: [...GROUP_ICONS], current: currentIconOf(store.doc, groupId) }),
    openGroupColor: (groupId) =>
      rt()?.openDialog({
        kind: 'group-color',
        groupId,
        titleKey: 'dialog.groupColor',
        current: currentColorOf(store.doc, groupId),
        currentHex: currentColorHexOf(store.doc, groupId),
      }),
    openMoveGroup: (groupId) =>
      rt()?.openDialog({ kind: 'move-group', groupId, titleKey: 'dialog.moveGroup', currentId: currentParentOf(store.doc, groupId) }),
    openDeleteGroup: (groupId) => {
      const group = findGroup(store.doc, groupId)
      if (!group) return undefined
      if (!deleteGroupNeedsDialog(store.doc, groupId)) return rt()?.deleteGroupDirect?.(groupId)
      rt()?.openDialog({
        kind: 'delete-group',
        groupId,
        titleKey: 'dialog.deleteGroup',
        sessionCount: group.sessionIds.length,
        childCount: childrenOf(store.doc, groupId).length,
      })
      return undefined
    },
    openSessionMenu,
    openSessionMenuAtRow,
    onSessionContextMenu: (event, sessionNode) => {
      event.preventDefault()
      event.stopPropagation()
      if (dragRef.current) return
      openSessionMenu(event, sessionNode)
    },
    openGroupMenu,
    openGroupMenuAtRow,
    onGroupContextMenu: (event, group) => {
      event.preventDefault()
      event.stopPropagation()
      if (dragRef.current) return
      openGroupMenu(event, group)
    },
    openNewSession: (event, groupId) => {
      const choices = workspaceChoices(store.doc, groupId, byId, workspaceItems, currentId)
      if (choices.choices.length === 0) {
        rt()?.showToast('error', t('dialog.noWorkspace'))
        return
      }
      rt()?.openDialog({ kind: 'new-session', groupId, titleKey: 'dialog.newSession', choices: choices.choices, inferred: choices.inferred })
    },
    openRenameSession: (sessionId, title) => rt()?.openDialog({ kind: 'rename-session', sessionId, titleKey: 'dialog.renameSession', value: title ?? '' }),
    openMoveSession: (sessionId) =>
      rt()?.openDialog({ kind: 'move-session', sessionId, titleKey: 'dialog.moveSession', currentId: currentGroupIdOf(store.doc, sessionId) }),
    archiveSession: (sessionId) => rt()?.archiveSession(sessionId),
    unarchiveSession: (sessionId) => rt()?.unarchiveSession(sessionId),
    forkSession: (sessionId) => rt()?.forkSession(sessionId),
    copySessionId: (sessionId) => rt()?.copySessionId(sessionId),
    closeMenu: () => dispatch('menu', { menu: null }),
  }
}
