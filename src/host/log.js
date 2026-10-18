/**
 * Safe logging helpers for the host half.
 *
 * Writes to stdout/stderr (the operator-visible dsh web server log, which the
 * Gate 0/1 evidence scripts capture) and mirrors to `ctx.logger` when the
 * composition provides one. Logging must never turn a handled failure into a
 * thrown error, and unit-test fakes may omit the logger entirely.
 */

export const logInfo = (ctx, message) => {
  try {
    console.log(message)
  } catch {
    // stdout unavailable (embedded/worker context): fall through to the logger.
  }
  try {
    if (typeof ctx?.logger?.info === 'function') ctx.logger.info(message)
  } catch {
    // logging is best-effort
  }
}

export const logWarn = (ctx, message) => {
  try {
    console.warn(message)
  } catch {
    // stderr unavailable: fall through to the logger.
  }
  try {
    if (typeof ctx?.logger?.warn === 'function') ctx.logger.warn(message)
  } catch {
    // logging is best-effort
  }
}
