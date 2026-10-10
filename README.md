# OpenMind Desktop

English | [简体中文](README.zh-CN.md)

OpenMind Desktop is a personal workspace for collecting information, organizing knowledge, and creating content with AI. It brings RSS subscriptions, a local reading library, AI summaries, and writing projects together, helping you turn daily reading into notes and drafts.

## Highlights

- **203 curated RSS feeds.** The official [Skill library](https://github.com/SebastianLavertheDe/cctools-skills) includes 122 general feeds and 81 WeChat Official Account feeds, covering AI, technology, engineering, and more. Install it during setup and customize your subscriptions.
- **Add your own materials.** Import web URLs, PDF files, and YouTube video links into your projects, and keep them together as sources for reading and writing.
- **From reading to writing.** Collect articles as Markdown, generate daily summaries and topic ideas, and use your reading materials to develop drafts and projects.
- **Your choice of AI.** Configure your own AI Provider for summaries and writing, and connect Claude Code or Codex CLI for AI conversations.
- **Extend with Skills.** Use RSS, Reddit, X, knowledge compilation, and writing workflows from the official library, or install additional Skills from Git repositories, ZIP files, or local folders.
- **WeChat export.** Preview article layouts, copy rich text, and send drafts to your configured WeChat Official Account.
- **Files you control.** Keep collected articles, notes, and drafts in a local folder you choose, with Markdown files you can read and edit outside the app.

## Getting started

Desktop builds target Windows 11 and macOS. Linux is available for development and testing.

### First launch

1. **Choose a data folder.** Select a folder for your OpenMind content and personal configuration.
2. **Install the official Skills.** Click **Install RSS sources** in the setup wizard. The app installs [cctools-skills](https://github.com/SebastianLavertheDe/cctools-skills), which provides RSS collection and the starter feed list. An internet connection is needed for installation; this step is required before entering the workspace.
3. **Configure AI.** In **Settings → AI & Models**, add an AI Provider, enter its Base URL, API key, and text model, and select a default provider. For AI conversations, also install or connect Claude Code or Codex CLI and complete the connection setup shown in the app. You can choose **Set up later** during onboarding and configure AI when you need it.
4. **Start collecting and creating.** Customize subscriptions in Settings, run RSS collection or the RSS-to-summary workflow in Skill Center, read the results in your library, and use them in writing projects.

AI features send requests to the provider you configure. Use your own credentials and keep your data folder and provider configuration private.

### Run from source

Install **Node.js 22.12+**, **Git**, and **uv**, then run:

```bash
git clone https://github.com/SebastianLavertheDe/openmind-app.git
cd openmind-app
npm ci
npm run prepare:python-runtime
npm run dev:electron
```

The runtime preparation step downloads the Python runtime used by Skills. After the app opens, follow the same first-launch setup above.

Development conventions: [AGENTS.md](AGENTS.md). More details: [AI workspace](docs/AI_WORKSPACE.md), [WeChat export](docs/wechat-export.md), and [support and recovery](docs/SUPPORT_AND_RECOVERY.md).

## TODO

- [ ] **Improve the video workflow:** refine downloading, transcription, summaries, and integration with writing projects.
- [ ] **Expand content sources and Skills:** maintain the RSS starter list and add more collection and writing workflows.
- [ ] **Simplify setup:** improve Skill and runtime installation, offline use, and recovery from interrupted downloads.
- [ ] **Improve desktop delivery:** continue improving Windows/macOS packaging, compatibility, and everyday usability.
