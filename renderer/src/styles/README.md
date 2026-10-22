# Application styles

All application-owned CSS lives here. `index.css` is the production renderer
entrypoint and defines loading order. Vendor styles from PDF.js, Milkdown and
KaTeX stay with their dependencies. The separate development catalog imports
`dev/ui-catalog.css`; production does not import that file.

| Location | Owns |
| --- | --- |
| `tokens.css` | Light/dark colors, typography, spacing, control dimensions and motion defaults |
| `base.css` | Global resets, structural surfaces and accessibility fallbacks |
| `components/buttons.css` | Button, IconButton and CopyButton appearance and interaction states |
| `components/inputs.css` | Input, Textarea, SearchInput and InputGroup |
| `components/forms.css` | FormField labels, validation messages and FormActions |
| `components/dialogs.css` | Dialog, FormDialog, ConfirmDialog and shared dialog parts |
| `components/menus.css` | MenuItem, DropdownMenu and Popover surfaces |
| `components.css` | Select, SelectTrigger, SelectMenuSurface and other existing shared controls |
| `components/uploads.css`, `components/media.css` | FileDropzone and ImageThumbnail |
| `components/image-viewer.css` | ImageViewer canvas and image navigation layout |
| `shell.css`, `navigation-motion.css` | Application chrome and navigation |
| `features/` | Feature layout, content and structural selection/navigation surfaces |
| `responsive.css` | Shared responsive layout adaptations |
| `final-polish.css`, `workbuddy-refactor.css` | Existing structural adjustments; do not add shared-control overrides |

## Public controls

Import from `design-system/components`. Choose semantic variants and sizes from
`design-system/control-contract.ts`; do not create page-specific button/input
skins. The full API and extension workflow are in
[`docs/UI_COMPONENT_CONTRACT.md`](../../../docs/UI_COMPONENT_CONTRACT.md).

```tsx
<FormDialog open={open} title={copy.title} confirmLabel={copy.save}
  busy={saving} onClose={closeWithUnsavedGuard} onConfirm={save}>
  <FormField label={copy.name} hint={copy.hint} error={nameError}>
    <Input value={name} onChange={event => setName(event.target.value)} required />
  </FormField>
</FormDialog>
<SearchInput aria-label={copy.search} value={query}
  onChange={event => setQuery(event.target.value)} />
<Button variant="primary" loading={saving} onClick={save}>{copy.save}</Button>
```

Input and Textarea use `default` for forms and `inline` for text embedded in an
existing surface. Textarea additionally supports `composer` and `code`.
SearchInput owns its complete search surface, supports `quiet` and `outlined`,
and accepts `clearAction={{ label, onClear }}`. Use `InputGroup` for unit suffixes;
FormField connects labels and validation to its native input. Native props,
refs, keyboard handlers, selection and composition remain on the actual control.
Native checkbox/radio/file/range/color controls may remain native.

Select supplies the choice trigger and keyboard navigation; use `size="rect"`
for forms and `size="pill"` for compact choices. Grouped model menus reuse
SelectTrigger and SelectMenuSurface. Native select is reserved for Select's
internal proxy. Maintain Select UI and motion in `components.css`.

## Shared interactions

Dialog owns its backdrop, portal, focus scope, dismissal and exit presence.
Compose DialogHeader, DialogBody and DialogFooter for specialized dialogs, or
use FormDialog for a standard form and ConfirmDialog for confirmation.
SearchDialogHeader provides command-search chrome. Features retain request state,
validation, data loading and unsaved-change guards. Ordinary forms initially
focus their first editable field; an explicit initialFocusRef takes precedence.
Owners that already retain a data snapshot can share their presence with Dialog.

Popover owns ordinary anchoring and dismissal. Specialized menus retain their
optimized geometry/keyboard logic and reuse PopoverSurface, useAnchoredPopover
and useDismissableLayer. Drawer provides modal focus handling for app chrome.
ImageViewer shares Dialog's media shell and owns image gestures/navigation.
Tabs, SegmentedControl and AnimatedDisclosure preserve choice/disclosure behavior.
Use usePointerResize for batched resizing and useClipboard or CopyButton for
plain-text copy feedback; rich clipboard formats keep typed IPC.

## Ownership and verification

Features may set widths, margins and flex/grid placement. Shared-control paint,
fonts, internal padding, heights and interaction states belong to the CSS owner
above. Runtime geometry and content colors may use inline values; fixed visual
styles belong in CSS. Static feature class names let the AST/style gate trace
controls through import aliases and re-exports. Legacy native-button rules must
exclude `[data-ui-control]`; the marker is owned by the design system.

Run `npm run check:ui` for ownership checks and negative regression fixtures. The
normal build includes it. Run `npm run ui:catalog` to inspect actual components,
`npm run visual:inputs` for input interaction/layout checks, and `npm run visual:ui`
for reviewed pixel comparisons in both themes and two viewport widths.
`npm run perf:ui` measures controlled search updates with 500 unrelated actions.
All Electron UI fixtures use temporary userData and synthetic content.

Intentional visual changes require `npm run visual:ui -- --update`, inspection of
the screenshots and manifest, and a successful comparison without `--update`.
CI never regenerates baselines. Keep variants, their CSS owner, catalog examples,
behavioral checks and reviewed baselines together.
