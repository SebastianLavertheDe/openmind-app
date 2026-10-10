# OpenMind Desktop

[English](README.md) | 简体中文

OpenMind Desktop 是一个面向信息收集、知识整理和 AI 内容创作的个人工作台。它把 RSS 订阅、本地资料库、AI 摘要和写作项目放在同一个桌面应用里，帮助你把每天读到的内容整理成笔记和文章草稿。

## 项目亮点

- **203 个精选 RSS 源。** 官方 [Skill 库](https://github.com/SebastianLavertheDe/cctools-skills) 包含 122 个普通订阅和 81 个公众号订阅，覆盖 AI、科技、工程等领域。首次安装后即可使用，也可以调整自己的订阅。
- **从阅读到写作。** 把文章保存为 Markdown，生成每日摘要和选题，再用收集的资料撰写草稿、推进创作项目。
- **自由配置 AI。** 使用自己的 AI Provider 完成摘要和写作，也可以连接 Claude Code 或 Codex CLI 开始 AI 会话。
- **通过 Skill 扩展。** 官方库提供 RSS、Reddit、X、知识库编译和写作工作流，也支持从 Git 仓库、ZIP 或本地目录安装更多 Skill。
- **公众号导出。** 预览文章排版、复制富文本，并将草稿推送到已配置的微信公众号。
- **文件由你掌握。** 文章、笔记和草稿保存在自己选择的本地文件夹中，Markdown 文件也可以用其他编辑器打开和修改。

## 如何使用

桌面分发目标是 Windows 11 和 macOS；Linux 可用于开发和测试。

### 首次启动

1. **选择数据目录。** 选择保存 OpenMind 内容和个人配置的文件夹。
2. **安装官方 Skill。** 在首启引导中点击 **安装 RSS 源**，应用会安装 [cctools-skills](https://github.com/SebastianLavertheDe/cctools-skills)，提供 RSS 采集能力和默认订阅。安装需要联网，这一步完成后才能进入工作台。
3. **配置 AI。** 在 **设置 → AI 与模型** 中添加 AI Provider，填写 Base URL、API Key 和文本模型，并选择默认 Provider。使用 AI 会话时，还需要安装或连接 Claude Code / Codex CLI，并按应用提示完成连接配置。首启时也可以选择 **稍后配置**，需要 AI 功能时再补充。
4. **开始采集和创作。** 在设置中调整订阅，在技能中心运行 RSS 采集或 RSS 到摘要工作流，再到资料库阅读结果，并用于写作项目。

AI 功能会向你配置的 Provider 发送请求。请使用自己的凭据，并将数据目录和 Provider 配置保留为私人数据。

### 从源码启动

准备 **Node.js 22.12+**、**Git** 和 **uv**，然后运行：

```bash
git clone https://github.com/SebastianLavertheDe/openmind-app.git
cd openmind-app
npm ci
npm run prepare:python-runtime
npm run dev:electron
```

运行时准备步骤会下载 Skill 使用的 Python 运行时。应用打开后，按上面的首次启动流程完成设置。

开发约定见 [AGENTS.md](AGENTS.md)。更多说明：[AI 工作台](docs/AI_WORKSPACE.md)、[公众号导出](docs/wechat-export.md)、[支持与恢复](docs/SUPPORT_AND_RECOVERY.md)。

## TODO

- [ ] **完善视频工作流：** 串联视频导入、下载、转写、摘要和写作素材，让整个流程可以在桌面端完成。
- [ ] **扩展内容来源与 Skill：** 持续维护默认 RSS 源，增加更多采集和写作工作流。
- [ ] **简化首次配置：** 改善 Skill 和运行时安装、离线使用以及下载中断后的恢复体验。
- [ ] **完善桌面分发：** 持续改善 Windows/macOS 打包、兼容性和日常使用体验。
