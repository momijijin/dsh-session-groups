export const DOC_VERSION = 1

/** Plugin version shipped in this build (also stamped into diagnostics traces). */
export const PLUGIN_VERSION = '0.2.6'

export const GROUP_ICONS = Object.freeze([
  'folder',
  'folder-open',
  'star',
  'flag',
  'bookmark',
  'tag',
  'bulb',
  'rocket',
])

export const DEFAULT_ICON = 'folder'

/** Preset group palette (0.2.6, additive): stable ids persisted in the doc. */
export const GROUP_COLORS = Object.freeze(['blue', 'green', 'orange', 'red', 'purple', 'gray'])
/** New groups default to blue; docs without `color` display blue. */
export const DEFAULT_GROUP_COLOR = 'blue'

export const MAX_GROUP_NAME = 80
export const MAX_ICON_LENGTH = 64
export const MAX_COLOR_LENGTH = 32
export const MAX_DEPTH = 8

export const ARCHIVE_FILTERS = Object.freeze(['hidden', 'all', 'only'])
