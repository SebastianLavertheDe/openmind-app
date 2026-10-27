# New task welcome — design QA

final result: passed

## Target and evidence

- Source visual: `C:/Users/say/AppData/Local/Temp/codex-clipboard-e15add13-b044-4c69-b860-7537bc727fc9.png`.
- Source pixels: 3420 × 1797, normalized to 2048 × 1076 for comparison.
- Implementation: `http://127.0.0.1:5175/dev/new-task-preview.html?case=new-task-home&lang=zh-CN`.
- Browser-rendered final screenshot: `.tmp/new-task-design/implementation-final.png`, 2048 × 1076 pixels at a 2048 × 1076 CSS viewport. The screenshot API returns the CSS-sized image; no additional implementation scaling was applied.
- Full-view side-by-side comparisons (source left, implementation right): `.tmp/new-task-design/comparison-first.png` and `.tmp/new-task-design/comparison-final.png`.
- Focused comparison: `.tmp/new-task-design/comparison-focused.png`, covering heading, composer, categories, and the first recommendation row from both views.
- Narrow-window evidence: `.tmp/new-task-design/implementation-mobile.png`, 390 × 844 CSS pixels.
- State: new task, empty draft, recommended category, light theme. Additional visual gate captures both themes at 720px and 1280px.

This is an implementation in the existing Electron application. The reference supplies layout and visual direction; the application's actual skill identities, permission controls, workspace action and configured model remain functional. The reference's microphone is not reproduced because the application has no existing voice-input feature. The twelve covers are original assets for the twelve actual App presets, rather than copied third-party skill offerings.

## Comparison history

1. Initial comparison found a P2 proportion mismatch: the composer was about 118px high, with a stronger shadow, and the recommendation grid began about 13px below the source. Evidence: `comparison-first.png`.
2. Added the shared compact composer textarea size, used one initial text row and the existing medium send-action size, softened the composer surface shadow and reduced the category-to-grid gap. Shared text-control paint remains in `styles/components/inputs.css`.
3. Re-captured and compared the final implementation alongside the source. Heading top is 238.3px (source approximately 239px); composer is 650px wide and 111.3px high (source approximately 650 × 110px); first grid row starts at 534.6px (source approximately 535px). Evidence: `comparison-final.png` and `comparison-focused.png`. No actionable P0/P1/P2 mismatch remains within the stated application adaptation.
4. Follow-up proportion fix in the application build: the standalone preview measured the composer at 650px, but in the running app the conversation chrome's side gutters (`.ai-workbench .composer`) applied inside the 650px welcome frame, shrinking the visible card to 496px — the ~54% ratio reported against the reference. The welcome reset is now scoped as `.new-task-composer .composer--welcome` so it outranks the chrome rule, and the catalog case renders inside the real workbench chrome so the preview can no longer diverge from the app. A geometry pass across light/dark at 2048/1280/720/390 measures the composer at 650px (70.7% of the 920px recommendation region, matching the source's ~70%), centered with zero horizontal overflow; re-applying the legacy gutters reproduces exactly 496px with unchanged height. `check:ui`, `typecheck` and the full visual regression (56 comparisons, 92 captures, baselines unchanged) pass.

## Review

- Typography: existing application sans-serif stack; regular 28px heading, 13px card labels and smaller muted category metadata. The heading and card hierarchy match the source. Existing shared tabs and buttons retain their public appearance.
- Layout: centered 650px composer, 920px recommendation region, four 215px columns with 20px horizontal gaps, 27:16 covers and 18px corners. Cards become three and then two columns as the window narrows; categories scroll horizontally.
- Colors: existing light/dark theme tokens, white light-theme canvas, quiet border and shadow, muted category labels. The poster, stationery, film and product imagery supply color without changing application theme tokens.
- Images: twelve individually generated raster covers, inspected before use, optimized to 864 × 512 JPEGs totaling about 1.37MB. No CSS drawings or screenshot fragments substitute for image assets. Prompt and provenance notes are in `renderer/src/assets/skill-covers/README.md`.
- Copy: Chinese heading and input placeholder follow the reference. Recommendation names and categories come from the real localized skill catalog.

## Interaction and verification

- Browser-tested category switching, complete Prompt preview, explicit install/use, return of focus to the composer, updated input hint, draft input and send-button enablement, and Browse all opening the Explore catalog.
- Confirmed that previewing a skill does not install it, and choosing a skill does not send a task automatically. Unit coverage verifies draft preservation and retry after a catalog-loading failure.
- At 390 × 844, both default and selected-skill states report zero document, home-surface and toolbar horizontal overflow; send and model controls remain accessible.
- Console checked after a clean reload: no errors. Transient development hot-update/context-replacement errors during editing were cleared by the clean reload before final verification.
- Passed application/chat, composer, companion sidebar, project-task and shared-input tests; TypeScript checks; renderer production build; UI ownership/contracts; and visual regression (56 reviewed pixel comparisons, 92 captures). Reviewed baselines were not regenerated.
- All test and preview content uses synthetic fixtures; no developer content repository is used for tests.

## Follow-up polish

P3 only: exact operating-system font rasterization and the reference's third-party card artwork differ. The retained workspace/permission controls and absence of unsupported voice input are intentional application adaptations, not missing interactive controls.

The local browser preview remains available for review. Real task execution continues through the application's existing provider and Project boundaries; the standalone preview uses in-memory fixtures.
