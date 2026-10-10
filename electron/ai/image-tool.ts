import { z } from "zod";
import { GenerateImageInputSchema, IMAGE_TOOL_DESCRIPTION, IMAGE_TOOL_NAME } from "../../shared/image-generation";
import { ImageConfigurationStore } from "../images/image-configuration";
import { ImageGenerationService } from "../images/image-generation";
import type { ProviderRunContext } from "./providers/types";

export const imageToolDefinition = {
  type: "function" as const,
  name: IMAGE_TOOL_NAME,
  description: IMAGE_TOOL_DESCRIPTION,
  inputSchema: z.toJSONSchema(GenerateImageInputSchema)
};

export const imageToolInstructions = "For image creation or editing, call openmind_generate_image (Claude: mcp__openmind_images__openmind_generate_image). The tool uses the user's selected image service/model. It displays each result in the conversation automatically; do not duplicate those images in Markdown. Ordinary image references may use Markdown image syntax. Never claim an image was generated if the tool failed.";

/** One service per run; duplicate call delivery cannot create a second paid job. */
const runServices = new WeakMap<AbortSignal, ImageGenerationService>();
export async function executeImageTool(context: ProviderRunContext, raw: unknown, callId: string): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    if (context.session.permissionProfile === "read-only" || context.session.interactionMode === "plan") throw new Error("请切换到执行模式后再生成图片。");
    const input = GenerateImageInputSchema.parse(raw);
    const selection = context.run.imageGeneration;
    if (!selection) throw new Error("请在输入框下方选择图片服务商和模型。");
    const credentials = new ImageConfigurationStore(context.openmindRoot).credentials(selection);
    context.signal.throwIfAborted();
    let service = runServices.get(context.signal);
    if (!service) { service = new ImageGenerationService(); runServices.set(context.signal, service); }
    const images = await service.generate(input, {
      openmindRoot: context.openmindRoot, cwd: context.cwd, sessionId: context.session.id,
      runId: context.run.id, callId, selection, credentials, signal: context.signal,
      attachmentPaths: context.images.map(image => image.path),
      onImage: async image => { await context.emit("image-artifact", { image, itemId: callId }); }
    });
    return { content: [{ type: "text", text: JSON.stringify({ images, message: "Images are already displayed in the chat. Reference these paths for later editing; do not repeat them as Markdown images." }) }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error instanceof z.ZodError ? "图片参数无效，请检查描述、数量和参考图片。" : error instanceof Error ? error.message : "图片生成失败。" }] };
  }
}
