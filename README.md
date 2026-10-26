# OpenMind Desktop

English | [简体中文](README.zh-CN.md)

OpenMind Desktop is a personal workspace for collecting information, organizing knowledge, and creating content with AI. It brings RSS subscriptions, a local reading library, AI summaries, and writing projects together, helping you turn daily reading into notes and drafts.

## Highlights

- **203 curated RSS feeds.** The official [Skill library](https://github.com/SebastianLavertheDe/cctools-skills) includes 122 general feeds and 81 WeChat Official Account feeds, covering AI, technology, engineering, and more. Enable default Skills in Settings and customize your subscriptions.
- **Add your own materials.** Import web URLs, PDF files, and YouTube video links into your projects, and keep them together as sources for reading and writing.
- **From reading to writing.** Collect articles as Markdown, generate daily summaries and topic ideas, and use your reading materials to develop drafts and projects.
- **Your choice of AI.** Configure your own AI Provider for summaries and writing, and connect Claude Code or Codex CLI for AI conversations.
- **Extend with Skills.** Use RSS, Reddit, X, knowledge compilation, and writing workflows from the official library, or install additional Skills from Git repositories, ZIP files, or local folders.
- **WeChat export.** Preview article layouts, copy rich text, and send drafts to your configured WeChat Official Account.
- **Files you control.** Keep collected articles, notes, and drafts in a local folder you choose, with Markdown files you can read and edit outside the app.

## Workspace preview

**Daily briefs and AI conversations.** Browse daily summaries and discuss what you are reading with AI alongside the document.

![Daily brief with the file list, summary preview, and AI conversation](docs/screenshots/daily-brief.png)

<details>
<summary>Project sources — collect materials for reading and writing</summary>

Keep project materials together and preview YouTube sources alongside the AI workspace. The example below shows a video without available platform subtitles.

![Project file list and YouTube preview alongside the AI workspace](docs/screenshots/project-sources.png)

</details>

<details>
<summary>Automation — schedule workflows and inspect their runs</summary>

Configure recurring collection and summary workflows, run them manually, and inspect status and execution logs. The example below includes a failed run to show how errors are surfaced.

![Automation rules, schedule settings, and execution logs](docs/screenshots/automation.png)

</details>

## Getting started

Desktop builds target Windows 11 and macOS. Linux is available for development and testing.

### First launch

1. **Choose a data folder.** Select a folder for your OpenMind content and personal configuration.
2. **Configure AI (optional).** In **Settings → AI & Models**, add an AI Provider, enter its Base URL, API key, and text model, and select a default provider. For AI conversations, also install or connect Claude Code or Codex CLI and complete the connection setup shown in the app. You can choose **Set up later** during onboarding and configure AI when you need it.
3. **Enable default Skills when needed.** Startup does not require or check for the official Skill library. In **Settings → Skills**, turn on **Default Skills and built-in schedules** to install [cctools-skills](https://github.com/SebastianLavertheDe/cctools-skills) and enable RSS, X, Reddit, and daily topic jobs. This switch starts off on new installations; installation requires an internet connection. Turning it off stops these jobs and removes the official Skills, preserving generated content, personal settings, other Skill sources, and custom schedules.
4. **Start collecting and creating.** Customize subscriptions in Settings, run RSS collection or the RSS-to-summary workflow in Skill Center, read the results in your library, and use them in writing projects.

AI features send requests to the provider you configure. Use your own credentials and keep your data folder and provider configuration private.

<details>
<summary>Settings preview — appearance and local data folder</summary>

In **Settings → General**, adjust the theme, display density, and text size, and choose your OpenMind data folder.

![General settings for appearance, text size, and the local data folder](docs/screenshots/settings.png)

</details>

### Run from source

Install **Node.js 22.12+**, **Git**, and **uv**, then run:

```bash
git clone https://github.com/SebastianLavertheDe/openmind-app.git
git clone https://github.com/SebastianLavertheDe/cctools-skills.git
cd openmind-app
npm ci
npm run prepare:python-runtime
npm run dev:electron
```

The runtime preparation step downloads the Python runtime used by Skills. After the app opens, follow the same first-launch setup above.

The scene Skill library is built from the separate sibling `cctools-skills` checkout (the 12 `om-*` packages). For a different location, set `OPENMIND_SKILLS_REPO_ROOT` to its absolute path. Both `build` and `dev:electron` validate and copy only those packages into ignored build output; packaging includes that bundle. Keep the two repositories on compatible revisions. The bundle records each package digest, its source commit and whether that checkout contained uncommitted changes.

Development conventions: [AGENTS.md](AGENTS.md). More details: [AI workspace](docs/AI_WORKSPACE.md), [WeChat export](docs/wechat-export.md), and [support and recovery](docs/SUPPORT_AND_RECOVERY.md).

## License

OpenMind Desktop is source-available under the [OpenMind Desktop Community License 1.0](LICENSE).

- Personal use, internal business use and modification, and commercial content creation are permitted without license fees. You may sell articles, reports, videos, and other permitted Content you create with the app.
- Noncommercial redistribution of the original app or a modified version is permitted if you include the license, retain applicable notices, and identify modifications.
- Selling or commercially distributing the app, including it or its code in a commercial software product, or providing its functionality to outside users as a commercial hosted service requires a separate written commercial license. Advertising-supported access is included in this restriction.
- The license imposes no revenue share, watermark, attribution, or source-disclosure requirement on your Content. Third-party materials and external Skills remain subject to their own applicable terms.

This is a source-available community license with commercial restrictions, rather than an OSI-approved open-source license. The English text in `LICENSE` is authoritative. Contact the [repository maintainer](https://github.com/SebastianLavertheDe/openmind-app) for commercial licensing.

## TODO

- [ ] **Improve the video workflow:** refine downloading, transcription, summaries, and integration with writing projects.
- [ ] **Expand content sources and Skills:** maintain the RSS starter list and add more collection and writing workflows.
- [ ] **Simplify setup:** improve Skill and runtime installation, offline use, and recovery from interrupted downloads.
- [ ] **Improve desktop delivery:** continue improving Windows/macOS packaging, compatibility, and everyday usability.
