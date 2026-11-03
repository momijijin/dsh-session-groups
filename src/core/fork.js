/**
 * Pure fork placement policy.
 *
 * A successfully forked child is inserted at the head of the source session's
 * group. A source that is not explicitly inside the group document (ungrouped
 * or host-derived) places the child at the ungrouped head.
 */
import { assignSession } from '../shared/model.js'

export const placeForkedSession = (doc, sourceSessionId, childSessionId) => {
  const source = doc.groups.find((group) => group.sessionIds.includes(sourceSessionId))
  return assignSession(doc, childSessionId, source?.id ?? null, 0)
}
