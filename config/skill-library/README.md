# 应用技能库配置

这里维护 App「探索」页面中的技能，与从 GitHub 导入的 `cctools-skills` 是两个独立来源。
`catalog.json` 包含技能清单、执行指令及中英文展示信息；App 构建不读取外部技能仓库。

## 添加技能

在 `catalog.json` 的 `skills` 数组中添加一条配置即可，例如：

```json
{
  "id": "om-weekly-report",
  "category": "writing",
  "instructions": [
    "根据用户提供的工作记录，整理本周完成事项、待解决问题和下周计划。",
    "保留事实和关键数据，缺少依据时说明，不编造完成进度。"
  ],
  "display": {
    "zh-CN": {
      "title": "周报生成",
      "subtitle": "把工作记录整理成周报",
      "description": "生成包含完成事项、问题和下周计划的完整周报。",
      "inputHint": "提供本周工作记录"
    },
    "en": {
      "title": "Weekly report",
      "subtitle": "Turn work notes into a weekly report",
      "inputHint": "Provide this week's work notes"
    }
  }
}
```

运行 `npm run prepare:skill-library` 后重新进入技能页。无需修改 TypeScript、翻译模块，
也无需在 `cctools-skills` 添加目录。`build` 和 `dev:electron` 自动执行准备步骤。

## 可选辅助文件

需要脚本或模板时，把文件放到 `assets/<技能ID>/`，在技能条目的 `files` 中声明相对路径：

```json
{
  "files": ["scripts/create_deck.py"],
  "requirement": "python"
}
```

构建时只包含明确声明的文件，保持包内相对路径。禁止路径越界，也不能覆盖构建生成的
`SKILL.md`、包 manifest 和技能库元信息。用户内容、运行结果和凭据不属于这里。

## 字段约定

- 顶层 `schemaVersion` 当前为 `1`；`executionRules` 为所有应用技能共用的执行规则。
- `skills` 的数组顺序决定默认展示顺序。
- `id`：唯一标识，以小写字母开头，可包含小写字母、数字、`-`、`_`、`.`。
- `version`：默认 `1.0.0`，使用三段数字版本号。
- `instructions`：必填的指令段落数组；构建时生成 `SKILL.md`。
- `category`：`research`、`writing`、`image`、`slides`、`video`、`web`，同时决定封面图标。
- `requirement`：可省略；可选 `image`、`python`、`ffmpeg`，`ffmpeg` 同时要求 Python。
- `display`：支持 `zh-CN`、`en`，至少提供一种。优先使用当前界面语言，缺失时回退到已有语言。
- `title` 必填；`subtitle`、`inputHint` 默认空文本；`description` 省略时使用副标题。
- `files`：可选辅助文件列表，不会扫描或复制外部技能仓库。

## 分发与来源隔离

构建输出 `.build/skill-library/`，包括配置、自动生成的技能包和包摘要清单。
发布时它们位于安装包的 `resources/skill-library/`。已分发客户端需更新应用资源或安装包。
维护者可用 `OPENMIND_SKILL_LIBRARY_BUNDLE` 指定同样结构的完整资源目录。

应用技能的安装记录为 `sourceType: builtin`、发布者 `openmind-library`；GitHub 导入保持
`sourceType: git` 和实际仓库地址。两者共用执行机制和安装存储，但清单、来源、更新及默认技能
开关相互独立。GitHub 包即使使用相同 ID，也不会被认作应用技能或被其安装操作覆盖。

只有早期从 App 自带资源安装、且有绑定记录的旧包，才允许在明确重新安装时迁移发布者；
不会迁移或删除用户从 GitHub 导入的包。关闭 `cctools-skills` 默认技能不影响应用技能。

运行时重新读取配置；新增条目不会自动安装，仍由用户点击使用。移出清单的已安装技能
保留在「我的」，不再出现在「探索」。
