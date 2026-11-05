# Test Matrix

Status: `0.4.0-beta.14`  
This file is the single source of truth for **what has actually been verified**
and at which level. Other docs should link here instead of restating counts.

## Evidence levels

| Code | Meaning |
|---|---|
| `U` | Unit/contract tests: `npm test` (490 tests) |
| `A+ C` | Isolated Playwright, community DSH Desktop 2.0.18 / DSH `0.2.1-rc.2` |
| `A+ O` | Isolated Playwright, official DeepSeek Harness desktop 0.2.1.0 / DSH `0.2.1-rc.5` |
| `LP` | Test-only language-pack fixture (`e2e/fixtures/ja-locale-pack`) |
| `H` | Historical/manual evidence in an earlier release note or test-results snapshot; not a current default automation |
| `—` | Not tested |

The default English A+ is `e2e/isolated.spec.mjs`; the language-pack A+ is
`e2e/locale-pack.spec.mjs`.

## Environment matrix

| Area | U | A+ C | A+ O | LP ja | Native manual |
|---|---|---|---|---|---|
| Group CRUD, move, delete, session assignment | PASS | PASS | PASS | — | PASS (maintainer) |
| Persistence, CAS, conflict/SSE convergence | PASS | PASS | PASS | — | PASS |
| Control API, session actions, doctor | PASS | PASS | PASS | — | PASS |
| English onboarding/settings/menu/dialog copy | PASS | PASS | PASS | — | — |
| English plural/time labels | PASS | PASS | PASS | — | — |
| Third-party language activation (`ja`) | PASS | — | — | PASS | — |
| Full non-English UI surfaces | PASS (resources only) | — | — | ja onboarding/dialog only | — |

## Language matrix

| Locale | Packaged | U parity | Runtime A+ | Language-pack A+ | Native/manual | Claim |
|---|---|---|---|---|---|---|
| `en` English | yes | PASS | A+ C + A+ O | — | PASS | fully exercised |
| `zh` Simplified Chinese | yes | PASS | H (old `TEST-RESULTS` snapshot) | — | H | **not a current default A+ assertion** |
| `ja` Japanese | yes | PASS | — | PASS (onboarding/dialog only) | — | follows a third-party pack |
| `ko` Korean | yes | PASS | — | — | — | resources only |
| `de` German | yes | PASS | — | — | — | resources only |
| `fr` French | yes | PASS | — | — | — | resources only |
| `es` Spanish | yes | PASS | — | — | — | resources only |
| `pt` Brazilian Portuguese | yes | PASS | — | — | — | resources only |
| `it` Italian | yes | PASS | — | — | — | resources only |
| `nl` Dutch | yes | PASS | — | — | — | resources only |
| `pl` Polish | yes | PASS (one/few/many/other) | — | — | — | resources only |
| `tr` Turkish | yes | PASS | — | — | — | resources only |
| `vi` Vietnamese | yes | PASS | — | — | — | resources only |
| `th` Thai | yes | PASS | — | — | — | resources only |
| `id` Indonesian | yes | PASS | — | — | — | resources only |
| `ru` Russian | no | — | — | — | — | not packaged |
| `hi` Hindi | no | — | — | — | — | not packaged |
| `ar` Arabic | no | — | — | — | — | not packaged; RTL also missing |
| `zh-Hant` Traditional Chinese | no separate resource | — | — | — | — | **currently resolves to simplified `zh`** |

Important distinction:

```text
U parity PASS = the resource has the right keys, placeholders and plural
categories; it does not prove translation quality or visual fit.
```

## Locale aliases

All ids are trimmed, lowercased, `_` is treated as `-`, and only the first
language subtag is used for dictionary selection. `Intl.PluralRules` still
receives the original normalized id, so regional plural rules are used for
plural selection.

| Input family | Selected dictionary | Notes |
|---|---|---|
| `en`, `en-US`, `en-GB`, `en_US` | `en` | fallback language |
| `zh`, `zh-CN`, `zh-Hans`, `zh-Hant`, `zh-TW`, `zh_TW` | `zh` | all currently map to Simplified Chinese |
| `ja`, `ja-JP`, `ja_JP` | `ja` | |
| `ko`, `ko-KR` | `ko` | |
| `de`, `de-DE`, `de-AT` | `de` | |
| `fr`, `fr-FR`, `fr-CA` | `fr` | |
| `es`, `es-ES`, `es-419`, `es-MX` | `es` | |
| `pt`, `pt-BR`, `pt-PT` | `pt` | packaged resource is Brazilian Portuguese |
| `it`, `it-IT` | `it` | |
| `nl`, `nl-NL` | `nl` | |
| `pl`, `pl-PL` | `pl` | one/few/many/other |
| `tr`, `tr-TR` | `tr` | |
| `vi`, `vi-VN` | `vi` | |
| `th`, `th-TH` | `th` | |
| `id`, `id-ID` | `id` | |
| unknown, empty, malformed | `en` | no exception/throw |

## Surface matrix

| Surface | Current evidence | Notes |
|---|---|---|
| Onboarding card | U + English A+ C/O + ja LP | ja LP checks title/dismiss |
| Settings/config form | U + English A+ C/O | ja LP does not cover settings |
| Group menu / session menu | U + English A+ C/O | |
| Dialog titles/body | U + English A+ C/O + ja LP (new-group title) | |
| Status labels and subagent count | U (including pl one/few/many/other) | UI uses one key + `{n}` |
| Drag labels | U + English A+ C/O | |
| Search/empty/flat fallback | U + English A+ C/O | |
| Plural objects | U parity for all 15 locales | translations are not native-reviewed |
| Long strings / narrow sidebar | English A+ only | de/fr/th/pl resources are not visually measured |
| RTL | — | no `dir` propagation; physical CSS |

## Not verified

- No current automated A+ for `zh`, `ja` full UI, `ko`, `de`, `fr`, `es`, `pt`,
  `it`, `nl`, `pl`, `tr`, `vi`, `th`, `id`.
- The `ja` LP fixture covers only onboarding and new-group dialog.
- No native/client visual pass for non-English translations.
- No translation-quality review beyond structural parity.
- No Arabic/Hindi/Russian resources.
- No Traditional Chinese resource or script-aware locale resolution.

## Required evidence before claiming a new language

1. `U`: key/placeholders/plural categories/non-empty values pass for every
   resource.
2. Add aliases and a base-language resolution test.
3. Run at least an English A+ regression (no global regression).
4. For the new language, run either a language-pack A+ fixture or an isolated
   language switch; assert onboarding, settings, menu and dialog copy.
5. For RTL languages, add `dir` propagation, logical CSS, and a visual
   regression before claiming support.
