import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { ImageSelectionSchema, imageProviderBaseUrl, type ImageConfiguration, type ImageProviderInput, type ImageProviderView, type ImageSelection } from "../../shared/image-generation";
import { resolvePathInsideRoot } from "../ai/scheduler-paths";
import { readProvidersYaml } from "../config/providers-yaml";

const SelectionPreferenceSchema = z.object({
  version: z.literal(1),
  defaultSelection: ImageSelectionSchema.nullable()
}).passthrough();

/** Provider connections have one source of truth: config/providers.yaml. */
export class ImageConfigurationStore {
  constructor(private readonly root: string) {
    if (!root || !path.isAbsolute(root)) throw new Error("请先选择 OpenMind 内容目录。");
  }

  private file(): string { return resolvePathInsideRoot(this.root, "config/image-providers.json"); }

  private preference(): z.infer<typeof SelectionPreferenceSchema> | null {
    const file = this.file();
    if (!fs.existsSync(file)) return null;
    try {
      if (!fs.statSync(file).isFile() || fs.statSync(file).size > 32_768) throw new Error();
      return SelectionPreferenceSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch { throw new Error("图片模型选择无法读取，请检查 config/image-providers.json。"); }
  }

  private connections() {
    resolvePathInsideRoot(this.root, "config/providers.yaml");
    return (readProvidersYaml(this.root)?.providers || []).filter(entry => entry.imageGeneration);
  }

  view(): ImageConfiguration {
    const providers: ImageProviderView[] = this.connections().map(entry => ({
      id: entry.id, name: entry.name, provider: entry.imageGeneration!.provider,
      models: entry.imageGeneration!.models, baseUrl: imageProviderBaseUrl(entry.baseUrl, entry.imageGeneration!.provider),
      enabled: entry.enabled, configured: Boolean(entry.apiKey)
    }));
    const preference = this.preference();
    let defaultSelection: ImageSelection | null = null;
    if (preference?.defaultSelection) {
      const selected = preference.defaultSelection;
      const matches = providers.filter(entry => entry.enabled && entry.configured
        && (!selected.providerId || entry.id === selected.providerId)
        && entry.provider === selected.provider && entry.models.includes(selected.model));
      if (matches.length === 1) defaultSelection = { ...selected, providerId: matches[0].id };
    } else if (!preference) {
      const first = providers.find(entry => entry.enabled && entry.configured);
      if (first) defaultSelection = { providerId: first.id, provider: first.provider, model: first.models[0] };
    }
    return { providers, defaultSelection };
  }

  select(raw: ImageSelection | null): ImageConfiguration {
    let selection = ImageSelectionSchema.nullable().parse(raw);
    if (selection) {
      const entry = this.resolve(selection);
      selection = { ...selection, providerId: entry.id };
    }
    const preference = this.preference();
    const file = this.file();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      // Preserve unrelated legacy fields; only the model choice is app-owned here.
      fs.writeFileSync(temporary, JSON.stringify({ ...preference, version: 1, defaultSelection: selection }, null, 2), { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, file);
    } finally { fs.rmSync(temporary, { force: true }); }
    return this.view();
  }

  private resolve(selection: ImageSelection) {
    ImageSelectionSchema.parse(selection);
    const matches = this.connections().filter(entry => entry.enabled && entry.apiKey
      && (!selection.providerId || entry.id === selection.providerId)
      && entry.imageGeneration!.provider === selection.provider && entry.imageGeneration!.models.includes(selection.model));
    if (matches.length !== 1) throw new Error("所选图片模型已停用或不可用，请在输入框下方重新选择；可在 Provider 配置中开启图片生成并选择模型。");
    return matches[0];
  }

  credentials(selection: ImageSelection): ImageProviderInput {
    const entry = this.resolve(selection);
    return { provider: selection.provider, apiKey: entry.apiKey, authMode: entry.authMode, baseUrl: imageProviderBaseUrl(entry.baseUrl, selection.provider), enabled: entry.enabled };
  }
}
