export const DOC_VERSION = 1

/** Plugin version shipped in this build (also stamped into diagnostics traces). */
export const PLUGIN_VERSION = '0.3.0-beta.58'

export const GROUP_ICONS = Object.freeze([
  'folder',
  'folder-open',
  'star',
  'flag',
  'bookmark',
  'tag',
  'bulb',
  'rocket',
  'hash',
  'briefcase',
  'book',
  'code',
  'database',
  'terminal',
  'globe',
  'heart',
  'home',
  'layers',
  'calendar',
  'chart',
  'target',
  'check-circle',
  'check',
  'x-circle',
  'ban',
  'pause',
  'play',
  'stop',
  'clock',
  'hourglass',
  'wrench',
  'bug',
  'hammer',
  'lightning',
  'fire',
  'cloud',
  'shield',
  'lock',
  'key',
  'puzzle',
  'log',
  'cpu',
  'memory',
  'hard-drive',
  'server',
  'network',
  'activity',
  'gauge',
  'git-branch',
  'git-merge',
  'file',
  'clipboard',
  'link',
  'mail',
  'message',
  'users',
  'settings',
  'filter',
  'refresh',
  'download',
  'upload',
  'x',
  'pause-circle',
  'play-circle',
  'stop-circle',
  'computer',
  'phone',
  'tablet',
  'printer',
  'camera',
  'music',
  'video',
  'wifi',
  'map',
  'gift',
])

/** Normalization fallback for legacy/invalid icons (docs without an icon). */
export const DEFAULT_ICON = 'folder'
/** 0.2.7: newly created groups start with the hash glyph (colored by the group). */
export const DEFAULT_NEW_GROUP_ICON = 'hash'

/**
 * Official workspace "Show more" watermark (DSH Desktop 2.0.18):
 * 5 non-blank session rows per group by default; attention/current rows may
 * raise the automatic watermark up to 50. Kept as plugin constants because the
 * host module does not export them.
 */
export const SESSION_WATERMARK_BASE = 5
export const SESSION_WATERMARK_AUTO_MAX = 50

/** Preset group palette (0.2.6, additive): stable ids persisted in the doc. */
export const GROUP_COLORS = Object.freeze(['blue', 'green', 'orange', 'red', 'purple', 'gray', 'teal', 'pink', 'brown', 'cyan', 'navy', 'magenta'])
/** New groups default to blue; docs without `color` display blue. */
export const DEFAULT_GROUP_COLOR = 'blue'

/**
 * Static fallbacks for the six theme tokens. The native `<input type="color">`
 * in the custom-color row needs a concrete value before any custom hex exists;
 * the rendered swatches still use the live `--dsg-color-*` tokens.
 */
export const GROUP_COLOR_HEX = Object.freeze({
  blue: '#4d6bfe',
  green: '#2da44e',
  orange: '#d29922',
  red: '#f85149',
  purple: '#8250df',
  gray: '#6e7781',
  teal: '#14b8a6',
  pink: '#ec4899',
  brown: '#8b5e34',
  cyan: '#0891b2',
  navy: '#1e40af',
  magenta: '#d946ef',
})

export const MAX_GROUP_NAME = 80
export const MAX_ICON_LENGTH = 64
export const MAX_COLOR_LENGTH = 32
/** Canonical persisted custom color: lowercase #rrggbb, no alpha. */
export const MAX_COLOR_HEX_LENGTH = 7
export const MAX_DEPTH = 8

export const ARCHIVE_FILTERS = Object.freeze(['hidden', 'all', 'only'])







































