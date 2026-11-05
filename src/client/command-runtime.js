/**
 * Command/toast bridge for non-React action modules.
 *
 * Kept separate from components-primitives so menu/dialog/search handlers do
 * not pull React into their dependency graph just to dispatch an action.
 */
import { clientRuntime as rt } from '../adapters/client-runtime.js'

export const dispatch = (action, payload) => rt()?.store.dispatch(action, payload)

export const toast = (kind, message) => rt()?.notify({ kind, message })
