# 项目成品导出微信公众号

项目 Markdown 成品可以选择公众号排版并复制富文本，或使用配置好的公众号凭据创建草稿。复制不需要 AppID / AppSecret；直接推送需要账号具有相应接口权限。推送只创建草稿，不发布文章。当前标题上限 32 字、作者上限 16 字、摘要上限 120 字；正文排版后须少于 20,000 字符且小于 1 MB。

入口：打开项目成品，在编辑栏右上角「更多 → 导出到微信公众号」选择主题；「复制排版」复制 HTML 和纯文本两种剪贴板格式。「发送到草稿箱」打开文章标题、封面、作者、摘要设置，再次点击发送创建草稿。账号可在「设置 → 连接器 → 微信公众号」配置，也可在导出弹窗内配置。打开弹窗时会使用编辑器当前内容，包括尚未自动保存的修改；导出本身不会改变原文。

AppSecret 经系统安全存储加密后保存在 Electron `userData/credentials/wechat-account.bin`，不会返回 renderer。系统安全存储不可用时拒绝明文降级。配置保存成功不表示已验证微信接口；验证发生在首次推送。凭据无法读取时，可在连接器中确认移除旧配置后重新填写。

## 排版与扩展

`shared/wechat-format.ts` 暴露同步接口：

```ts
import { WECHAT_THEMES, renderWechatArticle } from "./shared/wechat-format";

const article = renderWechatArticle(markdown, {
  themeId: "pure",
  accentColor: "#27835c",
  fontSize: 16,
});
// article.html: 自带行内样式的安全 HTML fragment
// article.text: 剪贴板纯文本 fallback
// article.warnings: 当前内容的兼容性提示
```

初始四种风格是归真（pure）、雅致（elegant）、杂志（magazine）、简报（digest）。主题注册表独立放在 `shared/wechat-themes.ts`。新增风格只需添加 `WechatThemeDefinition`，提供唯一 ID、名称、说明、默认主题色和 `styles(context)`。样式按 article、h1–h6、paragraph、quote、table 等语义槽覆盖；无需修改 Markdown AST 渲染逻辑，也无需添加 UI 分支。新增主题应加入主题覆盖测试。

主题是应用源码，不从用户 Markdown 中读 CSS。颜色仅接受六位十六进制颜色，字号限定在 12–24 px。使用行内样式，不依赖 class、CSS 变量、外部字体、脚本、伪元素或运行时 CSS。标题可由调用方作为一级 Markdown 标题放入正文；草稿标题是独立 metadata，不由渲染器猜测。

排版设计参考了以下开源项目的主题分层与微信兼容处理思路，本项目四种样式为独立编写，没有复制第三方主题 CSS：

- [doocs/md](https://github.com/doocs/md)：[grace](https://github.com/doocs/md/blob/main/packages/shared/src/configs/theme-css/grace.css)、[simple](https://github.com/doocs/md/blob/main/packages/shared/src/configs/theme-css/simple.css) 展示标题、引用、表格、代码的语义分层；项目许可证为 [WTFPL](https://github.com/doocs/md/blob/main/LICENSE)。
- [nicejade/markdown-online-editor](https://github.com/nicejade/markdown-online-editor)：[主题注册表](https://github.com/nicejade/markdown-online-editor/blob/master/src/config/themes.js) 将主题元数据与 UI 分离；项目许可证为 [MIT](https://github.com/nicejade/markdown-online-editor/blob/master/LICENSE)。

日后如引入第三方实际源码或 CSS，应保留该文件的作者、来源与许可要求；不能将本次原创实现的许可结论推广到后续复制的代码。

## 内容与安全边界

- 支持标题、段落、粗体、斜体、删除线、列表、任务列表、引用、代码、GFM 表格、图片、链接与脚注。
- 仅遍历 Markdown AST 生成允许的元素，忽略原始 HTML。图片与链接会过滤危险协议；文本、属性均转义。预览还应使用无脚本权限的隔离 iframe。
- 本地图片仅保留相对路径供主进程校验并上传，路径解析必须相对于当前成品并限制在所属项目内；不能直接读取任意文件系统路径。相对路径的本地图片不在当前预览中显示。排版预览支持 PNG/JPEG/GIF/WebP 的内嵌图片；SVG、file URL 和绝对文件路径不进入 HTML。
- 发送草稿仅支持 JPG/PNG：正文单图小于 1 MB、最多 50 张，封面不超过 10 MB。GIF/WebP 可用于复制排版，发送前需转换为 JPG/PNG；识别到这些格式时会提前提示。
- 复制本地和内嵌图片不能保证在微信编辑器中保留，请在微信中重新插入图片。网络图片也可能因源站限制失效，复制后应检查。
- 外部链接可能受微信账号权限或编辑器限制。表格与长代码在窄屏上的效果应在微信内确认。
- Mermaid 暂时保留为代码，公式保留为 LaTeX 文本并显示提示；若要图形效果，需要替换为图片。
- 导出包含完整文章，UI 必须读取完整文件，不能把成品列表或预览的截断摘要当作正文。

## 有真实账号后联调

自动化测试使用临时目录与模拟 HTTP，不接触个人数据或真实公众号。没有真实 AppID / AppSecret 时，不能认为公众号端联调已通过。

1. 在公众号后台确认账号具有草稿与素材相关接口权限，将运行 OpenMind 的电脑实际出口公网 IP 加入微信接口白名单。桌面程序直连微信，不使用截图示例中的第三方服务器 IP。
2. 配置测试公众号的 AppID、AppSecret 和可选作者，确认凭据保存在 Electron `userData`，不出现在内容仓库、源码、日志、renderer 返回值或错误提示中。
3. 准备含封面、正文图片、中文、引用、表格、代码的 Markdown。分别预览四种主题，复制到微信编辑器，核对标题层级、缩进、链接、换行、图片与字体。
4. 选择有效封面，推送至草稿箱。在公众号后台核对文章标题、作者、摘要、封面、正文图片、排版，以及返回的草稿素材 ID。确认没有自动发表或群发。
5. 分别验证相对路径图片、网络图片、重复图片、含空格的图片名，以及图片超限 / 类型不支持 / 丢失文件等错误反馈。
6. 验证错误 AppSecret、IP 不在白名单、接口权限不足、token 失效、断网、超时与微信业务错误。创建草稿的结果不明确时先检查公众号草稿箱，避免手动重复创建。
7. 验证更新 / 清除凭据、关闭重开应用，以及无凭据时的复制功能。确认推送过程中不能重复点击，失败后可以修正配置重新尝试。

微信公众号开放平台接口及编辑器可能调整；真实账号端的最终排版和接口权限需以上述联调为准。

接口参数参考微信官方[新增草稿文档](https://developers.weixin.qq.com/doc/service/api/draftbox/draftmanage/api_draft_add)。

## 本地验证

```bash
npm run typecheck
npx vitest run shared/wechat-format.test.ts electron/wechat renderer/src/features/wechat electron/ipc-handlers.test.ts renderer/src/features/projects/ProjectPanels.test.tsx renderer/src/features/settings/SettingsPage.test.tsx renderer/src/browser-api.test.ts
node scripts/wechat-export-smoke.js
```

Electron smoke 使用独立临时 `userData` 和模拟接口，禁止网络访问；验证应用 CSP 下的沙箱预览、富文本复制调用、草稿表单以及桌面/窄窗口/深色模式布局，截图写入 `.build/wechat-export-smoke/`。它不替代实际粘贴到微信编辑器和真实公众号接口联调。
