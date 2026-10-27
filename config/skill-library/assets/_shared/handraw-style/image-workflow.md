# Image delivery in OpenMind

These workflows adapt [yang0/handraw-style](https://github.com/yang0/handraw-style).
Read `ATTRIBUTION.md` for the source revision and `LICENSE.handraw-style` for its
license. The source workflows are reference material; use the OpenMind contract
below when their defaults differ.

## Inputs and visual decisions

1. Use the current conversation's selected files, article and attached images.
   Read the actual material before designing. Ask only for a missing input that
   prevents useful work. Do not repeat questions answered by the current context.
2. Use `references/visual-library.json` to choose a style, palette and relevant
   layout. It is a curated subset, not the complete upstream collection. Resolve
   a style ID against this file; for an absent ID ask for its name or description
   instead of inventing its meaning. A user's explicit visual direction wins.
3. State a short design direction and proceed to generation. Avoid an extra
   approval step for ordinary image work. Unless requested otherwise, use the
   user's language for text inside images and the final reply.
4. For related pages, establish one palette, recurring motif, text hierarchy,
   margin and aspect ratio. Keep the factual content, units and exact labels from
   the source. Do not add made-up statistics or quotations for visual balance.

## Generate images

- Call `openmind_generate_image`. It uses the user's selected image provider and
  model. Never hard-code an upstream model, change provider settings, download
  another generator or silently switch to an external image service.
- The tool accepts `prompt`, `count` (1–4 variations of the same prompt), and
  `referenceImages` (at most 8 permitted local paths). Do not pass an unsupported
  `size` or `aspectRatio` argument; include the intended composition in `prompt`.
- A carousel, article or IP set needs separate calls with page-specific prompts.
  Generate the first image, inspect it, then reuse it as a visual reference for
  subsequent pages. `count: 4` does not generate four differently scripted pages.
- Use a supplied photo for editing and a real established character image for
  continuity. Never treat a generated replacement as the untouched original.
- Limit retries to fixing identified defects. If generation fails or the image
  tool is unavailable, report the missing capability or partial results. Do not
  describe a plan, a prompt or a failed call as a finished image.

## Exact dimensions and real-photo composition

The app supplies `electron` and `imageComposer` paths in the available-Skill
runtime tools. They work in development and packaged apps. No Python, Pillow,
ffmpeg or additional installation is required for this step.

Write a small job JSON into the allowed task output directory, then launch the
provided executable with this argument array (substitute the actual paths):

```json
["<electron>", "<imageComposer>", "--openmind-compose-image", "<job.json>", "<new-output.png>"]
```

Remove `ELECTRON_RUN_AS_NODE` from that child process's environment only. Preserve
other environment settings and quote each path when using a shell. Do not change
the user's environment, disable sandboxing, or launch another app profile. The
application's compositor uses a disposable profile automatically, reads only the
specified local images, and refuses to overwrite an existing output file.

To normalize a cover to exactly 2350 × 1000 pixels:

```json
{
  "kind": "fit",
  "image": "/absolute/path/to/generated.png",
  "width": 2350,
  "height": 1000,
  "fit": "contain",
  "background": "#ffffff"
}
```

`contain` preserves the whole image and pads spare space with the background.
Use `cover` only after verifying that the centered crop retains all essential
text and subjects. Never stretch an image to force a ratio. Dimensions are whole
pixels between 64 and 4096; choose exact integer multiples for the target ratio.

To pair a real photo with its illustrated interpretation:

```json
{
  "kind": "diptych",
  "original": "/absolute/path/to/original.jpg",
  "illustration": "/absolute/path/to/illustrated.png",
  "width": 1616,
  "height": 1200,
  "direction": "horizontal",
  "gap": 16,
  "background": "#ffffff"
}
```

The original is always first (left or top), each panel has equal space, both use
`contain`, and the source files remain unchanged. Derive dimensions from the
photo: for two 800 × 1200 portrait panels and a 16 px gutter use 1616 × 1200;
for two 1200 × 800 landscape panels stacked vertically use 1200 × 1616.
Supported sources are PNG, JPEG and WebP, at most 20 MB each. The output is PNG.

## Check and deliver

Inspect the final images for subject fidelity, readable text, correct facts,
matching dimensions and continuity. For a multi-page result verify the requested
page count and reading order. If the runtime cannot inspect an image, do not
claim visual verification; say what remains unverified.

Write final files only to the current conversation's permitted output location,
using new file names. Installation directories are read-only package resources.
Keep job JSON, drafts, rejected images and prompt notes out of the deliverables.
After confirming the actual final paths, declare only finished deliverables:

~~~~~text
~~~~openmind-deliverables
[{"path":"/absolute/path/to/final.png","title":"Finished cover"}]
~~~~
~~~~~

Use each file's real path rather than the example above. A generated image event
alone does not select it as a final deliverable. Deliver individual final pages,
not only a contact sheet. If a requested set is incomplete, say which pages are
missing and label the delivered subset. Do not automatically publish, submit to
a community, or append the upstream sharing calls to action.
