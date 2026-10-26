# AGENTS.md

OpenMind Desktop is the standalone Electron application repository. User content,
provider configuration, and OS `userData` are not source assets and must never be
committed here.

## Repository boundaries

- App source: this repository.
- Private content/runtime data: the separately selected OpenMind data repository.
- External GitHub Skill source: the independent `cctools-skills` repository.
- App Skill library source: `config/skill-library/`, maintained independently.
  Generate its installable packages into ignored build output; do not read or
  add these definitions to `cctools-skills`.
- Installed Skills: `<openmindRoot>/.agent/skills/`.
- Persistent per-Skill runtime state: `<openmindRoot>/.agent/skill-data/<skill>/`.
- App-private state: Electron `userData`, optionally selected with the absolute
  `OPENMIND_USER_DATA_DIR` environment variable before startup.

Do not add real provider keys, browser profiles, cookies, tokens, fetched content,
or a copied Skill source tree to this repository.

## Common commands

```bash
npm ci
npm run typecheck
npm run build
npm run test:unit
npm run test:integration
npm run test:e2e
npm run verify
```

Node.js 22.12 or newer is required. Tests that validate the independent Skill
repository can opt in with `OPENMIND_SKILLS_REPO_ROOT=/absolute/path/to/cctools-skills`.

## Development rules

- Keep renderer filesystem and provider access behind typed preload IPC.
- Put cross-process schemas and types in `shared/`.
- Keep app-owned state under `userData`; keep content under the selected
  `openmindRoot`.
- Use temporary fixtures in tests; never read or write a developer's real data
  repository.
- Preserve support for both `cctools.skill.yaml` and the legacy
  `openmind.skill.yaml` during the manifest migration.
- Keep all application-owned CSS under `renderer/src/styles/`; the entrypoint is
  `renderer/src/styles/index.css`. Follow `renderer/src/styles/README.md` for style
  ownership and maintain theme defaults in `tokens.css`.
- Use shared `Input`, `Textarea`, and `SearchInput` from `design-system/components`
  for text controls. Maintain their appearance and interaction states only in
  `styles/components/inputs.css`; feature styles own layout. Native checkbox,
  radio, file, range and color controls may remain native.
- Use shared `Select` from `design-system/components` for dropdown choices; native
  `<select>` belongs only inside that component. Keep its UI and motion in
  `styles/components.css`. Grouped model menus reuse `SelectMenuSurface`.
- Reuse `Dialog`, `ImageViewer`, `Tabs`, `SegmentedControl`, `AnimatedDisclosure`
  and `IconButton` for matching interactions. Portalled menus use
  `useDismissableLayer`; resizing uses `usePointerResize`; plain-text copying
  uses `useClipboard` or `CopyButton`. Preserve feature-specific data loading,
  unsaved-change guards and optimized geometry updates in the owning feature.
- Keep fixed visual styles in CSS. Inline styles are for runtime values or CSS
  custom properties. Run `npm run audit:styles`; it is also part of the build.
- UI contracts live in `docs/UI_COMPONENT_CONTRACT.md`. Use public `Button`,
  `IconButton`, `FormField`, `FormDialog`, `ConfirmDialog`, `MenuItem` and the
  existing text/choice controls from `design-system/components`. Standard
  dialogs compose `DialogHeader`, `DialogBody` and `DialogFooter`; command search
  uses `SearchDialogHeader`. Use `Popover` or `PopoverSurface` for anchored
  overlays, and `Drawer` for modal app chrome. Features retain request state,
  unsaved-change guards and optimized positioning.
- Features own layout, not control paint, internal padding, fonts or heights.
  Choose typed variants/sizes instead of overriding them. Declare layout classes
  statically. Native buttons are for selection/navigation surfaces with explicit
  ARIA state; standard actions and menu items use shared controls.
- Add component variants in `design-system/control-contract.ts`, maintain their
  single CSS owner, and extend the production-component catalog and behavioral
  tests. Run `npm run check:ui` and `npm run visual:ui`. Visual baselines are
  reviewed source fixtures: update them explicitly, inspect actual/expected/diff
  images, and never regenerate them automatically to make CI pass. Preview the
  catalog with `npm run ui:catalog`. All UI tests use temporary userData.
