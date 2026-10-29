export const DOC_VERSION = 1

/** Plugin version shipped in this build (also stamped into diagnostics traces). */
export const PLUGIN_VERSION = '0.2.8'

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
])

/** Normalization fallback for legacy/invalid icons (docs without an icon). */
export const DEFAULT_ICON = 'folder'
/** 0.2.7: newly created groups start with the hash glyph (colored by the group). */
export const DEFAULT_NEW_GROUP_ICON = 'hash'

/** Preset group palette (0.2.6, additive): stable ids persisted in the doc. */
export const GROUP_COLORS = Object.freeze(['blue', 'green', 'orange', 'red', 'purple', 'gray'])
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
})

export const MAX_GROUP_NAME = 80
export const MAX_ICON_LENGTH = 64
export const MAX_COLOR_LENGTH = 32
/** Canonical persisted custom color: lowercase #rrggbb, no alpha. */
export const MAX_COLOR_HEX_LENGTH = 7
export const MAX_DEPTH = 8

export const ARCHIVE_FILTERS = Object.freeze(['hidden', 'all', 'only'])
