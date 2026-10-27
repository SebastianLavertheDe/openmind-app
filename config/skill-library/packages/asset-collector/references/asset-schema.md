# Asset Manifest Schema

`assets/manifest.json` contains:

```json
{
  "package_dir": "...",
  "generated_at": "...",
  "input_files": ["topic-brief.md", "wechat-draft.md"],
  "assets": [],
  "missing_assets": []
}
```

Each asset entry:

```json
{
  "id": "asset_001",
  "file": "",
  "type": "source_screenshot",
  "source_url": "",
  "source_file": "",
  "caption": "",
  "usage": "",
  "copyright_risk": "low|medium|unknown",
  "fact_supported": true,
  "status": "reference_found|manual_required|existing_file",
  "manual_action": ""
}
```

Types:

- `source_screenshot`: source page or official article screenshot.
- `post_screenshot`: X/Twitter, Reddit, or social post screenshot.
- `data_screenshot`: chart, number, benchmark, or table evidence.
- `generated_card`: designed card, cover, comparison card, or explainer visual.
- `local_extract`: local markdown/html/json source extract.
- `image_url`: existing image URL found in the draft/source.
- `unknown_asset`: needs manual classification.

Missing asset entry:

```json
{
  "id": "missing_001",
  "source_asset_id": "asset_001",
  "reason": "needs_screenshot|missing_source|needs_generated_visual",
  "manual_action": "..."
}
```
