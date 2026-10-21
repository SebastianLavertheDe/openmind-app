# AGENTS.md

OpenMind Desktop is the standalone Electron application repository. User content,
provider configuration, and OS `userData` are not source assets and must never be
committed here.

## Repository boundaries

- App source: this repository.
- Private content/runtime data: the separately selected OpenMind data repository.
- Skill package source: the independent `cctools-skills` repository.
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
