/**
 * React components for the groups sidebar (plain `createElement`, no JSX).
 *
 * Components are registered into DSH slots and receive the framework standard
 * toolkit as props (`useSessions`, `useWorkspaces`, `useSessionStatus`,
 * `usePanelInfo`, `…`) plus the slot owner share. Everything host-derived is read
 * from those hooks; the only local state is this plugin's view store.
 */
import { Component, createElement, useEffect, useRef, useState } from 'react'
import { clientRuntime as rt } from '../adapters/client-runtime.js'
import { PLUGIN_VERSION } from '../shared/constants.js'
import { workspaceLabel } from './actions.js'
import { isArchived, sessionTitle, ARCHIVE_FILTERS, ARCHIVE_FILTER_LABEL_KEYS } from '../core/filter.js'
import { diagRender } from './diagnostics.js'
import { renderGlyph, renderIcon } from './icons.js'
import { perfRender } from './perf.js'

import { SearchBox } from './components-search-box.js'
import { IconButton, TextButton } from './components-primitives.js'

const h = createElement

const ArchiveFilterPopover = ({ filter, t, onPick, onResetLayout }) =>
  h(
    'div',
    {
      class: 'dsg-view-options-popover',
      role: 'menu',
      'data-testid': 'session-groups-view-options-popover',
      'aria-label': t('archive.label'),
      onClick: (event) => event.stopPropagation(),
    },
    ...ARCHIVE_FILTERS.map((value) => {
      const active = value === filter
      return h(
        'button',
        {
          key: value,
          type: 'button',
          role: 'menuitemradio',
          'aria-checked': active ? 'true' : 'false',
          class: 'dsg-menu-item dsg-view-option',
          'data-testid': 'session-groups-archive-filter',
          'data-filter': value,
          'data-active': active ? 'true' : 'false',
          onClick: (event) => {
            event.stopPropagation()
            onPick(value)
          },
        },
        h('span', { class: 'dsg-view-option-label' }, t(ARCHIVE_FILTER_LABEL_KEYS[value])),
        h('span', { class: 'dsg-view-option-check', 'aria-hidden': 'true' }, active ? renderGlyph(h, 'check', 16) : null)
      )
    }),
    h('div', { class: 'dsg-view-options-divider' }),
    h(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        class: 'dsg-menu-item dsg-view-option',
        'data-testid': 'session-groups-reset-layout',
        onClick: (event) => {
          event.stopPropagation()
          onResetLayout()
        },
      },
      h('span', { class: 'dsg-view-option-label' }, t('about.resetLayout')),
      h('span', { class: 'dsg-view-option-check', 'aria-hidden': 'true' }, renderGlyph(h, 'refresh', 16))
    ),
    h(
      'div',
      { class: 'dsg-view-options-about', 'data-testid': 'session-groups-about' },
      h('span', { class: 'dsg-view-options-version' }, `dsh-session-grove ${PLUGIN_VERSION}`),
      h('span', { class: 'dsg-view-options-scope' }, t('about.scope'))
    )
  )

const OnboardingCard = ({ t, onCreate, onDismiss }) =>
  h(
    'div',
    { class: 'dsg-onboarding', 'data-testid': 'session-groups-onboarding', role: 'note' },
    h('div', { class: 'dsg-onboarding-title' }, t('onboarding.title')),
    h('div', { class: 'dsg-onboarding-body' }, t('onboarding.body')),
    h(
      'div',
      { class: 'dsg-onboarding-actions' },
      TextButton({ label: t('onboarding.create'), testId: 'session-groups-onboarding-create', onClick: onCreate }),
      TextButton({ label: t('onboarding.dismiss'), testId: 'session-groups-onboarding-dismiss', onClick: onDismiss })
    )
  )

const StatusSessionsButton = ({
  kind,
  icon,
  count,
  sections,
  label,
  ariaLabel,
  emptyLabel,
  testId,
  popoverTestId,
  sessionsById,
  onSelect,
}) => {
  const t = rt()?.t ?? ((key) => key)
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const doc = globalThis.document
    const onPointerDown = (event) => {
      if (ref.current?.contains?.(event?.target)) return
      setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    doc?.addEventListener?.('pointerdown', onPointerDown, true)
    doc?.addEventListener?.('keydown', onKeyDown, true)
    return () => {
      doc?.removeEventListener?.('pointerdown', onPointerDown, true)
      doc?.removeEventListener?.('keydown', onKeyDown, true)
    }
  }, [open])

  return h(
    'div',
    { class: 'dsg-status-action-wrap', ref },
    h(
      'button',
      {
        type: 'button',
        class: 'dsg-status-action',
        'data-testid': testId,
        'data-kind': kind,
        'data-count': String(count),
        title: label,
        'aria-label': ariaLabel,
        'aria-expanded': open ? 'true' : 'false',
        onClick: (event) => {
          event.stopPropagation()
          setOpen((value) => !value)
        },
      },
      h('span', { class: 'dsg-status-action-icon', 'aria-hidden': 'true' }, renderIcon(h, icon, 16)),
      h('span', { class: 'dsg-status-action-count' }, String(count))
    ),
    open
      ? h(
          'div',
          { class: 'dsg-running-popover', role: 'menu', 'data-testid': popoverTestId },
          sections.length === 0
            ? h('div', { class: 'dsg-running-empty' }, emptyLabel)
            : sections.map((section, index) =>
                h(
                  'div',
                  {
                    class: 'dsg-running-section',
                    key: section.groupId ?? `ungrouped-${index}`,
                    'data-group-id': section.groupId ?? '',
                  },
                  h(
                    'div',
                    { class: 'dsg-running-group-label' },
                    section.groupId
                      ? section.groupName || t('session.untitled')
                      : t('running.group.ungrouped')
                  ),
                  section.sessions.map((entry) =>
                    h(
                      'button',
                      {
                        type: 'button',
                        class: 'dsg-running-item',
                        key: entry.sessionId,
                        'data-testid': `${testId}-item`,
                        'data-session-id': entry.sessionId,
                        onClick: (event) => {
                          event.stopPropagation()
                          setOpen(false)
                          onSelect(entry.sessionId, entry.archived === true)
                        },
                      },
                      h(
                        'span',
                        { class: 'dsg-running-item-title' },
                        sessionTitle(sessionsById?.[entry.sessionId], {
                          blankLabel: t('session.blank'),
                          untitledLabel: t('session.untitled'),
                        })
                      ),
                      entry.archived
                        ? h('span', { class: 'dsg-running-item-archived' }, t('session.archived'))
                        : null
                    )
                  )
                )
              )
        )
      : null
  )
}

const Header = ({ store, handlers, sessionsById, workspaces, archivedSessionIds, runningSessions, blockedSessions, unreadSessions }) => {
  perfRender('Header')
  diagRender('Header')
  const t = rt()?.t ?? ((key) => key)
  const filter = store.archiveFilter
  const [searchOpen, setSearchOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const optionsRef = useRef(null)

  // View-options popover: Escape or an outside pointerdown closes it.
  useEffect(() => {
    if (!optionsOpen) return undefined
    const doc = globalThis.document
    const onPointerDown = (event) => {
      if (optionsRef.current?.contains?.(event?.target)) return
      setOptionsOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOptionsOpen(false)
    }
    doc?.addEventListener?.('pointerdown', onPointerDown, true)
    doc?.addEventListener?.('keydown', onKeyDown, true)
    return () => {
      doc?.removeEventListener?.('pointerdown', onPointerDown, true)
      doc?.removeEventListener?.('keydown', onKeyDown, true)
    }
  }, [optionsOpen])

  return h(
    'div',
    {
      class: 'dsg-header dsg-header-stacked',
      'data-testid': 'session-groups-header',
      'data-search-open': searchOpen ? 'true' : 'false',
      'data-options-open': optionsOpen ? 'true' : 'false',
    },
    h(
      'div',
      { class: 'dsg-header-row', 'data-testid': 'session-groups-header-row' },
      h(
        'span',
        { class: 'dsg-header-title', title: t('view.title') },
        h('span', { class: 'dsg-header-label' }, t('view.title'))
      ),
      h(
        'div',
        { class: 'dsg-header-actions' },
        h(
          'div',
          { class: 'dsg-status-actions' },
          h(StatusSessionsButton, {
            kind: 'running',
            icon: 'activity',
            count: runningSessions?.count ?? 0,
            sections: runningSessions?.sections ?? [],
            label: t('running.open'),
            ariaLabel: t('running.aria', { n: runningSessions?.count ?? 0 }),
            emptyLabel: t('running.empty'),
            testId: 'session-groups-running-button',
            popoverTestId: 'session-groups-running-popover',
            sessionsById,
            onSelect: handlers.openRunningSession,
          }),
          h(StatusSessionsButton, {
            kind: 'blocked',
            icon: 'pause',
            count: blockedSessions?.count ?? 0,
            sections: blockedSessions?.sections ?? [],
            label: t('blocked.open'),
            ariaLabel: t('blocked.aria', { n: blockedSessions?.count ?? 0 }),
            emptyLabel: t('blocked.empty'),
            testId: 'session-groups-blocked-button',
            popoverTestId: 'session-groups-blocked-popover',
            sessionsById,
            onSelect: handlers.openRunningSession,
          }),
          h(StatusSessionsButton, {
            kind: 'unread',
            icon: 'mail',
            count: unreadSessions?.count ?? 0,
            sections: unreadSessions?.sections ?? [],
            label: t('unread.open'),
            ariaLabel: t('unread.aria', { n: unreadSessions?.count ?? 0 }),
            emptyLabel: t('unread.empty'),
            testId: 'session-groups-unread-button',
            popoverTestId: 'session-groups-unread-popover',
            sessionsById,
            onSelect: handlers.openRunningSession,
          })
        ),        // 0.2.24: view switch moved from the footer to the header's leading slot.
        // The grid glyph means "go to the workspace browser".
        IconButton({
          label: t('footer.toWorkspace'),
          glyph: 'grid',
          testId: 'session-groups-toggle',
          data: { 'data-mode': store.viewMode, 'data-target': 'workspace' },
          onClick: () => rt()?.toggleMode(),
        }),
        // Official workspace-section order: search → view options → new group.
        IconButton({
          label: t('search.label'),
          icon: 'search',
          testId: 'session-groups-search-toggle',
          expanded: searchOpen,
          onClick: () => {
            setOptionsOpen(false)
            setSearchOpen((open) => !open)
          },
        }),
        h(
          'div',
          { ref: optionsRef, class: 'dsg-view-options' },
          IconButton({
            label: t('view.options'),
            icon: 'view-options',
            testId: 'session-groups-view-options',
            expanded: optionsOpen,
            haspopup: 'menu',
            data: { 'data-filter': filter },
            onClick: () => {
              setOptionsOpen((open) => !open)
            },
          }),
          optionsOpen
            ? h(ArchiveFilterPopover, {
                filter,
                t,
                onPick: (value) => {
                  handlers.setArchiveFilter(value)
                  setOptionsOpen(false)
                },
                onResetLayout: () => {
                  handlers.resetLayout()
                  setOptionsOpen(false)
                },
              })
            : null
        ),
        IconButton({
          label: t('view.newGroup'),
          icon: 'project-add',
          testId: 'session-groups-new-group',
          onClick: (event) => handlers.openNewGroup(event, null),
        })
      )
    ),
    searchOpen
      ? h(
          'div',
          { class: 'dsg-header-row dsg-header-search-row', 'data-testid': 'session-groups-header-search-row' },
          h(SearchBox, {
            store,
            handlers,
            sessionsById,
            workspaces,
            archivedSessionIds,
            autoFocus: true,
            onDismiss: () => setSearchOpen(false),
          }),
          IconButton({
            label: t('search.collapse'),
            glyph: 'chevronUp',
            testId: 'session-groups-search-close',
            onClick: () => setSearchOpen(false),
          })
        )
      : null
  )
}

const Banner = ({ store, handlers }) => {
  const banner = store.banner
  if (!banner) return null
  const t = rt()?.t
  const key = `banner.${banner.code}`
  const message = t(key)
  const retryable = banner.kind === 'error'
  return h(
    'div',
    { class: 'dsg-banner', 'data-testid': 'session-groups-banner', 'data-kind': banner.kind },
    h('span', { class: 'dsg-banner-text' }, message === key ? t('banner.loadFailed') : message),
    retryable ? TextButton({ label: t('banner.retry'), onClick: () => handlers.retryLoad(), testId: 'session-groups-banner-retry' }) : null,
    TextButton({ label: t('banner.dismiss'), onClick: () => dispatch('banner', { banner: null }), testId: 'session-groups-banner-dismiss' })
  )
}

const Rail = ({ props }) => {
  const t = rt()?.t
  const expandSidebar = typeof props?.expandSidebar === 'function' ? props.expandSidebar : () => {}
  return h(
    'div',
    { class: 'dsg-rail', 'data-testid': 'session-groups-rail' },
    h(
      'button',
      {
        type: 'button',
        class: 'dsg-rail-button',
        title: t('rail.expand'),
        'aria-label': t('rail.expand'),
        'data-testid': 'session-groups-rail-expand',
        onClick: () => expandSidebar(),
      },
      renderGlyph(h, 'folderAdjust', 18)
    ),
    h('span', { class: 'dsg-rail-label' }, t('rail.groups'))
  )
}

// ---------------------------------------------------------------------------
// Flat fallback / error boundary
// ---------------------------------------------------------------------------
const FlatFallback = ({ props, store, reason }) => {
  const t = rt()?.t
  const sessions = typeof props?.useSessions === 'function' ? props.useSessions((snapshot) => snapshot) : null
  const workspaces = typeof props?.useWorkspaces === 'function' ? props.useWorkspaces((snapshot) => snapshot) : null
  const workspaceItems = workspaces?.items ?? []
  const archived = workspaces?.archivedSessionIds ?? []
  const byId = sessions?.byId ?? {}
  const ids = (sessions?.ids ?? []).filter((id) => byId[id] && byId[id].origin !== 'subagent')
  const rows = ids.map((id) => byId[id])
  return h(
    'div',
    { class: 'dsg-root', 'data-testid': 'session-groups-flat-fallback', 'data-reason': reason ?? 'error' },
    h('div', { class: 'dsg-header', 'data-testid': 'session-groups-error' }, h('span', { class: 'dsg-header-title' }, t('error.title'))),
    h('div', { class: 'dsg-banner', 'data-kind': 'error' }, h('span', { class: 'dsg-banner-text' }, reason === 'route-unavailable' ? t('banner.routeUnavailable') : t('error.body'))),
    h(
      'div',
      { class: 'dsg-flat' },
      ...rows.map((row) =>
        h(
          'div',
          {
            key: row.id,
            class: 'dsg-session-row',
            'data-testid': 'session-groups-session',
            'data-session-id': row.id,
            'data-archived': isArchived(archived, row.id) ? 'true' : 'false',
            onClick: () => !isArchived(archived, row.id) && rt()?.actions.openSession(row.id),
          },
          h(SessionStatusCell, { statuses: [], hidden: true }),
          h('span', { class: 'dsg-session-title' }, sessionTitle(row, { blankLabel: t('session.blank'), untitledLabel: t('session.untitled') })),
          h('span', { class: 'dsg-workspace-badge', style: { opacity: 1 } }, (() => {
            const workspace = workspaceItems.find((item) => (item.sessionIds ?? []).includes(row.id))
            return workspace ? workspaceLabel(workspace) : t('session.noWorkspace')
          })())
        )
      ),
      rows.length === 0 ? h('div', { class: 'dsg-empty', 'data-testid': 'session-groups-empty' }, t('empty.none')) : null
    ),
    h(
      'div',
      { class: 'dsg-header' },
      TextButton({ label: t('banner.retry'), onClick: () => rt()?.retryLoad(), testId: 'session-groups-flat-retry' }),
      TextButton({ label: t('view.returnWorkspace'), onClick: () => rt()?.setMode('workspace'), testId: 'session-groups-return' })
    )
  )
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error) {
    globalThis.console?.error?.('[dsh-session-grove] render error', error)
  }
  render() {
    if (this.state.error) return this.props.fallback(this.state.error)
    return this.props.children
  }
}

// ---------------------------------------------------------------------------
// Groups view (Sidebar occupant)
// ---------------------------------------------------------------------------

export { ArchiveFilterPopover, OnboardingCard, StatusSessionsButton, Header, Banner, Rail, FlatFallback, ErrorBoundary }
