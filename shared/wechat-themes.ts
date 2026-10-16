import { messages } from "./messages";

export interface WechatTheme {
  id: string;
  name: string;
  description: string;
  accentColor: string;
}

export type WechatStyleSlot = "article" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" |
  "paragraph" | "quote" | "strong" | "emphasis" | "deleted" | "link" | "list" | "item" |
  "code" | "pre" | "image" | "table" | "th" | "td" | "rule" | "footnote";

export interface WechatThemeContext { accentColor: string; fontSize: number }
export interface WechatThemeDefinition extends WechatTheme {
  styles: (context: WechatThemeContext) => Partial<Record<WechatStyleSlot, string>>;
}

const serif = 'Georgia,"Noto Serif SC","Songti SC",SimSun,serif';

/** Source-owned registry: adding a theme does not change the Markdown renderer. */
export const WECHAT_THEME_DEFINITIONS: readonly WechatThemeDefinition[] = [
  {
    id: "pure", get name() { return messages.wechatExport.themes.pure.name; }, get description() { return messages.wechatExport.themes.pure.description; }, accentColor: "#27835c",
    styles: () => ({})
  },
  {
    id: "elegant", get name() { return messages.wechatExport.themes.elegant.name; }, get description() { return messages.wechatExport.themes.elegant.description; }, accentColor: "#477b6a",
    styles: ({ accentColor }) => ({
      h1: `font-family:${serif};text-align:center;letter-spacing:2px;border-bottom:1px solid ${accentColor};padding-bottom:20px;`,
      h2: `font-family:${serif};text-align:center;color:${accentColor};padding:12px 0;border-top:1px solid ${accentColor};border-bottom:1px solid ${accentColor};`,
      paragraph: "line-height:2.1;letter-spacing:0.8px;",
      quote: `font-family:${serif};font-style:italic;background:#f7f9f7;border-left:2px solid ${accentColor};padding:16px 20px;`
    })
  },
  {
    id: "magazine", get name() { return messages.wechatExport.themes.magazine.name; }, get description() { return messages.wechatExport.themes.magazine.description; }, accentColor: "#a34235",
    styles: ({ accentColor }) => ({
      h1: `font-family:${serif};font-size:2em;line-height:1.4;border-top:5px solid ${accentColor};padding-top:20px;`,
      h2: `font-family:${serif};font-size:1.55em;border-bottom:2px solid ${accentColor};padding-bottom:10px;`,
      h3: `color:${accentColor};letter-spacing:1px;`,
      quote: `border-left:4px solid ${accentColor};background:#faf7f3;padding:16px 20px;`,
      rule: `border:0;border-top:2px solid ${accentColor};margin:32px 0;`
    })
  },
  {
    id: "digest", get name() { return messages.wechatExport.themes.digest.name; }, get description() { return messages.wechatExport.themes.digest.description; }, accentColor: "#386ba3",
    styles: ({ accentColor }) => ({
      article: "line-height:1.75;letter-spacing:0;",
      h1: "font-size:1.6em;margin-bottom:20px;",
      h2: `border-left:4px solid ${accentColor};background:#f3f5f7;padding:8px 12px;font-size:1.15em;margin:24px 0 12px;`,
      h3: `font-size:1em;color:${accentColor};margin:18px 0 8px;`,
      paragraph: "margin:0 0 12px;line-height:1.75;",
      item: "margin:5px 0;",
      quote: `border-left:3px solid ${accentColor};padding:10px 14px;background:#f3f5f7;`
    })
  }
];

export const WECHAT_THEMES: readonly WechatTheme[] = WECHAT_THEME_DEFINITIONS.map(theme => ({
  id: theme.id,
  accentColor: theme.accentColor,
  get name() { return theme.name; },
  get description() { return theme.description; }
}));

export function createWechatStyles(theme: WechatThemeDefinition, context: WechatThemeContext): Record<WechatStyleSlot, string> {
  const { accentColor, fontSize } = context;
  const heading = "font-weight:700;line-height:1.5;color:#242424;word-break:break-word;";
  const styles: Record<WechatStyleSlot, string> = {
    article: `box-sizing:border-box;padding:12px 8px;color:#333333;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:${fontSize}px;line-height:1.9;letter-spacing:0.4px;word-wrap:break-word;`,
    h1: `${heading}font-size:1.7em;margin:20px 0 28px;`,
    h2: `${heading}font-size:1.35em;margin:28px 0 16px;`,
    h3: `${heading}font-size:1.15em;margin:24px 0 12px;color:${accentColor};`,
    h4: `${heading}font-size:1.05em;margin:20px 0 10px;`,
    h5: `${heading}font-size:1em;margin:18px 0 8px;`,
    h6: `${heading}font-size:1em;margin:18px 0 8px;color:#666666;`,
    paragraph: "margin:0 0 18px;line-height:1.9;",
    quote: `margin:20px 0;padding:12px 16px;border-left:3px solid ${accentColor};background:#f7f8f9;color:#555555;`,
    strong: `font-weight:700;color:${accentColor};`,
    emphasis: "font-style:italic;",
    deleted: "text-decoration:line-through;color:#777777;",
    link: `color:${accentColor};text-decoration:underline;word-break:break-word;`,
    list: "margin:12px 0 20px;padding-left:26px;",
    item: "margin:8px 0;line-height:1.8;",
    code: `font-family:Menlo,Consolas,monospace;font-size:0.88em;color:${accentColor};background:#f3f4f5;padding:2px 4px;border-radius:3px;white-space:pre-wrap;`,
    pre: "margin:20px 0;padding:16px;background:#f5f6f7;border:1px solid #e6e8eb;border-radius:6px;font-family:Menlo,Consolas,monospace;font-size:0.85em;line-height:1.65;color:#333333;white-space:pre-wrap;word-break:break-all;overflow-wrap:anywhere;",
    image: "display:block;max-width:100%;height:auto;margin:18px auto;border-radius:4px;",
    table: "border-collapse:collapse;width:100%;margin:20px 0;font-size:0.9em;table-layout:fixed;word-break:break-word;",
    th: `border:1px solid #dce1e5;padding:9px 10px;background:#f3f5f7;color:${accentColor};font-weight:700;`,
    td: "border:1px solid #dce1e5;padding:9px 10px;",
    rule: "border:0;border-top:1px solid #e2e5e8;margin:28px 0;",
    footnote: "font-size:0.85em;color:#666666;line-height:1.7;"
  };
  for (const [slot, value] of Object.entries(theme.styles(context))) styles[slot as WechatStyleSlot] += value;
  return styles;
}
