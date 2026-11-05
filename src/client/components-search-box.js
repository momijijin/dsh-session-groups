/**
 * React components for the groups sidebar (plain `createElement`, no JSX).
 *
 * Components are registered into DSH slots and receive the framework standard
 * toolkit as props (`useSessions`, `useWorkspaces`, `useSessionStatus`,
 * `usePanelInfo`, `…`) plus the slot owner share. Everything host-derived is read
 * from those hooks; the only local state is this plugin's view store.
 */
import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import { clientRuntime as rt } from '../adapters/client-runtime.js'
import { sessionTitle } from '../core/filter.js'
import { perfRender } from './perf.js'
import { buildSearchIndex, matchSessions } from '../core/search.js'
import { groupPath } from '../core/tree.js'


const h = createElement

const SEARCH_LISTBOX_ID = 'dsg-session-search-listbox'

/**
 * Session search combobox (spec §3.3 / §4.4).
 *
 * Controlled input + listbox. The immutable index is memoized by the host data
 * (`doc`, `sessionsById`, `workspaces`, `archivedSessionIds`) so typing never
 * rebuilds it; filtering, active-row and open state stay local. Archived
 * entries render (disabled) but never select. Selecting a normal entry delegates
 * to `handlers.searchSelect` — opening, revealing, scrolling and highlighting
 * live in GroupsView because they need the tree ref and the live store.
 */
const SearchBox = ({ store, handlers, sessionsById, workspaces, archivedSessionIds, autoFocus = false, onDismiss = null }) => {
  perfRender('SearchBox')
  const t = rt()?.t ?? ((key) => key)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const boxRef = useRef(null)
  const listboxRef = useRef(null)

  const index = useMemo(
    () => buildSearchIndex({ doc: store?.doc, sessionsById, workspaces, archivedSessionIds }),
    [store?.doc, sessionsById, workspaces, archivedSessionIds]
  )
  const results = useMemo(() => matchSessions(index, query), [index, query])
  const visible = open && query.trim() !== ''

  // Click outside the combobox closes the dropdown (query is kept for editing).
  useEffect(() => {
    if (!visible) return undefined
    const doc = globalThis.document
    const onPointerDown = (event) => {
      if (boxRef.current?.contains?.(event?.target)) return
      setOpen(false)
    }
    doc?.addEventListener?.('pointerdown', onPointerDown, true)
    return () => doc?.removeEventListener?.('pointerdown', onPointerDown, true)
  }, [visible])

  // Escape closes the dropdown first; with no dropdown open it collapses the
  // whole search row (feedback item 3: Escape/clear closes).
  useEffect(() => {
    const doc = globalThis.document
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      if (visible) setOpen(false)
      else onDismiss?.()
    }
    doc?.addEventListener?.('keydown', onKeyDown, true)
    return () => doc?.removeEventListener?.('keydown', onKeyDown, true)
  }, [visible, onDismiss])

  // Keep the keyboard-active option visible inside the 320px scrolling listbox
  // (spec §3.3): ArrowDown past the fold must never leave the active row clipped.
  // Uses rect difference rather than `scrollIntoView` so the page/tree does not
  // scroll as a side effect.
  useEffect(() => {
    if (!visible || activeIndex < 0) return
    const listbox = listboxRef.current
    if (!listbox) return
    const option = listbox.querySelector?.(`#${SEARCH_LISTBOX_ID}-${activeIndex}`)
    if (!option) return
    const boxRect = listbox.getBoundingClientRect()
    const optionRect = option.getBoundingClientRect()
    if (optionRect.top < boxRect.top) listbox.scrollTop -= boxRect.top - optionRect.top
    else if (optionRect.bottom > boxRect.bottom) listbox.scrollTop += optionRect.bottom - boxRect.bottom
  }, [activeIndex, visible, results.length])

  /** Apply a new query: typing always re-evaluates and clears the active row. */
  const openFor = (value) => {
    const next = typeof value === 'string' ? value : ''
    setQuery(next)
    setActiveIndex(-1)
    setOpen(next.trim() !== '')
  }

  const select = (entry) => {
    if (!entry) return
    if (entry.archived === true) {
      handlers.searchArchived?.(entry)
      return
    }
    setQuery('')
    setActiveIndex(-1)
    setOpen(false)
    handlers.searchSelect?.(entry)
  }

  /** Localized display title; the index itself keeps Task 5's title contract. */
  const titleOf = (entry) => {
    const row = sessionsById?.[entry.sessionId]
    if (!row) return entry.title ?? ''
    return sessionTitle(row, { blankLabel: t('session.blank'), untitledLabel: t('session.untitled') })
  }

  const move = (delta) => {
    if (!visible) {
      if (query.trim() === '') return
      setOpen(true)
      if (results.length > 0) setActiveIndex(delta > 0 ? 0 : results.length - 1)
      return
    }
    if (results.length === 0) return
    setActiveIndex((current) => {
      if (current < 0) return delta > 0 ? 0 : results.length - 1
      return (current + delta + results.length) % results.length
    })
  }

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      move(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      move(-1)
      return
    }
    if (event.key === 'Escape') {
      if (visible) {
        event.preventDefault()
        setOpen(false)
      } else {
        onDismiss?.()
      }
      return
    }
    if (event.key === 'Enter' && visible) {
      event.preventDefault()
      select(activeIndex >= 0 ? results[activeIndex] : undefined)
    }
  }

  return h(
    'div',
    { ref: boxRef, class: 'dsg-search', 'data-open': visible ? 'true' : 'false' },
    h('input', {
      class: 'dsg-search-input',
      type: 'text',
      role: 'combobox',
      'data-testid': 'session-groups-search',
      'aria-label': t('search.label'),
      'aria-expanded': visible ? 'true' : 'false',
      'aria-controls': SEARCH_LISTBOX_ID,
      'aria-autocomplete': 'list',
      'aria-activedescendant': visible && activeIndex >= 0 ? `${SEARCH_LISTBOX_ID}-${activeIndex}` : undefined,
      placeholder: t('search.placeholder'),
      autoComplete: 'off',
      spellCheck: false,
      autoFocus: autoFocus === true,
      value: query,
      onChange: (event) => openFor(event.target.value),
      onFocus: () => {
        if (query.trim() !== '') setOpen(true)
      },
      onKeyDown,
    }),
    visible
      ? h(
          'div',
          {
            id: SEARCH_LISTBOX_ID,
            ref: listboxRef,
            class: 'dsg-search-results',
            role: 'listbox',
            'data-testid': 'session-groups-search-results',
            'aria-label': t('search.results'),
          },
          results.length === 0
            ? h('div', { class: 'dsg-search-empty', 'data-testid': 'session-groups-search-empty' }, t('search.empty'))
            : results.map((entry, position) => {
                const title = titleOf(entry)
                const meta = [entry.groupPath, entry.workspace].filter(Boolean).join(' · ')
                const archived = entry.archived === true
                return h(
                  'div',
                  {
                    key: entry.sessionId,
                    id: `${SEARCH_LISTBOX_ID}-${position}`,
                    class: 'dsg-search-result',
                    role: 'option',
                    'data-testid': 'session-groups-search-result',
                    'data-session-id': entry.sessionId,
                    'data-archived': archived ? 'true' : 'false',
                    'data-active': position === activeIndex ? 'true' : 'false',
                    'aria-selected': position === activeIndex ? 'true' : 'false',
                    'aria-disabled': archived ? 'true' : undefined,
                    'aria-label': archived ? `${title} (${t('session.archivedBadge')})` : title,
                    onMouseDown: (event) => event.preventDefault(),
                    onMouseEnter: () => setActiveIndex(position),
                    onClick: () => select(entry),
                  },
                  h('span', { class: 'dsg-search-result-title' }, title),
                  meta ? h('span', { class: 'dsg-search-result-meta' }, meta) : null,
                  archived ? h('span', { class: 'dsg-search-result-badge' }, t('session.archivedBadge')) : null
                )
              })
        )
      : null
  )
}

// ---------------------------------------------------------------------------

export { SearchBox, SEARCH_LISTBOX_ID }
