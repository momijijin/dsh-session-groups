/**
 * Canonical control-plane catalog data.
 *
 * One shared source for the icon picker, AI control API and tests. Icon SVG
 * paths stay in the client resource file; this module owns the stable IDs,
 * categories, style marker and localized-label keys.
 */
import {
  GROUP_COLORS,
  GROUP_COLOR_HEX,
  GROUP_ICONS,
  MAX_COLOR_HEX_LENGTH,
  MAX_GROUP_NAME,
} from './constants.js'

export const ICON_STYLE = 'outline-16'

export const ICON_GROUPS = Object.freeze([
  {
    key: 'status',
    labelKey: 'iconGroup.status',
    icons: ['check-circle', 'check', 'x-circle', 'x', 'pause-circle', 'pause', 'play-circle', 'play', 'stop-circle', 'stop', 'ban', 'clock', 'hourglass', 'fire'],
  },
  {
    key: 'work',
    labelKey: 'iconGroup.work',
    icons: ['code', 'terminal', 'wrench', 'bug', 'hammer', 'lightning', 'database', 'chart', 'target', 'rocket', 'briefcase', 'layers', 'book', 'log', 'cpu', 'memory', 'hard-drive', 'server', 'network', 'activity', 'gauge', 'git-branch', 'git-merge'],
  },
  {
    key: 'devices',
    labelKey: 'iconGroup.devices',
    icons: ['computer', 'phone', 'tablet', 'printer', 'camera', 'music', 'video', 'wifi'],
  },
  {
    key: 'actions',
    labelKey: 'iconGroup.actions',
    icons: ['file', 'clipboard', 'link', 'mail', 'message', 'users', 'settings', 'filter', 'refresh', 'download', 'upload'],
  },
  {
    key: 'life',
    labelKey: 'iconGroup.life',
    icons: ['gift', 'map'],
  },
  {
    key: 'general',
    labelKey: 'iconGroup.general',
    icons: ['folder', 'folder-open', 'star', 'flag', 'bookmark', 'tag', 'bulb', 'globe', 'heart', 'home', 'calendar', 'hash', 'cloud', 'shield', 'lock', 'key', 'puzzle'],
  },
])

export const ICON_CATALOG = Object.freeze(
  ICON_GROUPS.flatMap((group) =>
    group.icons.map((id) =>
      Object.freeze({
        id,
        category: group.key,
        labelKey: `icon.${id}`,
        style: ICON_STYLE,
      }),
    ),
  ),
)

export const COLOR_CATALOG = Object.freeze(
  GROUP_COLORS.map((id) =>
    Object.freeze({
      id,
      hex: GROUP_COLOR_HEX[id],
      labelKey: `color.${id}`,
    }),
  ),
)

/**
 * Documented input grammar and canonical persisted shape. This is data, not
 * prose in the skill file, so the control API and tests read the same source.
 */
export const COLOR_FORMATS = Object.freeze({
  palette: Object.freeze({
    field: 'color',
    values: GROUP_COLORS,
    input: 'palette-id',
  }),
  custom: Object.freeze({
    field: 'colorHex',
    input: Object.freeze(['#RGB', 'RGB', '#RRGGBB', 'RRGGBB']),
    canonical: '#rrggbb',
    maxLength: MAX_COLOR_HEX_LENGTH,
    alpha: false,
  }),
})

export const CONTROL_LIMITS = Object.freeze({
  maxGroupNameLength: MAX_GROUP_NAME,
  iconCount: GROUP_ICONS.length,
  colorCount: GROUP_COLORS.length,
})
