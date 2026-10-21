# Application styles

All application-owned CSS lives in this directory. `index.css` is the renderer
entrypoint and defines the loading order. Optional feature styles also live here;
vendor styles from PDF.js, Milkdown and KaTeX stay with their dependencies.

| Location | Maintains |
| --- | --- |
| `tokens.css` | Light/dark defaults, colors, typography, spacing, control dimensions and motion tokens |
| `base.css` | Global resets, existing shared styles and accessibility fallbacks |
| `components/inputs.css` | Input, Textarea, SearchInput appearance and interaction states |
| `components.css` | Other shared controls |
| `shell.css`, `navigation-motion.css` | Application chrome and navigation |
| `features/` | Feature layout and feature-specific surfaces |
| `responsive.css` | Shared responsive adaptations |
| `final-polish.css`, `workbuddy-refactor.css` | Existing product adjustments; do not add input overrides here |

## Text controls

Import `Input`, `Textarea` and `SearchInput` from `design-system/components`.

```tsx
<label>
  Name
  <Input value={name} onChange={event => setName(event.target.value)} />
</label>
<SearchInput aria-label="Search files" value={query} onChange={event => setQuery(event.target.value)} />
<Textarea aria-label="Description" value={description} onChange={event => setDescription(event.target.value)} />
```

`Input` and `Textarea` default to a thin bordered form control. Use `variant="inline"`
for text inside an existing editor surface. `SearchInput` owns the complete search
surface, including optional leading/trailing icons; it defaults to a quiet search
field and supports `variant="outlined"`. Input and SearchInput support `size="sm"`
for compact toolbars. Native props, refs, labels, keyboard handlers, selection,
disabled/read-only state and `aria-invalid` pass through to the actual control.
Use `InputGroup` with an inline Input when a form field includes a unit suffix.
SearchInput accepts `clearAction={{ label, onClear }}` to clear a controlled query
and restore input focus. Supply a localized label and omit the action for an empty query.

Maintain borders, backgrounds, focus feedback, disabled and invalid styles in
`components/inputs.css`. Feature CSS may position/size a control and set editorial
typography, but must not redefine its interaction appearance. Keep labels in the
feature so field names and validation messages retain their business meaning.

Native checkbox/radio/file/range/color controls are separate from text inputs.
Fixed visual declarations belong in CSS. Runtime geometry, user-selected colors,
progress values and CSS custom properties can be supplied by components.

## Select controls

Use `Select` from `design-system/components` for dropdown choices, including
settings, filters, permissions and dialog fields. Supply `options`, `value`,
`onChange` and a localized `ariaLabel`; use `size="rect"` for forms. `autoFocus`,
`title` and `disabled` apply to the visible trigger. `menuSide` and `menuAlign`
control its preferred placement while the shared popover keeps it in view.

`SelectMenuSurface` supplies the same rounded panel, option spacing and
fade/translate/scale transitions to simple selects and grouped model menus.
Maintain this appearance in `components.css`; feature styles own control layout
and semantic states. Native `<select>` is reserved for Select's internal proxy;
`audit:styles` rejects native selects in feature code.

## Shared interactions

`Dialog` owns the modal surface, backdrop dismissal, focus scope, portal and exit
presence; features own its header, form, footer and layout. Owners that retain a
data snapshot during exit may pass their existing `presence`. `dismissDisabled`
is an explicit busy-state policy. `ImageViewer` shares this shell and owns image
navigation, keyboard and swipe handling; each feature still loads its own image
data. Maintain viewer styles in `components/image-viewer.css`.

Menus and popovers share `useDismissableLayer` so the foremost child handles Esc
before its parent, including across portals. Keep anchoring in
`useAnchoredPopover`. Use `Tabs` or `SegmentedControl` for related choices (their
change callbacks may await a navigation guard), `AnimatedDisclosure` for animated
expansion, and `IconButton` for accessible icon actions with shared tooltips.
`usePointerResize` owns pointer batching and cancellation; consumers own geometry.
`useClipboard` owns copy feedback and timer cleanup; rich clipboard formats keep
their typed IPC implementation.

Run `npm run audit:styles` to check these boundaries, including appearance overrides
on shared controls and their feature classes. The build runs it automatically.
Run `npm run visual:inputs` for Electron checks of focus, error states and layout
in both themes at 720, 900 and 1280 pixels.
