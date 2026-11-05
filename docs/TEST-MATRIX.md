# Test Matrix

Status: `0.4.0-beta.26`  
This file is the single source of truth for **what has actually been verified**
and at which level. Other docs should link here instead of restating counts.

## Evidence levels

| Code | Meaning |
|---|---|
| `U` | Unit/contract tests: `npm test` (494 tests) |
| `A+ C` | Isolated Playwright, community DSH Desktop 2.0.18 / DSH `0.2.1-rc.2` |
| `A+ O` | Isolated Playwright, official DeepSeek Harness desktop 0.2.1.0 / DSH `0.2.1-rc.5` |
| `LP` | Test-only all-locale pack (`e2e/fixtures/ja-locale-pack`): host catalog injection + active locale switch |
| `H` | Historical/manual evidence in an earlier release note or test-results snapshot; not a current default automation |
| `—` | Not tested |

The default English A+ is `e2e/isolated.spec.mjs`; the language-pack A+ is
`e2e/locale-pack.spec.mjs`, and `e2e/all-locales.spec.mjs` switches through
every packaged dictionary and checks the header + new-group dialog.

A+ C/O cells are historical runtime evidence (last recorded on earlier
candidates). `0.4.0-beta.26` was not A+-re-run; do not use those cells as a
fresh candidate artifact until the release gate records a new run.

## Environment matrix

| Area | U | A+ C | A+ O | LP | Native manual |
|---|---|---|---|---|---|
| Group CRUD, move, delete, session assignment | PASS | PASS | PASS | — | PASS (maintainer) |
| Persistence, CAS, conflict/SSE convergence | PASS | PASS | PASS | — | PASS |
| Control API, session actions, doctor | PASS | PASS | PASS | — | PASS |
| English onboarding/settings/menu/dialog copy | PASS | PASS | PASS | — | — |
| English plural/time labels | PASS | PASS | PASS | — | — |
| Third-party language activation (`ja`) | PASS | — | — | PASS | — |
| All-locale switch: header + new-group dialog + group menu + settings/config (19 languages + zh-TW/zh-HK/zh-CN/pt-BR aliases) | PASS | — | — | PASS (23 cases) | — |
| Arabic RTL smoke: root `dir`, menu/dialog viewport bounds, settings panel direction | PASS | — | — | PASS (23 cases + RTL screenshots) | — |
| Full non-English UI surfaces | PASS (resources only) | — | — | LP header/dialog/group menu/settings + ja onboarding/dialog only | — |

## Language matrix

| Locale | Packaged | U parity | Runtime A+ | Language-pack A+ | Native/manual | Claim |
|---|---|---|---|---|---|---|
| `en` English | yes | PASS | A+ C + A+ O | PASS (header/dialog/group menu) | PASS | fully exercised |
| `zh` Simplified Chinese | yes | PASS | H (old `TEST-RESULTS` snapshot) | PASS (header/dialog/group menu) | H | **not a current default A+ assertion** |
| `ja` Japanese | yes | PASS | — | PASS (onboarding/dialog; all-locale) | — | follows a third-party pack |
| `ko` Korean | yes | PASS | — | PASS (header/dialog/group menu) | — | resources + locale-pack smoke |
| `de` German | yes | PASS | — | PASS (header/dialog/group menu) | — | resources + locale-pack smoke |
| `fr` French | yes | PASS | — | PASS (header/dialog/group menu) | — | resources + locale-pack smoke |
| `es` Spanish | yes | PASS | — | PASS (header/dialog/group menu) | — | resources + locale-pack smoke |
| `pt` Brazilian Portuguese | yes | PASS | — | PASS (header/dialog/group menu) | — | resources + locale-pack smoke |
| `it` Italian | yes | PASS | — | PASS (header/dialog/group menu) | — | resources + locale-pack smoke |
| `nl` Dutch | yes | PASS | — | PASS (header/dialog/group menu) | — | resources + locale-pack smoke |
| `pl` Polish | yes | PASS (one/few/many/other) | — | PASS (header/dialog/group menu) | — | resources + locale-pack smoke |
| `tr` Turkish | yes | PASS | — | PASS (header/dialog/group menu) | — | resources + locale-pack smoke |
| `vi` Vietnamese | yes | PASS | — | PASS (header/dialog/group menu) | — | resources + locale-pack smoke |
| `th` Thai | yes | PASS | — | PASS (header/dialog/group menu) | — | resources + locale-pack smoke |
| `id` Indonesian | yes | PASS | — | PASS (header/dialog/group menu) | — | resources + locale-pack smoke |
| `ru` Russian | yes | PASS (one/few/many/other) | — | PASS (header/dialog/group menu) | — | resources + locale-pack smoke |
| `hi` Hindi | yes | PASS (one/other) | — | PASS (header/dialog/group menu) | — | resources + locale-pack smoke |
| `ar` Arabic | yes | PASS (zero/one/two/few/many/other) | — | PASS (header/dialog/group menu + RTL root) | — | RTL foundation; full visual mirror not audited |
| `zh-Hant` Traditional Chinese | yes | PASS | — | PASS (header/dialog/group menu) | — | script-aware resolver; locale-pack smoke |

Important distinction:

```text
U parity PASS = the resource has the right keys, placeholders and plural
categories; it does not prove translation quality or visual fit.
LP PASS = the active locale changes and the header + new-group dialog + group
menu + settings render that dictionary; full drag surfaces are still not part
of this smoke.
```

## Locale aliases

All ids are trimmed, lowercased and `_` is treated as `-`. Script/region
candidates are tried before the base language (see `zh-Hant` rows).
`Intl.PluralRules` still receives the original normalized id, so regional
plural rules are used for plural selection.

| Input family | Selected dictionary | Notes |
|---|---|---|
| `en`, `en-US`, `en-GB`, `en_US` | `en` | fallback language |
| `zh`, `zh-CN`, `zh-Hans`, `zh-SG` | `zh` | Simplified Chinese |
| `zh-Hant`, `zh-TW`, `zh-HK`, `zh-MO`, `zh-Hant-TW` | `zh-Hant` | Traditional Chinese; script/region fallback |
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
| `ru`, `ru-RU` | `ru` | one/few/many/other |
| `hi`, `hi-IN` | `hi` | one/other |
| `vi`, `vi-VN` | `vi` | |
| `th`, `th-TH` | `th` | |
| `id`, `id-ID` | `id` | |
| unknown, empty, malformed | `en` | no exception/throw |

## Surface matrix

| Surface | Current evidence | Notes |
|---|---|---|
| Onboarding card | U + English A+ C/O + ja LP | ja LP checks title/dismiss |
| Settings/config form | U + English A+ C/O + all-locale settings smoke | all 23 cases check title/hint/controlApi/skill-repair copy |
| Group menu / session menu | U + English A+ C/O | |
| Dialog titles/body | U + English A+ C/O + ja LP (new-group title) | |
| Status labels and subagent count | U (including pl one/few/many/other) | UI uses one key + `{n}` |
| Drag labels | U + English A+ C/O | |
| Search/empty/flat fallback | U + English A+ C/O | |
| Plural objects | U parity for all 19 locales | translations are not native-reviewed |
| Long strings / narrow sidebar | English A+ only | ru/hi/ar 264px-min sidebar (252px content) screenshots: no root overflow; title ellipsizes at minimum width |
| RTL | Root `dir`, menu/dialog bounds, settings direction | fine geometry/drag mirroring still not exhaustively audited |

## Not verified

- Full A+ remains English-only; Japanese has the onboarding/dialog fixture.
- All 19 packaged dictionaries have header/dialog/group-menu/settings smoke
  coverage, not full-surface A+.
- No native/client visual pass beyond ru/hi/ar narrow-sidebar screenshots.
- No translation-quality review beyond structural parity.
- Arabic RTL has root direction, menu/dialog bounds and settings direction,
  but no exhaustive drag/resize geometry or every-icon visual mirror audit.

## Required evidence before claiming a new language

1. `U`: key/placeholders/plural categories/non-empty values pass for every
   resource.
2. Add aliases and a base-language resolution test.
3. Run at least an English A+ regression (no global regression).
4. Add the language to `e2e/all-locales.spec.mjs`; assert header + new-group
   dialog copy and, for RTL, the plugin root `dir`. Full settings/menu copy
   still needs its own fixture.
5. For RTL languages, add `dir` propagation, core logical/physical overrides,
   and a visual regression before claiming full support.
