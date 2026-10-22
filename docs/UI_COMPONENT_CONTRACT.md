# UI component contract

The renderer uses one public design system. New UI chooses an existing semantic
component and a typed variant. Features own data, request state, filtering,
validation and layout. Components own their native control, appearance,
accessibility and common interaction behavior.

## Public components and ownership

Import controls from `renderer/src/design-system/components.tsx`.

| Use | Component | CSS owner under `renderer/src/styles/` |
| --- | --- | --- |
| Standard action | `Button` | `components/buttons.css` |
| Icon action / copy | `IconButton`, `CopyButton` | `components/buttons.css` |
| Text / search / units | `Input`, `Textarea`, `SearchInput`, `InputGroup` | `components/inputs.css` |
| Labels and validation | `FormField`, `FormActions` | `components/forms.css` |
| Form / confirmation | `FormDialog`, `ConfirmDialog` | `components/dialogs.css` |
| Specialized modal | `Dialog` + `DialogHeader`, `DialogBody`, `DialogFooter` | `components/dialogs.css` |
| Command search header | `SearchDialogHeader` | `components/dialogs.css` |
| Choice trigger / select | `Select`, `SelectTrigger`, `SelectItem`, `SelectMenuSurface` | `components.css` |
| Menus and anchored panels | `DropdownMenu`, `MenuItem`, `Popover`, `PopoverSurface` | `components/menus.css` |
| File import / image action | `FileDropzone`, `ImageThumbnail` | `components/uploads.css`, `components/media.css` |

App navigation and AI drawers use `Drawer` for modal focus/ARIA behavior and keep
their existing application-chrome geometry. `ImageViewer` uses Dialog's media
surface and owns its image canvas in `image-viewer.css`.

`control-contract.ts` defines the supported action sizes, variants, tones, input
variants and dialog sizes. `tokens.css` defines the theme values and dimensions.
Dimensions follow each component's established design: form inputs use 34px,
rectangular Select triggers use a 36px minimum, and pill choices retain their
content-based height. Compact actions use `sm`; large actions use `lg`.
Form inputs are `default`, embedded plain text is `inline`,
message composers use `composer`, and Markdown source editors use `code`.
Choose a variant for its meaning, rather than introducing a page-specific skin.
Toolbar and navigation actions use `responsiveTarget` to keep a 44px minimum
target in windows up to 720px wide. Coarse pointers use that minimum for every
shared action. The shared button stylesheet owns both adaptations.

Select UI and motion belong exclusively to `components.css`, including standalone
`SelectTrigger`, `SelectItem` and grouped `SelectMenuSurface`. Choice items do not
inherit the generic `MenuItem` paint. Preserve the established 14px menu radius,
subtle border, 10px option padding and 8px option radius. `SelectItem` uses
`option`, `group` and `detail` variants; detailed model rows retain their 9px
radius, wrapping descriptions, icon sizes and selection/expansion feedback.
`SelectMenuSurface variant="grouped"` removes the ordinary surface inset so
feature-owned groups can supply their layout. `Select` and `SelectTrigger` use
`variant="quiet"` for transparent 36px composer choices: permission remains a
pill, while the model trigger uses `shape="rect"` and its established 7px radius.
An option's `tone="warning"` also colors its selected trigger. Shared ownership
preserves these distinct designs instead of forcing every control to one height.

## Standard form

```tsx
<FormDialog
  open={open}
  title={copy.title}
  confirmLabel={copy.save}
  busy={saving}
  onClose={closeWithUnsavedGuard}
  onConfirm={save}
>
  <FormField label={copy.name} hint={copy.nameHint} error={nameError}>
    <Input value={name} onChange={event => setName(event.target.value)} required />
  </FormField>
  <FormField label={copy.permission}>
    <Select size="rect" ariaLabel={copy.permission} value={permission}
      options={permissions} onChange={setPermission} />
  </FormField>
</FormDialog>
```

The feature owns `saving`; the dialog does not start or duplicate requests. Busy
forms prevent submit, cancel, backdrop and Escape activation. Native constraint
validation still runs. Ordinary forms initially focus the first editable field;
`initialFocusRef` takes precedence over the default `initialFocusSelector`.
Fields preserve refs, selection, composition and DOM
identity when values or validation change. `FormField` associates labels and
messages; `InputGroup` forwards this association to its native input.

`ConfirmDialog` uses two actions, focuses Cancel for dangerous operations and
Confirm for ordinary operations, and restores the triggering focus when closed.
`Dialog` retains one exit snapshot. An owner with an existing retained presence
passes it to Dialog without creating another timer or motion subscription.

Complex forms can compose the dialog parts while retaining their own form,
submit policy and asynchronous lifecycle. Their header/footer still use the
shared chrome. `Popover` owns ordinary positioning, dismissal and optional focus
scope. Owners with specialized or optimized geometry/keyboard handling use
`PopoverSurface` with `useAnchoredPopover` and `useDismissableLayer`, keeping one
position observer and one dismissal registration. The `anchor` surface variant
contains the shared `SelectMenuSurface` rather than another painted panel.

## Styling boundary

Feature classes may set widths, margins, placement, flex/grid layout and business
content layout. They do not set control backgrounds, borders, radii, internal
padding, heights, fonts or interaction states. The same boundary applies to
aliases, descendant selectors and inline style objects. Reserved control tokens
are maintained in `tokens.css`. Runtime geometry and user-selected content colors
remain supported; appearance changes use a public variant.

Legacy native-element rules exclude `[data-ui-control]`. That attribute is set
only inside the design system. It is not a feature opt-out. Native buttons remain
valid for actual navigation/selection surfaces, with explicit ARIA state and
`data-motion="selection"` or `"disclosure"`. Ordinary actions, menu items,
file pickers and image actions use the corresponding shared component.

Do not add `!important`, feature-owned text-control styles, ad hoc modal shells,
runtime-generated layout class names or duplicate components with public control
names. Static classes and conditional combinations of declared classes are
checked through TypeScript import/re-export resolution and parsed CSS selectors.

## Development and verification

`renderer/dev/ui-catalog.tsx` renders the actual production components and full
application CSS. It is a separate development entry and is absent from the app
bundle. Supported action/input variants are generated from the public contract,
so adding a variant also changes the examples and visual comparisons. The
catalog includes validation, disabled/loading states, search, menus, confirmations
and the real Project icon-picker dialog. Choice coverage includes the existing
pill menu, an open rectangular form Select, quiet automatic permission with its
warning tone, and the real `ComposerModelPicker` parent and image submenu. The
model fixtures provide only in-memory configuration and selection methods with
synthetic providers; they cannot contact a provider or load user content.

```bash
npm run ui:catalog
npm run check:ui
npm run test:unit
npm run visual:snapshot
npm run visual:inputs
npm run visual:ui
npm run perf:ui
```

`check:ui` runs import-aware ownership checks and positive/negative regression
fixtures, including a deliberately invalid new action that must fail the build.
It runs as part of the normal build. Behavioral tests cover submit/busy handling,
native validation, clear/search behavior, nested Escape, focus restoration and
stable input identity. Motion preference uses one OS subscription for all
controls, released after the final consumer unmounts. Simple actions add no
timers, subscriptions or wrapper DOM.

The Electron visual runner compares 48 reviewed screenshots: two themes, two
viewport widths and twelve component/composition scenarios. It checks geometry
and actual open overlays before comparing pixels, and records an input-update
budget with 500 memoized unrelated actions. This measures controlled React
updates and synchronous layout, not end-to-end typing or paint latency. Fonts, runtime, device scale and motion
preference are pinned for deterministic screenshots. Reduced-motion screenshots
complement the regular-motion behavior tests and existing motion checks.
Choice scenarios open the production triggers and provider submenu through real
pointer events, then assert selected/disabled/warning states, grouped choices and
viewport containment before capturing pixels.
Four additional long-confirmation checks keep the footer visible and Cancel
focused at narrow widths in both themes. The application screenshot runner also
checks responsive layouts, coarse-pointer targets, resized textareas and overlay
geometry using synthetic content and the production renderer.

The canonical CI baseline is Linux arm64. Other platforms need their own reviewed
baseline. A missing baseline or changed rendering runtime fails explicitly.
Actual, expected, difference images and reports are written under
`.tmp/ui-regression/`. Catalog/tests use synthetic content and temporary
Electron userData; they never load a real OpenMind data repository or Provider.

For an intentional design or runtime change:

```bash
npm run visual:ui -- --update
```

Inspect the resulting screenshots, rerun `npm run visual:ui` without updating,
and review the PNG and manifest diff. CI cannot update baselines. Changes to
components, their CSS owners, the public contract, examples, behavioral tests and
reviewed baseline belong in the same change. The `UI contract` workflow runs the
normal build, tests and visual comparisons, and uploads failure evidence.

For the first migration into a shared component, capture the same production
flows before and after the change and compare their actual appearance before
accepting a new catalog baseline. A baseline generated only after migration can
detect later changes; it does not prove that the previous design was preserved.
