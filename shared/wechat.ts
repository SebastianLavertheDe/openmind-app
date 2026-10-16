import { z } from "zod";
import { messages } from "./messages";

export const WECHAT_TITLE_MAX_LENGTH = 32;
export const WECHAT_AUTHOR_MAX_LENGTH = 16;
export const WECHAT_DIGEST_MAX_LENGTH = 120;
export const WECHAT_COVER_MAX_BYTES = 10 * 1024 * 1024;
export const WECHAT_BODY_IMAGE_MAX_BYTES = 1024 * 1024 - 1;
export const WECHAT_HTML_MAX_LENGTH = 1024 * 1024;

export const WechatAccountInputSchema = z.object({
  appId: z.string().trim().regex(/^wx[A-Za-z0-9]{16}$/, { error: () => messages.wechatExport.validation.appId }),
  appSecret: z.string().trim().refine((value) => value === "" || /^[A-Za-z0-9]{32}$/.test(value), { error: () => messages.wechatExport.validation.appSecret }).optional(),
  author: z.string().trim().max(WECHAT_AUTHOR_MAX_LENGTH, { error: () => messages.wechatExport.validation.author(WECHAT_AUTHOR_MAX_LENGTH) })
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
  title: z.string().trim().min(1, { error: () => messages.wechatExport.validation.titleRequired }).max(WECHAT_TITLE_MAX_LENGTH, { error: () => messages.wechatExport.validation.title(WECHAT_TITLE_MAX_LENGTH) }),
  html: z.string().min(1).max(WECHAT_HTML_MAX_LENGTH),
  author: z.string().trim().max(WECHAT_AUTHOR_MAX_LENGTH, { error: () => messages.wechatExport.validation.author(WECHAT_AUTHOR_MAX_LENGTH) }).optional(),
  digest: z.string().trim().max(WECHAT_DIGEST_MAX_LENGTH, { error: () => messages.wechatExport.validation.digest(WECHAT_DIGEST_MAX_LENGTH) }).optional(),
  coverPath: z.string().min(1, { error: () => messages.wechatExport.validation.coverRequired }).max(4096)
});
export type WechatDraftInput = z.infer<typeof WechatDraftInputSchema>;
export type WechatDraftResult = { mediaId: string };
