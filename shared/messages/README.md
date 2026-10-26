# UI messages

All application-owned interface copy belongs in this directory. `zh-CN/` is the
canonical key and interpolation schema; `en/` must provide the same structure.
Each English module uses `satisfies TranslationOf<typeof ChineseMessages>` to
check keys and interpolation arguments without restricting translations to
Chinese string literals. Add both translations in the same change.

Preset Skill titles, descriptions and input hints are configurable catalog content
in `config/skill-library/catalog.json`, with their translations beside each entry.
Keep general Skill interface controls and category labels in this directory.

Use complete messages with named interpolation arguments. Avoid joining sentence
fragments in components. Keep protocol IDs, disk folder names, user content and
provider/model IDs independent of the interface language.

Import `messages` from `@shared/messages` in Renderer, or the shared entry in
Main/Worker. Nested aliases remain live across language changes. React components
must call `useLocale()` from `renderer/src/i18n.ts`; include its return value in
memo dependencies when calculating labels. Use getters for module-level menu or
option labels. Zod validation messages must use an `error` callback or be built
inside `superRefine`, so they resolve when validation runs.

Ordinary event callbacks read the live catalog when invoked and do not need a
locale dependency. Keep streaming stores, event pumps and service subscriptions
stable across language changes; subscribe the components that display their data.

`uiLanguage` is stored with application preferences under Electron `userData`.
Existing installations default to Simplified Chinese. Settings apply a new
language only after persistence succeeds; the window updates without reloading.
Main propagates language changes to the existing AI Worker. `defaultLanguage`
continues to describe content creation preferences.

Use `getLocale()` for UI date, number and sorting formats. Use an explicit
`getMessages(locale)` catalog when a background operation should retain the
language in which it began. Existing user documents, conversations and saved
third-party/Skill/provider messages are content, and are not rewritten on switch.

Run `npm run typecheck`, `npm run audit:ui-copy-hardcode` and
`npx vitest run shared/messages` to check catalog coverage and dynamic behavior.
