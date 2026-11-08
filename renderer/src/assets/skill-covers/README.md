# Skill gallery covers

Original raster assets generated individually with the Codex built-in Image Gen tool for App-owned Skills. The ten previously missing covers were generated on 2026-11-06; the existing poster cover was retained. No provider credentials or third-party fetched content were used. Each selected output was visually inspected, then resized and encoded as an 864 × 512 JPEG for the 27:16 card slot. Application UI text remains outside the cover; text intrinsic to poster artwork remains inside the image.

All prompts specified a full-bleed landscape cover with no UI frame, border, rounded corners, watermark or external brand logo. The reference supplied editorial density, tactile-paper treatment and a restrained cream/blue/coral palette.

| Final asset | Prompt / art direction |
| --- | --- |
| `om-poster-maker.jpg` | Engraved cobalt galloping horse on warm pale paper with integrated bold coral serif typography: “MAKE SOMETHING.” |
| `om-article-cover.jpg` | Sculptural open-book cover, sunrise and alternative cover sketches. |
| `om-article-illustrator.jpg` | Long article scroll with illustrations embedded between prose. |
| `om-social-cards.jpg` | Five coordinated illustrated social carousel cards. |
| `om-knowledge-infographic.jpg` | Seed-to-flower explanation with connectors and root detail. |
| `om-four-panel-comic.jpg` | Consistent cat character plants a seed in a complete four-panel story. |
| `om-photo-diptych.jpg` | Same coffee scene shown as a photo and a matching hand-drawn illustration. |
| `om-product-highlights.jpg` | Travel bottle with detail callouts for cap, construction and carry loop. |
| `om-brand-character.jpg` | Original otter mascot, turnaround views and expression studies. |
| `om-style-fusion.jpg` | Crayon fox physically grounded in a photographic cafe scene. |
| `agent-browser.jpg` | Browser search, form and table linked by an automation path and pointer. |

The complete new prompt set is in [generation-prompts.json](generation-prompts.json). Canonical catalog publication assets are mirrored under `config/skill-library/assets/_shared/card-covers/` and referenced by `cardCover` in the catalog. `features/ai-console/new-task-covers.ts` bundles local copies for older library providers and the UI catalog. Cover availability does not change recommendation eligibility.
