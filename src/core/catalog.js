/**
 * Read-only AI control catalog: stable icon/color vocabularies, documented
 * formats and operation names. Additive to the control protocol; it does not
 * change any group document or expose session data.
 */
import {
  COLOR_CATALOG,
  COLOR_FORMATS,
  CONTROL_LIMITS,
  ICON_CATALOG,
  ICON_GROUPS,
  ICON_STYLE,
} from '../shared/control-catalog.js'
import { CONTROL_OPERATIONS, CONTROL_PROTOCOL } from './control.js'

export const buildControlCatalog = () => ({
  protocol: CONTROL_PROTOCOL,
  icons: {
    style: ICON_STYLE,
    categories: ICON_GROUPS.map(({ key, labelKey }) => ({ key, labelKey })),
    items: [...ICON_CATALOG],
  },
  colors: {
    formats: COLOR_FORMATS,
    items: [...COLOR_CATALOG],
  },
  operations: [...CONTROL_OPERATIONS],
  limits: { ...CONTROL_LIMITS },
})
