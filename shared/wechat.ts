import { z } from "zod";

export const WECHAT_TITLE_MAX_LENGTH = 32;
export const WECHAT_AUTHOR_MAX_LENGTH = 16;
export const WECHAT_DIGEST_MAX_LENGTH = 120;
export const WECHAT_COVER_MAX_BYTES = 10 * 1024 * 1024;
export const WECHAT_BODY_IMAGE_MAX_BYTES = 1024 * 1024 - 1;
export const WECHAT_HTML_MAX_LENGTH = 1024 * 1024;

export const WechatAccountInputSchema = z.object({
  appId: z.string().trim().regex(/^wx[A-Za-z0-9]{16}$/, "请输入正确的公众号 AppID。"),
  appSecret: z.string().trim().refine((value) => value === "" || /^[A-Za-z0-9]{32}$/.test(value), "AppSecret 应为 32 位字母或数字。").optional(),
  author: z.string().trim().max(WECHAT_AUTHOR_MAX_LENGTH, "作者最多 16 个字。")
});
export type WechatAccountInput = z.infer<typeof WechatAccountInputSchema>;
export type WechatAccountView = { appId: string; author: string; configured: boolean };
export type WechatCover = { path: string; name: string; previewUrl: string };

export const WechatCopyInputSchema = z.object({
  html: z.string().min(1).max(WECHAT_HTML_MAX_LENGTH),
  text: z.string().max(WECHAT_HTML_MAX_LENGTH)
});
export type WechatCopyInput = z.infer<typeof WechatCopyInputSchema>;

export const WechatDraftInputSchema = z.object({
  projectName: z.string().trim().min(1).max(120),
  outputPath: z.string().min(1).max(4096),
  title: z.string().trim().min(1, "请输入文章标题。").max(WECHAT_TITLE_MAX_LENGTH, "标题最多 32 个字。"),
  html: z.string().min(1).max(WECHAT_HTML_MAX_LENGTH),
  author: z.string().trim().max(WECHAT_AUTHOR_MAX_LENGTH, "作者最多 16 个字。").optional(),
  digest: z.string().trim().max(WECHAT_DIGEST_MAX_LENGTH, "摘要最多 120 个字。").optional(),
  coverPath: z.string().min(1, "请先选择文章封面。").max(4096)
});
export type WechatDraftInput = z.infer<typeof WechatDraftInputSchema>;
export type WechatDraftResult = { mediaId: string };
