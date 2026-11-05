/**
 * Search reveal/highlight controller for the groups view.
 *
 * DOM highlight and scroll are transient presentation concerns; they own their
 * timer/row refs here instead of widening GroupsView.
 */
import { useEffect, useRef } from 'react'
import { clientRuntime as rt } from '../adapters/client-runtime.js'
import { revealSession } from '../core/search.js'
import { dispatch, toast } from './components-primitives.js'

export const useGroupsSearchReveal = ({ rootRef, tree, store, t, virtualRef }) => {
  const searchHitTimerRef = useRef(null)
  const searchHitRowRef = useRef(null)

  useEffect(
    () => () => {
      if (searchHitTimerRef.current !== null) {
        clearTimeout(searchHitTimerRef.current)
        searchHitTimerRef.current = null
      }
      searchHitRowRef.current?.classList?.remove?.('dsg-search-hit')
      searchHitRowRef.current = null
    },
    [],
  )

/** Drop the current search highlight class/timer (safe to call repeatedly). */
const clearSearchHit = () => {
  if (searchHitTimerRef.current !== null) {
    clearTimeout(searchHitTimerRef.current)
    searchHitTimerRef.current = null
  }
  searchHitRowRef.current?.classList?.remove?.('dsg-search-hit')
  searchHitRowRef.current = null
}

/**
 * Highlight + scroll the revealed row (spec §4.4). The row may not exist on
 * the first frame after the collapsed update, so retry for up to eight frames;
 * add `dsg-search-hit` for 1.5 s; scroll with
 * `scrollTop + (row.top - tree.top) - 0.3 * tree.clientHeight`, clamped to the
 * scrollable range. When the target is an ungrouped row outside the current
 * virtual window, the window is forced forward first so the row can mount.
 * A row that never appears (orphan / filtered out) is a no-op: no scroll, no
 * highlight, no throw.
 */
const revealSearchRow = (sessionId) => {
  const root = rootRef.current
  const ungroupedIndex = tree.ungrouped.findIndex((child) => child.session.id === sessionId)
  let attempts = 0
  const tick = () => {
    // The section may mount one frame after the collapsed update (search on a
    // collapsed ungrouped inbox), so re-check the controller every retry.
    if (ungroupedIndex >= 0) {
      const controller = virtualRef.current
      if (controller && !controller.isVisible(ungroupedIndex)) controller.scrollToIndex(ungroupedIndex)
    }
    const treeElement = root?.querySelector?.('.dsg-tree')
    const row = treeElement
      ? Array.from(treeElement.querySelectorAll('[data-session-id]')).find((element) => element.getAttribute('data-session-id') === sessionId)
      : null
    if (!treeElement || !row) {
      attempts += 1
      if (attempts <= 8) requestAnimationFrame(tick)
      return
    }
    clearSearchHit()
    row.classList.add('dsg-search-hit')
    searchHitRowRef.current = row
    searchHitTimerRef.current = setTimeout(() => {
      searchHitTimerRef.current = null
      row.classList.remove('dsg-search-hit')
      if (searchHitRowRef.current === row) searchHitRowRef.current = null
    }, 1500)
    const rowRect = row.getBoundingClientRect()
    const treeRect = treeElement.getBoundingClientRect()
    const maxScroll = Math.max(0, treeElement.scrollHeight - treeElement.clientHeight)
    const next = Math.min(Math.max(0, treeElement.scrollTop + (rowRect.top - treeRect.top) - treeElement.clientHeight * 0.3), maxScroll)
    treeElement.scrollTop = next
  }
  requestAnimationFrame(tick)
}

/**
 * Search result selection (spec §3.3 / §4.4): archived entries only toast;
 * normal entries switch `only` -> `all` when needed, open the session, reveal
 * its containing group/ancestors in one store update, then highlight + scroll.
 */
const selectSearchResult = (entry) => {
  if (!entry || typeof entry.sessionId !== 'string') return
  if (entry.archived === true) {
    toast('info', t('search.archivedDisabled'))
    return
  }
  // Read the live snapshot: the rendered `store` prop can lag a queued commit.
  const live = rt()?.store?.getSnapshot?.() ?? store
  if (live?.archiveFilter === 'only') dispatch('archive-filter', { filter: 'all' })
  rt()?.actions.openSession(entry.sessionId)
  const collapsed = revealSession(live?.doc, live?.collapsed ?? {}, entry.sessionId)
  if (collapsed !== live?.collapsed) rt()?.store?.update({ collapsed })
  revealSearchRow(entry.sessionId)
}


  return { clearSearchHit, revealSearchRow, selectSearchResult }
}
