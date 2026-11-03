/**
 * Pure fork placement policy.
 *
 * A forked child goes to the head of the source session's custom group. When
 * the source is ungrouped (or host-derived), the child is intentionally left
 * outside the group document: the render tree derives ungrouped sessions by
 * recency, so the new child appears first in the ungrouped section. Assigning
 * it to `doc.ungrouped` would put it after derived sessions instead.
 */
import { assignSession } from '../shared/model.js'

export const placeForkedSession = (doc, sourceSessionId, childSessionId) => {
  const source = doc.groups.find((group) => group.sessionIds.includes(sourceSessionId))
  return source === undefined ? doc : assignSession(doc, childSessionId, source.id, 0)
}
