/**
 * Menu anchoring and navigation handlers for the groups view.
 *
 * Dialog/command handlers live in groups-view-dialog-handlers.js; this module
 * only owns menu state/anchors and lightweight navigation commands.
 */
import { clientRuntime as rt } from '../adapters/client-runtime.js'
import { sessionTitle } from '../core/filter.js'
import { menuAnchorFromEvent, menuAnchorFromRow } from '../core/menu-position.js'
import { dispatch, toast } from './command-runtime.js'

export const createMenuHandlers = (ctx) => {
  const { t, dragRef, consumeDragClick, handleWidthReset, selectSearchResult } = ctx

  const sessionMenuState = (sessionNode, point) => ({
    kind: 'session',
    x: point.x,
    y: point.y,
    anchorX: point.anchorX,
    anchorY: point.anchorY,
    sessionId: sessionNode.session.id,
    title: sessionTitle(sessionNode.session, { blankLabel: t('session.blank'), untitledLabel: t('session.untitled') }),
    archived: sessionNode.archived === true,
    blank: sessionNode.session.blank === true,
  })
  const openSessionMenu = (event, sessionNode) => {
    dispatch('menu', {
      menu: sessionMenuState(sessionNode, menuAnchorFromEvent(event, { width: globalThis.innerWidth, height: globalThis.innerHeight })),
    })
  }
  const openSessionMenuAtRow = (rowElement, sessionNode) => {
    dispatch('menu', {
      menu: sessionMenuState(sessionNode, menuAnchorFromRow(rowElement, { width: globalThis.innerWidth, height: globalThis.innerHeight })),
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

  return {
    toggleGroup: (id) => dispatch('toggle-group', { id }),
    onGroupClick: (id) => {
      if (consumeDragClick(id)) return
      dispatch('toggle-group', { id })
    },
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
    closeMenu: () => dispatch('menu', { menu: null }),
  }
}
