/**
 * Packaged locale resources and the dictionary registry.
 *
 * This module is the only place that imports `locale/*.json`; resolution,
 * plural formatting and host registration consume the exported dictionaries.
 */

/** Locale namespace owned by this plugin. */
export const LOCALE_NS = 'dsh-session-grove'

import zh from '../../../locale/zh.json' with { type: 'json' }
import en from '../../../locale/en.json' with { type: 'json' }
import ja from '../../../locale/ja.json' with { type: 'json' }
import ko from '../../../locale/ko.json' with { type: 'json' }
import de from '../../../locale/de.json' with { type: 'json' }
import fr from '../../../locale/fr.json' with { type: 'json' }
import es from '../../../locale/es.json' with { type: 'json' }
import pt from '../../../locale/pt.json' with { type: 'json' }
import it from '../../../locale/it.json' with { type: 'json' }
import nl from '../../../locale/nl.json' with { type: 'json' }
import pl from '../../../locale/pl.json' with { type: 'json' }
import tr from '../../../locale/tr.json' with { type: 'json' }
import vi from '../../../locale/vi.json' with { type: 'json' }
import th from '../../../locale/th.json' with { type: 'json' }
import id from '../../../locale/id.json' with { type: 'json' }

export { zh, en, ja, ko, de, fr, es, pt, it, nl, pl, tr, vi, th, id }

/** Language used whenever the active locale has no packaged dictionary. */
export const FALLBACK_LANGUAGE = 'en'

/** Dictionaries keyed by base language (`zh`, `en`, `ja`, `ko`, ...). */
export const dictionaries = Object.freeze({ zh, en, ja, ko, de, fr, es, pt, it, nl, pl, tr, vi, th, id })
