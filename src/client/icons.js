/**
 * Fixed 16px inline SVG icon set (V1: no host icon dependency, no uploads, no
 * colors). Paths are stroke-only so they inherit `currentColor` and work in both
 * DSH themes.
 */
import { DEFAULT_ICON, GROUP_ICONS } from '../shared/constants.js'

/** SVG path data per contract icon name (viewBox 0 0 16 16). */
export const ICON_PATHS = Object.freeze({
  folder: ['M2.5 5.1h3.6l1.4 1.7h6v6.1h-11z', 'M2.5 5.1V3.9h3.6l1.4 1.2h4.6v1.7'],
  'folder-open': ['M2.5 5.1h3.6l1.4 1.7h5.2l-1.2 5.2h-9z', 'M2.5 5.1V3.9h3.6l1.4 1.2h4.4v1.4'],
  star: ['M8 2.2l1.73 3.5 3.87.56-2.8 2.73.66 3.85L8 11.02l-3.46 1.82.66-3.85-2.8-2.73 3.87-.56z'],
  flag: ['M4.2 2.6v11', 'M4.2 3.1h8.1l-1.7 2.6 1.7 2.5H4.2z'],
  bookmark: ['M4.2 2.6h7.6v11l-3.8-2.5-3.8 2.5z'],
  tag: ['M2.6 2.9h4.9l5.6 5.6-4.2 4.2-5.6-5.6z', 'M5.1 5.3h.01'],
  bulb: ['M8 2.4a3.6 3.6 0 0 1 2.1 6.5V11H5.9v-2.1A3.6 3.6 0 0 1 8 2.4z', 'M6.4 12.6h3.2'],
  rocket: ['M8 1.9c2.6 1.1 4.1 3.3 4.1 6.2l-2.1 3H6l-2.1-3c0-2.9 1.5-5.1 4.1-6.2z', 'M6 11.1l-2 3.2 3-1.1', 'M10 11.1l2 3.2-3-1.1', 'M8 4.2v3.2'],
  // 0.2.7 default new-group glyph: two slanted rails crossed by two horizontals.
  hash: ['M5.7 2.6L4.3 13.4', 'M10.2 2.6L8.8 13.4', 'M2.7 6.1h10.6', 'M2.3 10.1h10.6'],
  // 0.2.12 common group glyphs (same 16px stroke-only contract).
  briefcase: ['M2.7 5.2h10.6v8H2.7z', 'M5.6 5.2V3.9h4.8v1.3', 'M2.7 8.1h10.6'],
  book: ['M3 3.1h4.2c.7 0 1.3.6 1.3 1.3v8.4c0-.7-.6-1.3-1.3-1.3H3z', 'M13 3.1H8.8c-.7 0-1.3.6-1.3 1.3v8.4c0-.7.6-1.3 1.3-1.3H13z'],
  code: ['M5.8 5.1L2.9 8l2.9 2.9', 'M10.2 5.1L13.1 8l-2.9 2.9', 'M8.9 3.4L7.1 12.6'],
  database: ['M3.1 4.6c0-1 2.2-1.8 4.9-1.8s4.9.8 4.9 1.8-2.2 1.8-4.9 1.8S3.1 5.6 3.1 4.6z', 'M3.1 4.6v6.8c0 1 2.2 1.8 4.9 1.8s4.9-.8 4.9-1.8V4.6', 'M3.1 8c0 1 2.2 1.8 4.9 1.8s4.9-.8 4.9-1.8'],
  terminal: ['M2.6 3.3h10.8v9.4H2.6z', 'M5.1 6.2L7 8l-1.9 1.8', 'M8.5 10.1h2.6'],
  globe: ['M8 2.3a5.7 5.7 0 1 0 0 11.4A5.7 5.7 0 0 0 8 2.3z', 'M2.6 8h10.8', 'M8 2.4c-1.7 1.5-2.6 3.4-2.6 5.6s.9 4.1 2.6 5.6c1.7-1.5 2.6-3.4 2.6-5.6S9.7 3.9 8 2.4z'],
  heart: ['M8 13.3S2.7 10 2.7 6.4A2.7 2.7 0 0 1 8 4.9a2.7 2.7 0 0 1 5.3 1.5c0 3.6-5.3 6.9-5.3 6.9z'],
  home: ['M2.8 7.4L8 2.8l5.2 4.6v6.2H2.8z', 'M6.3 13.6V9.4h3.4v4.2'],
  layers: ['M8 2.5L2.8 5.4 8 8.3l5.2-2.9z', 'M2.8 8.1L8 11l5.2-2.9', 'M2.8 10.7L8 13.6l5.2-2.9'],
  calendar: ['M2.8 4.1h10.4v9.2H2.8z', 'M5.2 2.6v3', 'M10.8 2.6v3', 'M2.8 7.1h10.4'],
  chart: ['M2.7 2.8v10.5h10.6', 'M5.1 10.8V7.6', 'M8 10.8V5.3', 'M10.9 10.8V8.6'],
  target: ['M8 2.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4z', 'M8 5.1a2.9 2.9 0 1 0 0 5.8 2.9 2.9 0 0 0 0-5.8z', 'M8 7.5v1'],
  'check-circle': ['M8 2.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4z', 'M5.2 8.1l1.9 1.9 3.8-4'],
  check: ['M3.2 8.3l3 3 6.6-6.8'],
  'x-circle': ['M8 2.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4z', 'M5.8 5.8l4.4 4.4', 'M10.2 5.8l-4.4 4.4'],
  ban: ['M8 2.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4z', 'M4.3 4.3l7.4 7.4'],
  pause: ['M5.5 3.5v9', 'M10.5 3.5v9'],
  play: ['M5.2 3.4l6.8 4.6-6.8 4.6z'],
  stop: ['M4.2 4.2h7.6v7.6H4.2z'],
  clock: ['M8 2.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4z', 'M8 4.8V8l2.2 1.4'],
  hourglass: ['M4.2 2.7h7.6', 'M4.2 13.3h7.6', 'M5.1 2.7c0 3 2.9 3.4 2.9 5.3s-2.9 2.3-2.9 5.3', 'M10.9 2.7c0 3-2.9 3.4-2.9 5.3s2.9 2.3 2.9 5.3'],
  wrench: ['M9.7 2.8a3 3 0 0 0-3.9 3.9L2.8 9.7l3.5 3.5 3-3a3 3 0 0 0 3.9-3.9l-2.2 2.2-2.2-2.2z'],
  bug: ['M5.2 5.2h5.6v4.2a2.8 2.8 0 0 1-5.6 0z', 'M6.2 5.2V4.1a1.8 1.8 0 0 1 3.6 0v1.1', 'M5.2 7.2H2.8', 'M10.8 7.2h2.4', 'M5.2 10.4l-1.8 1.5', 'M10.8 10.4l1.8 1.5'],
  hammer: ['M9.2 2.8l4 4-2.2 2.2-4-4z', 'M7.1 4.9L2.6 9.4l4 4 4.5-4.5z', 'M6.4 7.8l1.8 1.8'],
  lightning: ['M9.2 2.4L4.1 8.7h3L6.8 13.6l5.1-6.3h-3z'],
  fire: ['M8 13.5c2.5 0 4.1-1.5 4.1-3.8 0-2.7-2.4-3.8-3.1-6.2-.8 2-2.1 2.8-2.1 4.4 0 .9.5 1.5 1.1 1.9-.8-.1-1.4-.5-1.8-1.1-.9.8-1.4 1.9-1.4 3.1 0 1 .6 1.7 1.4 1.7z'],
  cloud: ['M4.7 12.1h6.8a2.7 2.7 0 0 0 .3-5.3A4.2 4.2 0 0 0 4 6.1a3 3 0 0 0 .7 6z'],
  shield: ['M8 2.4l5 1.9v3.4c0 2.9-2 5-5 6.1-3-1.1-5-3.2-5-6.1V4.3z'],
  lock: ['M4.2 7.1h7.6v5.8H4.2z', 'M5.5 7.1V5.3a2.5 2.5 0 0 1 5 0v1.8', 'M8 9.2v1.6'],
  key: ['M9.6 3.1a3.3 3.3 0 1 0-2.1 5.9L3.1 13.4', 'M5.4 11.1l1.4 1.4', 'M7 9.5l1.2 1.2'],
  puzzle: ['M6.2 2.7h3.6v2a1.5 1.5 0 1 0 0 2.6v2.4H7.4a1.5 1.5 0 1 0-2.6 0H2.7V6.2h2a1.5 1.5 0 1 0 0-2.6z'],
  log: ['M4 2.8h8v10.4H4z', 'M5.6 5.2h4.8', 'M5.6 7.4h4.8', 'M5.6 9.6h3.2'],
  cpu: ['M4.4 4.4h7.2v7.2H4.4z', 'M6.5 6.5h3v3h-3z', 'M6 2.7v1.7', 'M10 2.7v1.7', 'M6 11.6v1.7', 'M10 11.6v1.7', 'M2.7 6h1.7', 'M2.7 10h1.7', 'M11.6 6h1.7', 'M11.6 10h1.7'],
  memory: ['M2.8 5.1h10.4v5.8H2.8z', 'M5 7.4h1.2', 'M7.4 7.4h1.2', 'M9.8 7.4h1.2', 'M4.7 10.9v2', 'M8 10.9v2', 'M11.3 10.9v2'],
  'hard-drive': ['M2.8 5.1h10.4v5.8H2.8z', 'M4.7 8h.01', 'M6.8 8h.01', 'M8.9 8h3'],
  server: ['M2.8 3.1h10.4v4.2H2.8z', 'M2.8 8.8h10.4v4.2H2.8z', 'M4.7 5.2h.01', 'M4.7 10.9h.01', 'M6.8 5.2h3.5', 'M6.8 10.9h3.5'],
  network: ['M8 3.1a1.6 1.6 0 1 0 0 3.2A1.6 1.6 0 0 0 8 3.1z', 'M3.2 9.8a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z', 'M12.8 9.8a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z', 'M7 6.2L4 9.8', 'M9 6.2l3 3.6'],
  activity: ['M2.5 8h2.7l1.5-4.2L9 12l1.7-4.1h2.8'],
  gauge: ['M2.8 12.6a5.2 5.2 0 1 1 10.4 0', 'M8 8l3-2.4', 'M8 12.6h.01'],
  'git-branch': ['M5.2 4.1a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z', 'M5.2 9.3a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z', 'M11 6.3a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z', 'M5.2 6.7v2.6', 'M5.2 6.7c3.3 0 5.8 1 5.8 3.2'],
  'git-merge': ['M5 4.1a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z', 'M5 9.3a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z', 'M11 6.3a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z', 'M5 6.7v2.6', 'M11 7.6l-4.4 2.4'],
  file: ['M4.2 2.8h4.6l3 3v7.4H4.2z', 'M8.8 2.8v3.3h3.3', 'M6.1 9h3.8', 'M6.1 11h3.8'],
  clipboard: ['M4.1 4.1h7.8v9H4.1z', 'M6.2 2.8h3.6v2.4H6.2z', 'M6.1 7.2h3.8', 'M6.1 9.5h3.8'],
  link: ['M6.4 9.6l3.2-3.2', 'M5.1 7.4L3.5 9a2.4 2.4 0 0 0 3.4 3.4l2-2', 'M10.9 8.6l1.6-1.6a2.4 2.4 0 0 0-3.4-3.4l-2 2'],
  mail: ['M2.7 4.1h10.6v7.8H2.7z', 'M2.7 4.6L8 8.4l5.3-3.8'],
  message: ['M3.2 3.3h9.6v6.2H7.1L4 12V9.5H3.2z'],
  users: ['M6 7.7a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z', 'M2.8 13.2c0-2.1 1.5-3.5 3.2-3.5s3.2 1.4 3.2 3.5', 'M10.1 7.4a1.9 1.9 0 1 0 0-3.8', 'M9.8 9.6c1.9 0 3.4 1.2 3.4 3.3'],
  settings: ['M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', 'M8 2.5v1.6', 'M8 11.9v1.6', 'M2.5 8h1.6', 'M11.9 8h1.6', 'M4.1 4.1l1.1 1.1', 'M10.8 10.8l1.1 1.1', 'M11.9 4.1l-1.1 1.1', 'M5.2 10.8l-1.1 1.1'],
  filter: ['M2.8 3.4h10.4L9.2 8.2v4.4l-2.4 1.1V8.2z'],
  refresh: ['M12.2 8a4.2 4.2 0 1 1-1.3-3', 'M12.6 3.3v3h-3'],
  download: ['M8 2.8v7', 'M5.2 7.1L8 9.9l2.8-2.8', 'M3.2 12.8h9.6'],
  upload: ['M8 10.2v-7', 'M5.2 5.9L8 3.1l2.8 2.8', 'M3.2 12.8h9.6'],
  computer: ['M2.6 3.2h10.8v7.1H2.6z', 'M8 10.3v2.4', 'M5.2 12.7h5.6'],
  phone: ['M5.2 2.5h5.6v11H5.2z', 'M7.1 11.3h1.8', 'M6.8 4h2.4'],
  tablet: ['M3.3 2.8h9.4v10.4H3.3z', 'M6.8 11.7h2.4'],
  printer: ['M4.3 5.2h7.4v3.1H4.3z', 'M5.2 2.9h5.6v2.3H5.2z', 'M5.2 8.3h5.6v3.2H5.2z', 'M4.3 9.7H2.8v2.5h1.5'],
  camera: ['M2.7 4.6h3l1-1.6h2.6l1 1.6h3v6.8H2.7z', 'M8 6.7a2 2 0 1 0 0 4 2 2 0 0 0 0-4z'],
  music: ['M6.2 10.8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z', 'M7.7 12.3V3.5l5-1v8.3', 'M10.8 10.6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z'],
  video: ['M2.8 4.1h7.2v7.8H2.8z', 'M10 6.2l3.2-1.7v7l-3.2-1.7z'],
  wifi: ['M2.8 6.2a7.5 7.5 0 0 1 10.4 0', 'M4.8 8.2a4.8 4.8 0 0 1 6.4 0', 'M6.7 10.2a2.2 2.2 0 0 1 2.6 0', 'M8 12.5h.01'],
  map: ['M2.7 4.1l3.5-1.3 3.6 1.3 3.5-1.3v9.1l-3.5 1.3-3.6-1.3-3.5 1.3z', 'M6.2 2.8v9.1', 'M9.8 4.1v9.1'],
  gift: ['M2.8 6.2h10.4v7H2.8z', 'M2.8 6.2h10.4', 'M8 6.2v7', 'M8 6.2c-2.7 0-2.9-3.2-.7-3.2 1.3 0 1.7 1.6 1.7 3.2', 'M8 6.2c2.7 0 2.9-3.2.7-3.2-1.3 0-1.7 1.6-1.7 3.2'],
  x: ['M4.5 4.5l7 7', 'M11.5 4.5l-7 7'],
  'pause-circle': ['M8 2.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4z', 'M6.3 5.8v4.4', 'M9.7 5.8v4.4'],
  'play-circle': ['M8 2.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4z', 'M6.7 5.5l4.2 2.5-4.2 2.5z'],
  'stop-circle': ['M8 2.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4z', 'M5.9 5.9h4.2v4.2H5.9z'],
})

/** Canonical icon categories live in the shared control catalog. */
export { ICON_GROUPS } from '../shared/control-catalog.js'

/** Resolve a possibly-invalid icon name to the default folder. */
export const iconName = (name) => (GROUP_ICONS.includes(name) ? name : DEFAULT_ICON)

/**
 * Render one icon as a React element.
 * @param {(type: string, props?: object, ...children: any[]) => any} h React createElement
 * @param {string} name contract icon name
 * @param {number} [size] rendered square size (default 16)
 */
export const renderIcon = (h, name, size = 16) => {
  const resolved = iconName(name)
  const paths = ICON_PATHS[resolved] ?? ICON_PATHS[DEFAULT_ICON]
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      'aria-hidden': 'true',
      focusable: 'false',
      class: 'dsg-icon',
    },
    ...paths.map((d, index) =>
      h('path', {
        key: index,
        d,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.3',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      })
    )
  )
}

// ---------------------------------------------------------------------------
// Official DSH workspace header artwork (0.2.5)
// ---------------------------------------------------------------------------
/**
 * Exact artwork copied from DSH Desktop 2.0.18
 * `@deepseek-ai/dsh-client-ui-primitives`:
 *
 * - `IconSearchOutlineRegular` (viewBox 0 0 16 16, 1px stroke, circle + handle)
 * - `IconSlidersTwoOutlineRegular` (1px stroke, two rails + two knobs)
 * - `IconProjectAddOutlineRegular` (1px stroke, project contour + plus)
 *
 * The plugin ships its own copy (no host icon dependency, CONTRACTS §0) but the
 * geometry is byte-for-byte the official one, so the three header buttons match
 * the official workspace section instead of custom approximations.
 */
export const HEADER_ICON_ARTWORK = Object.freeze({
  search: Object.freeze({
    viewBox: '0 0 16 16',
    strokeWidth: '1',
    stroke: 'currentColor',
    strokeLinecap: null,
    strokeLinejoin: null,
    filled: Object.freeze([]),
    stroked: Object.freeze([
      'M6.58727 11.8586C9.55061 11.8586 11.9529 9.45637 11.9529 6.49304C11.9529 3.5297 9.55061 1.12744 6.58727 1.12744C3.62394 1.12744 1.22168 3.5297 1.22168 6.49304C1.22168 9.45637 3.62394 11.8586 6.58727 11.8586Z',
      'M10.2991 10.3933L14.7783 14.8725',
    ]),
    circles: Object.freeze([]),
  }),
  'view-options': Object.freeze({
    viewBox: '0 0 16 16',
    strokeWidth: '1',
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: null,
    filled: Object.freeze([]),
    stroked: Object.freeze(['M2.3 5h5.85M12.05 5h1.65', 'M2.3 11h1.65M7.85 11h5.85']),
    circles: Object.freeze([
      Object.freeze({ cx: '9.95', cy: '5', r: '1.45' }),
      Object.freeze({ cx: '5.75', cy: '11', r: '1.45' }),
    ]),
  }),
  'project-add': Object.freeze({
    viewBox: '0 0 16 16',
    strokeWidth: '1',
    stroke: 'currentColor',
    strokeLinecap: null,
    strokeLinejoin: null,
    filled: Object.freeze([
      'M5.54492 2.06738C5.91034 2.06754 6.26318 2.20149 6.53711 2.44336L7.94043 3.68164V4.7998C7.71462 4.74105 7.50367 4.63139 7.32617 4.47461L5.87598 3.19238C5.78477 3.11185 5.66658 3.06754 5.54492 3.06738H2.94922C2.67322 3.06738 2.44946 3.29145 2.44922 3.56738V12.4326C2.44927 12.7087 2.67311 12.9326 2.94922 12.9326H12.9326C13.2086 12.9325 13.4326 12.7086 13.4326 12.4326V8.53613H14.4326V12.4326C14.4326 13.2609 13.7609 13.9325 12.9326 13.9326H2.94922C2.12083 13.9326 1.44927 13.261 1.44922 12.4326V3.56738C1.44946 2.73916 2.12094 2.06738 2.94922 2.06738H5.54492Z',
    ]),
    stroked: Object.freeze(['M9.75977 4.50208H14.5509', 'M12.1492 6.89758L12.1492 2.10642']),
    circles: Object.freeze([]),
  }),
})

/**
 * Render one official header artwork at `size` (default 16, matching the
 * official workspace header). Fill/stroke are separated exactly like the
 * primitives package so the silhouette matches the official icon.
 */
export const renderHeaderIcon = (h, name, size = 16) => {
  const artwork = HEADER_ICON_ARTWORK[name] ?? HEADER_ICON_ARTWORK.search
  const children = []
  for (const d of artwork.filled) {
    children.push(h('path', { key: `f${children.length}`, d, fill: 'currentColor', stroke: 'none' }))
  }
  for (const d of artwork.stroked) {
    children.push(
      h('path', {
        key: `s${children.length}`,
        d,
        fill: 'none',
        stroke: artwork.stroke,
        'stroke-width': artwork.strokeWidth,
        ...(artwork.strokeLinecap ? { 'stroke-linecap': artwork.strokeLinecap } : {}),
        ...(artwork.strokeLinejoin ? { 'stroke-linejoin': artwork.strokeLinejoin } : {}),
      })
    )
  }
  for (const circle of artwork.circles) {
    children.push(
      h('circle', {
        key: `c${children.length}`,
        cx: circle.cx,
        cy: circle.cy,
        r: circle.r,
        fill: 'none',
        stroke: artwork.stroke,
        'stroke-width': artwork.strokeWidth,
        ...(artwork.strokeLinecap ? { 'stroke-linecap': artwork.strokeLinecap } : {}),
      })
    )
  }
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: artwork.viewBox,
      fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': 'true',
      focusable: 'false',
      class: 'dsg-glyph dsg-glyph-official',
      'data-icon': name,
    },
    ...children
  )
}

/** Small UI glyphs that are not part of the group icon set. */
export const UI_GLYPHS = Object.freeze({
  chevronDown: 'M4 6.2l4 4 4-4',
  chevronUp: 'M4 9.8l4-4 4 4',
  chevronRight: 'M6.2 4l4 4-4 4',
  plus: 'M8 3.2v9.6M3.2 8h9.6',
  more: 'M3.4 8h.01M8 8h.01M12.6 8h.01',
  folderAdjust: 'M2.5 5.1h4l1.5 1.7h5.5v6.1h-11z',
  close: 'M4 4l8 8M12 4l-8 8',
  archive: 'M2.5 3.5h11v2.2h-11zM3.7 5.7v6.8h8.6V5.7M6.3 8.2h3.4',
  unarchive: 'M2.5 3.5h11v2.2h-11zM3.7 5.7v6.8h8.6V5.7M6.3 8.2h3.4M8 10.4V7.2M6.8 8.4L8 7.2l1.2 1.2',
  search: 'M7 2.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8zM10.4 10.4l3 3',
  sliders: 'M2.6 4.6h2.5M7.1 4.6h6.3M2.6 11.4h6.3M10.9 11.4h2.5M2.6 8h10.8M6 3.2a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zM10 10a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8z',
  check: 'M3.2 8.4l3.1 3.1 6.5-7.1',
  grid: 'M2.6 2.6h4.4v4.4H2.6zM9 2.6h4.4v4.4H9zM2.6 9h4.4v4.4H2.6zM9 9h4.4v4.4H9z',
})

/** Render a small stroke UI glyph. Default 16px to match official sidebar icons. */
export const renderGlyph = (h, name, size = 16) =>
  h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      'aria-hidden': 'true',
      focusable: 'false',
      class: 'dsg-glyph',
    },
    h('path', {
      d: UI_GLYPHS[name] ?? UI_GLYPHS.close,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.4',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    })
  )
