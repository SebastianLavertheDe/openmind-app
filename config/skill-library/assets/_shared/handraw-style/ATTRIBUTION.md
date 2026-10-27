# handraw-style adaptations

Original author: **yang0**
Original repository: https://github.com/yang0/handraw-style
Reviewed source revision: `f7c39649fe70a667069fdbe5eb60df0a1bca4f24`

Adaptation: **OpenMind**. These are application-owned workflows, not upstream releases or an endorsement by the original author. The card nickname and GitHub profile avatar credit the source author.

License: see the bundled `LICENSE.handraw-style` (source copy: `LICENSE`). The upstream license is titled “MIT License (with Attribution Requirement)”; preserve its full notice and the author/repository credit when redistributing these adaptations.

## Profile avatar provenance

- Account: [yang0](https://github.com/yang0), GitHub user ID `3478629`.
- Identity and avatar URL obtained from `https://api.github.com/users/yang0` on 2026-10-27.
- Image: `https://avatars.githubusercontent.com/u/3478629?v=4&s=128`.
- Local asset: `avatars/yang0.jpg`, 128 × 128 JPEG, 3416 bytes; the GitHub-served thumbnail is retained unchanged.
- Imported at the user's request for contributor attribution. This profile image is separate from the repository's code license; no additional image license or author endorsement is implied.
- The application displays the bundled local copy and does not fetch or track the profile at runtime.

## Source map

| App card | Upstream material |
| --- | --- |
| `om-article-cover` | [skills/article-cover-designer/SKILL.md](https://github.com/yang0/handraw-style/blob/f7c39649fe70a667069fdbe5eb60df0a1bca4f24/skills/article-cover-designer/SKILL.md) |
| `om-article-illustrator` | [skills/article-illustration-planner/SKILL.md](https://github.com/yang0/handraw-style/blob/f7c39649fe70a667069fdbe5eb60df0a1bca4f24/skills/article-illustration-planner/SKILL.md) |
| `om-social-cards` | [skills/handdraw-style-prompter/SKILL.md](https://github.com/yang0/handraw-style/blob/f7c39649fe70a667069fdbe5eb60df0a1bca4f24/skills/handdraw-style-prompter/SKILL.md), [skills/handdraw-style-prompter/references/layouts/SC-001.md](https://github.com/yang0/handraw-style/blob/f7c39649fe70a667069fdbe5eb60df0a1bca4f24/skills/handdraw-style-prompter/references/layouts/SC-001.md), [skills/handdraw-style-prompter/references/layouts/SC-010.md](https://github.com/yang0/handraw-style/blob/f7c39649fe70a667069fdbe5eb60df0a1bca4f24/skills/handdraw-style-prompter/references/layouts/SC-010.md) |
| `om-knowledge-infographic` | [skills/handdraw-style-prompter/SKILL.md](https://github.com/yang0/handraw-style/blob/f7c39649fe70a667069fdbe5eb60df0a1bca4f24/skills/handdraw-style-prompter/SKILL.md), [skills/handdraw-style-prompter/references/layouts/IG-008.md](https://github.com/yang0/handraw-style/blob/f7c39649fe70a667069fdbe5eb60df0a1bca4f24/skills/handdraw-style-prompter/references/layouts/IG-008.md) |
| `om-poster-maker` | [skills/poster-prompt-generator/SKILL.md](https://github.com/yang0/handraw-style/blob/f7c39649fe70a667069fdbe5eb60df0a1bca4f24/skills/poster-prompt-generator/SKILL.md) |
| `om-four-panel-comic` | [skills/handdraw-style-prompter/references/layouts/SB-002.md](https://github.com/yang0/handraw-style/blob/f7c39649fe70a667069fdbe5eb60df0a1bca4f24/skills/handdraw-style-prompter/references/layouts/SB-002.md) |
| `om-photo-diptych` | [skills/handdraw-style-prompter/references/layouts/SC-021.md](https://github.com/yang0/handraw-style/blob/f7c39649fe70a667069fdbe5eb60df0a1bca4f24/skills/handdraw-style-prompter/references/layouts/SC-021.md) |
| `om-product-highlights` | [skills/handdraw-style-prompter/references/layouts/EC-005.md](https://github.com/yang0/handraw-style/blob/f7c39649fe70a667069fdbe5eb60df0a1bca4f24/skills/handdraw-style-prompter/references/layouts/EC-005.md), [skills/handdraw-style-prompter/references/layouts/EC-001.md](https://github.com/yang0/handraw-style/blob/f7c39649fe70a667069fdbe5eb60df0a1bca4f24/skills/handdraw-style-prompter/references/layouts/EC-001.md), [skills/handdraw-style-prompter/references/layouts/EC-009.md](https://github.com/yang0/handraw-style/blob/f7c39649fe70a667069fdbe5eb60df0a1bca4f24/skills/handdraw-style-prompter/references/layouts/EC-009.md) |
| `om-brand-character` | [skills/ip-designer/SKILL.md](https://github.com/yang0/handraw-style/blob/f7c39649fe70a667069fdbe5eb60df0a1bca4f24/skills/ip-designer/SKILL.md) |
| `om-style-fusion` | [skills/style-fusion-prompter/SKILL.md](https://github.com/yang0/handraw-style/blob/f7c39649fe70a667069fdbe5eb60df0a1bca4f24/skills/style-fusion-prompter/SKILL.md) |

## What changed

- Direct image delivery through the user-selected OpenMind image provider instead of prompt-only defaults or a fixed provider/model.
- A curated, offline text reference set; no copied upstream Skill tree, reference-image collection, community sharing hooks or import/deployment tools.
- Article originals are preserved. Multi-page tasks generate each page separately and carry a visual reference forward.
- Exact dimensions and photo comparisons use the application’s deterministic compositor in a temporary profile; the source photo is never regenerated for the original panel.
- Styles are described by visual materials and traits. Included upstream style IDs are a selected subset; missing IDs are not silently mapped to unrelated styles.
- Palette presets are OpenMind additions. Layout guidance is condensed/adapted; it does not assert current platform publishing requirements.
