import path from "node:path";
import { z } from "zod";

const LocalImageSchema = z.string().min(1).max(8192).refine(value => path.isAbsolute(value), "Use an absolute local image path");
const canvas = {
  width: z.number().int().min(64).max(4096),
  height: z.number().int().min(64).max(4096),
  background: z.string().regex(/^#[a-f\d]{6}$/i).default("#ffffff")
};

/** Input to the isolated image compositor; no URLs, scripts or HTML. */
export const ImageCompositionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fit"), ...canvas, image: LocalImageSchema, fit: z.enum(["contain", "cover"]).default("contain") }).strict(),
  z.object({ kind: z.literal("diptych"), ...canvas, original: LocalImageSchema, illustration: LocalImageSchema, direction: z.enum(["horizontal", "vertical"]).default("horizontal"), gap: z.number().int().min(0).max(128).default(16) }).strict()
]).superRefine((value, context) => {
  if (value.kind === "diptych" && value.gap >= (value.direction === "horizontal" ? value.width : value.height) / 2) {
    context.addIssue({ code: "custom", path: ["gap"], message: "Gap must leave room for both images" });
  }
});
export type ImageComposition = z.infer<typeof ImageCompositionSchema>;
