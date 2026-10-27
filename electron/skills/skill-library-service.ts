import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AuthoredSkillSchema, SkillAssetSchema, SkillLibraryMetadataSchema, type AuthoredSkill, type AuthoredSkillContributor, type SkillAsset, type SkillLibraryEntry, type SkillLibraryMetadata, type SkillSelectionInput } from "../../shared/skill-library";
import { SkillContributorSchema, type SkillContributor, type SkillContributorView } from "../../shared/skill-contributor";
import { resolveSkillLibraryCopy, SKILL_LIBRARY_PUBLISHER, SKILL_LIBRARY_SOURCE } from "../../shared/skill-library-catalog";
import { messages } from "../../shared/messages";
import type { AppPaths } from "../paths/app-paths-service";
import { writeJsonAtomic } from "../lib/fs-utils";
import type { SkillPackageService } from "./skill-package-service";
import { ImageConfigurationStore } from "../images/image-configuration";
import { resolveSkillLibraryTools } from "./skill-library-runtime";
import { isAppLibraryInstall, isLegacyAppLibraryInstall, readSkillLibraryCatalog } from "./skill-library-catalog";
import { prepareSkillAvatar, readSkillAvatar, skillAvatarDataUrl } from "./skill-avatar";
import { installBuiltinDefault } from "./builtin-default-packages";

type Bindings = Record<string, { key: string; digest: string }>;
const METADATA = "openmind.library.json";
const m = messages.skillLibrary;
export function readSkillLibraryMetadata(packageRoot: string): SkillLibraryMetadata | null {
  const file = path.join(packageRoot, METADATA);
  return fs.existsSync(file) ? SkillLibraryMetadataSchema.parse(JSON.parse(fs.readFileSync(file, "utf8"))) : null;
}

/** Authoring sources, installation facts and catalog UI share one root-bound service. */
export class SkillLibraryService {
  private readonly sources: string;
  private readonly privateRoot: string;
  constructor(private readonly root: string, private readonly paths: AppPaths, private readonly packages: SkillPackageService, private readonly bundleRoot: string) {
    if (!root) throw new Error(m.errors.root);
    this.root = fs.realpathSync(root);
    this.sources = path.join(this.root, ".agent", "authored-skills");
    this.privateRoot = path.join(paths.catalog, crypto.createHash("sha256").update(this.root).digest("hex").slice(0, 24));
    this.recoverPublish();
  }

  retainUserInstall(key: string): void {
    const file = path.join(this.privateRoot, "user-installations.json");
    const keys: string[] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    writeJsonAtomic(file, [...new Set([...keys, key])]);
  }
  isUserRetained(key: string): boolean {
    const file = path.join(this.privateRoot, "user-installations.json");
    return fs.existsSync(file) && (JSON.parse(fs.readFileSync(file, "utf8")) as string[]).includes(key);
  }

  list(): SkillLibraryEntry[] {
    const installed = this.packages.listInstalledViews();
    const tools = resolveSkillLibraryTools(this.paths);
    let bundledDigests: Record<string, string> = {};
    try { bundledDigests = JSON.parse(fs.readFileSync(path.join(this.bundleRoot, "bundle.json"), "utf8")).packages || {}; }
    catch { /* Installed packages remain usable if discovery resources are unavailable. */ }
    const runtimeUnavailable = (requirement: AuthoredSkill["requirement"]): string | null => {
      if (requirement === "image" && !new ImageConfigurationStore(this.root).view().defaultSelection) return m.errors.imageSetup;
      if ((requirement === "python" || requirement === "ffmpeg") && !tools.python) return m.errors.pythonSetup;
      if (requirement === "ffmpeg" && !tools.ffmpeg) return m.errors.videoSetup;
      return null;
    };
    const dependencyUnavailable = (packagePath: string) => (readSkillLibraryMetadata(packagePath)?.dependencies || []).some(reference =>
      !installed.some(record => record.key === reference.key && record.digest === reference.digest && record.enabled && record.usable));
    const presetKeys = new Set<string>();
    const result: SkillLibraryEntry[] = readSkillLibraryCatalog(this.bundleRoot).skills.map(preset => {
      const record = installed.find(item => item.id === preset.id && isAppLibraryInstall(item));
      if (record) presetKeys.add(record.key);
      const copy = resolveSkillLibraryCopy(preset);
      let reason: string | null = !fs.existsSync(path.join(this.bundleRoot, preset.id, "SKILL.md")) && !record ? m.errors.bundle : null;
      if (!record && installed.some(item => item.id === preset.id && !isAppLibraryInstall(item))) reason = m.errors.sourceConflict;
      if (!reason && record && !record.usable) reason = m.errors.stale;
      reason ||= runtimeUnavailable(preset.requirement);
      const updateAvailable = Boolean(record && bundledDigests[preset.id] && bundledDigests[preset.id] !== record.digest);
      return { id: preset.id, discoverable: preset.discoverable, updateAvailable, title: copy.title, subtitle: copy.subtitle, description: copy.description ?? copy.subtitle, inputHint: copy.inputHint, category: preset.category, origin: "preset", installed: Boolean(record), enabled: record?.enabled ?? false, usable: !reason && (record?.usable ?? true), reason, key: record?.key ?? null, digest: record?.digest ?? null, version: record?.version ?? null, skillId: preset.id, authoringId: null, revision: 0, draft: false, imageCount: 0, source: m.origin.preset, executionModel: null, updatedAt: record?.installedAt, contributor: this.contributorView(preset.contributor, path.join(this.bundleRoot, preset.id)) };
    });
    const authored = this.documents();
    for (const doc of authored) {
      const key = `user/om-user-${doc.id}`;
      const record = installed.find(item => item.key === key);
      const reason = record && !record.usable ? m.errors.stale : record && dependencyUnavailable(record.packagePath) ? m.errors.dependency : runtimeUnavailable(doc.requirement);
      if (record) presetKeys.add(key);
      result.push({ id: doc.id, title: doc.name, subtitle: doc.subtitle, description: doc.description, inputHint: doc.inputHint, category: doc.category, origin: "authored", installed: Boolean(record), enabled: record?.enabled ?? false, usable: !reason && (record?.usable ?? false), reason, key: record?.key ?? null, digest: record?.digest ?? null, version: record?.version ?? null, skillId: `om-user-${doc.id}`, authoringId: doc.id, revision: doc.revision, draft: this.hasDraft(doc.id) || !record, imageCount: doc.images.length, source: "user", images: doc.images, updatedAt: record?.installedAt || (fs.existsSync(this.draftFile(doc.id)) ? fs.statSync(this.draftFile(doc.id)).mtime.toISOString() : undefined), cover: doc.images[0], icon: doc.icon, executionModel: doc.executionModel, contributor: this.authoredContributorView(doc) });
    }
    for (const record of installed) {
      if (presetKeys.has(record.key)) continue;
      const inspection = this.packages.inspectInstalledCopy(this.packages.getInstalled(record.key, record.digest)!);
      const display = inspection.manifest?.display;
      const builtin = isAppLibraryInstall(record);
      result.push({ id: record.key, title: display?.name || record.id, subtitle: display?.description || "", description: display?.description || "", inputHint: "", category: null, origin: builtin ? "preset" : record.sourceType === "git" ? "git" : "local", discoverable: false, installed: true, enabled: record.enabled, usable: record.usable, reason: record.usable ? null : m.errors.stale, key: record.key, digest: record.digest, version: record.version, skillId: record.id, authoringId: null, revision: 0, draft: false, imageCount: 0, source: builtin ? m.origin.preset : record.sourceLocator || record.sourceType || "local", executionModel: null, updatedAt: record.installedAt, contributor: this.installedContributorView(record.packagePath) });
    }
    return result;
  }

  /** Preview catalog identities without installing or executing a package. */
  prompt(id: string): string {
    const entry = this.list().find(item => item.id === id);
    if (!entry) throw new Error(m.errors.missing);
    if (entry.authoringId && entry.draft) {
      return this.editor(entry.authoringId).instructions.map(block => block.text).join("\n\n");
    }
    if (entry.key && entry.digest) {
      const record = this.packages.getInstalled(entry.key, entry.digest);
      if (!record || !this.packages.inspectInstalledCopy(record).valid) throw new Error(m.errors.stale);
      const file = path.join(record.packagePath, "SKILL.md");
      if (!fs.existsSync(file)) return "";
      if (!fs.realpathSync(file).startsWith(`${fs.realpathSync(record.packagePath)}${path.sep}`)) throw new Error(m.errors.stale);
      return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim();
    }
    const catalog = readSkillLibraryCatalog(this.bundleRoot);
    const preset = catalog.skills.find(item => item.id === entry.id);
    if (!preset) throw new Error(m.errors.missing);
    return [...preset.instructions, ...catalog.executionRules].join("\n\n");
  }

  installPreset(id: string): SkillLibraryEntry {
    const preset = readSkillLibraryCatalog(this.bundleRoot).skills.find(item => item.id === id);
    if (!preset) throw new Error(m.errors.missing);
    if (preset.packageDirectory) {
      const record = installBuiltinDefault(this.packages, id, this.bundleRoot, key => this.isUserRetained(key));
      this.packages.setEnabled(record.key, record.digest, true);
      writeJsonAtomic(path.join(this.privateRoot, "bindings.json"), { ...this.bindings(), [id]: { key: record.key, digest: record.digest } });
      return this.list().find(entry => entry.id === id)!;
    }
    const occupant = this.packages.getInstalledById(id);
    if (occupant && !isAppLibraryInstall(occupant)) throw new Error(m.errors.sourceConflict);
    const source = path.join(this.bundleRoot, preset.id);
    if (!fs.existsSync(path.join(source, "SKILL.md"))) throw new Error(m.errors.bundle);
    const manifest = JSON.parse(fs.readFileSync(path.join(this.bundleRoot, "bundle.json"), "utf8")) as { packages: Record<string, string> };
    const inspection = this.packages.inspect(source);
    if (!inspection.valid || inspection.manifest?.id !== id || inspection.manifest.publisher.id !== SKILL_LIBRARY_PUBLISHER || inspection.digest !== manifest.packages[id]) throw new Error(m.errors.stale);
    const binding = this.bindings()[id];
    const previous = binding && this.packages.getInstalled(binding.key, binding.digest);
    const legacy = previous && isLegacyAppLibraryInstall(previous) ? { key: previous.key, digest: previous.digest } : undefined;
    const record = this.packages.install(source, { sourceType: "builtin", sourceLocator: SKILL_LIBRARY_SOURCE, sourcePackageRef: id }, legacy);
    this.packages.setEnabled(record.key, record.digest, true);
    writeJsonAtomic(path.join(this.privateRoot, "bindings.json"), { ...this.bindings(), [id]: { key: record.key, digest: record.digest } });
    return this.list().find(entry => entry.id === id)!;
  }

  editor(id?: string): AuthoredSkill {
    if (!id) {
      const document = AuthoredSkillSchema.parse({ id: crypto.randomUUID(), name: "", subtitle: "", category: "writing", instructions: [{ id: crypto.randomUUID(), text: "" }], inputHint: "", description: "" });
      document.contributor = this.defaultContributor(document.id);
      this.saveDraft(document);
      return document;
    }
    const safe = this.id(id);
    const file = this.hasDraft(safe) ? this.draftFile(safe) : path.join(this.authorRoot(safe), "skill.json");
    if (!fs.existsSync(file)) throw new Error(m.errors.missing);
    return AuthoredSkillSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  }

  saveDraft(raw: AuthoredSkill): AuthoredSkill {
    const doc = AuthoredSkillSchema.parse(raw);
    const currentFile = path.join(this.authorRoot(doc.id), "skill.json");
    if (fs.existsSync(currentFile)) {
      const current = AuthoredSkillSchema.parse(JSON.parse(fs.readFileSync(currentFile, "utf8")));
      // An autosave/unmount can arrive after activation but before its IPC reply.
      // Ignore the already-published payload; keep genuinely conflicting edits.
      if (doc.revision < current.revision && JSON.stringify({ ...doc, name: doc.name.trim(), revision: current.revision }) === JSON.stringify(current)) return current;
    }
    writeJsonAtomic(this.draftFile(doc.id), doc);
    return doc;
  }

  publish(raw: AuthoredSkill, operationId: string): SkillLibraryEntry {
    const doc = AuthoredSkillSchema.parse(raw);
    if (!doc.name.trim()) throw new Error(m.errors.nameRequired);
    if (!doc.instructions.some(block => block.text.trim())) throw new Error(m.errors.instructionRequired);
    const currentFile = path.join(this.authorRoot(doc.id), "skill.json");
    const receiptFile = path.join(this.privateRoot, "operations", `${this.id(operationId)}.json`);
    if (fs.existsSync(receiptFile)) {
      const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8")) as { id: string; request: string };
      if (receipt.id !== doc.id || receipt.request !== crypto.createHash("sha256").update(JSON.stringify(doc)).digest("hex")) throw new Error(m.errors.conflict);
      return this.list().find(entry => entry.id === doc.id)!;
    }
    const contributor = this.packageContributor(doc);
    const current = fs.existsSync(currentFile) ? AuthoredSkillSchema.parse(JSON.parse(fs.readFileSync(currentFile, "utf8"))) : null;
    if ((current?.revision ?? 0) !== doc.revision) throw new Error(m.errors.conflict);
    if (this.documents().some(other => other.id !== doc.id && other.name.trim().normalize("NFC").toLocaleLowerCase() === doc.name.trim().normalize("NFC").toLocaleLowerCase())) throw new Error(m.errors.duplicateName);
    const dependencies = this.dependencies(doc);
    const next = { ...doc, name: doc.name.trim(), revision: doc.revision + 1 };
    const stage = path.join(this.paths.staging, `authored-${crypto.randomUUID()}`);
    fs.mkdirSync(stage, { recursive: true });
    try {
      const support = path.join(this.authorRoot(doc.id), "support");
      if (fs.existsSync(support)) fs.cpSync(support, stage, { recursive: true, dereference: false });
      const referencedAssets = [...doc.images, ...doc.instructions.flatMap(block => block.assets), ...(doc.contributor?.avatar ? [doc.contributor.avatar] : [])];
      for (const asset of referencedAssets) {
        const source = this.assetFile(doc.id, asset);
        fs.mkdirSync(path.join(stage, "references"), { recursive: true });
        fs.copyFileSync(source, path.join(stage, "references", `${asset.id}${asset.extension}`));
      }
      const summary = Array.from(doc.subtitle || doc.description || doc.name).slice(0, 500).join("");
      const text = doc.instructions.filter(block => block.text.trim() || block.assets.length || block.skills.length).map((block, index) => [
        `## ${index + 1}\n\n${block.text}`,
        ...block.assets.map(asset => `Reference material: references/${asset.id}${asset.extension} (${asset.name})`),
        ...block.skills.map(reference => `Referenced installed Skill: ${reference.key} (${reference.digest}). Use the verified rules supplied in the referenced_skill context for this instruction block.`)
      ].join("\n\n")).join("\n\n");
      fs.writeFileSync(path.join(stage, "SKILL.md"), `---\nname: om-user-${doc.id}\ndescription: ${JSON.stringify(summary)}\n---\n\n# ${doc.name}\n\n${text}\n`);
      writeJsonAtomic(path.join(stage, METADATA), { schemaVersion: 1, origin: "authored", capabilityMode: "session", document: next, category: doc.category, inputHint: doc.inputHint, executionModel: doc.executionModel, requirement: doc.requirement, dependencies, contributor } satisfies SkillLibraryMetadata);
      writeJsonAtomic(path.join(stage, "cctools.skill.yaml"), {
        apiVersion: "cctools.dev/skill/v1", id: `om-user-${doc.id}`, version: `1.0.${next.revision}`, publisher: { id: "user", displayName: "User" }, kind: "agent", display: { name: doc.name, description: summary, group: doc.category },
        capabilities: { openmind: { read: [], write: [] }, network: { required: false, hosts: [] }, subprocess: { allowed: false }, browser: false },
        execution: { timeoutSeconds: 3600, gracefulStopSeconds: 10, retry: { maxAttempts: 0 }, concurrency: { maxInstances: 1, mutexes: [] } }, platforms: ["windows-x64", "windows-arm64", "macos-arm64", "macos-x64", "linux-x64", "linux-arm64", "wsl-linux-x64"], compatibility: { minAppVersion: "1.0.0" }
      });
      // Save a recoverable revision before activation. The installer stages and
      // atomically replaces package bytes; draft removal is the last operation.
      writeJsonAtomic(path.join(this.authorRoot(doc.id), "revisions", `${next.revision}.json`), next);
      const expected = this.packages.inspect(stage);
      if (!expected.valid || expected.manifest?.publisher.id !== "user") throw new Error(m.errors.invalid);
      writeJsonAtomic(path.join(this.privateRoot, "publishing.json"), { document: next, operationId, request: crypto.createHash("sha256").update(JSON.stringify(doc)).digest("hex"), digest: expected.digest });
      const record = this.packages.install(stage);
      writeJsonAtomic(currentFile, next);
      this.rememberContributor(next);
      writeJsonAtomic(receiptFile, { id: doc.id, request: crypto.createHash("sha256").update(JSON.stringify(doc)).digest("hex"), digest: record.digest });
      fs.rmSync(this.draftFile(doc.id), { force: true });
      fs.rmSync(path.join(this.privateRoot, "publishing.json"), { force: true });
      return this.list().find(entry => entry.id === doc.id)!;
    } finally { fs.rmSync(stage, { recursive: true, force: true }); }
  }

  remove(id: string): void {
    const safe = this.id(id);
    const record = this.packages.listInstalled().find(item => item.key === `user/om-user-${safe}`);
    if (record) this.packages.uninstall(record.key, record.digest);
    fs.rmSync(this.authorRoot(safe), { recursive: true, force: true });
    fs.rmSync(this.draftFile(safe), { force: true });
  }

  importAssets(id: string, files: string[], imageOnly: boolean): SkillAsset[] {
    this.editor(id); // Admission requires an existing editor/draft identity.
    return files.map(file => {
      const real = fs.realpathSync(file);
      const stat = fs.statSync(real);
      const extension = path.extname(real).toLowerCase();
      const isImage = [".png", ".jpg", ".jpeg", ".webp"].includes(extension);
      if (!stat.isFile() || stat.size > 10 * 1024 * 1024 || stat.size === 0 || imageOnly && !isImage || !isImage && ![".md", ".txt", ".json", ".csv", ".pdf"].includes(extension)) throw new Error(m.errors.asset);
      if (isImage) {
        const bytes = fs.readFileSync(real);
        if (!(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes[0] === 255 && bytes[1] === 216 || bytes.subarray(0,4).toString() === "RIFF" && bytes.subarray(8,12).toString() === "WEBP")) throw new Error(m.errors.asset);
      }
      const asset = SkillAssetSchema.parse({ id: crypto.randomUUID(), name: path.basename(real), kind: isImage ? "image" : "document", extension });
      const destination = this.assetFile(id, asset, false);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(real, destination, fs.constants.COPYFILE_EXCL);
      return asset;
    });
  }

  async importAvatar(id: string, file: string, assertCurrent: () => void = () => {}): Promise<SkillAsset> {
    this.editor(id);
    const bytes = await prepareSkillAvatar(file);
    assertCurrent();
    this.editor(id);
    return this.storeAvatar(id, bytes);
  }

  private storeAvatar(id: string, bytes: Buffer, extension = ".png"): SkillAsset {
    const asset: SkillAsset = { id: crypto.randomUUID(), name: `avatar${extension}`, kind: "image", extension };
    const destination = this.assetFile(id, asset, false);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes, { flag: "wx" });
    return asset;
  }

  private contributorView(contributor: SkillContributor | undefined, root: string): SkillContributorView | undefined {
    if (!contributor?.nick) return undefined;
    let avatarUrl: string | undefined;
    if (contributor.avatar) try { avatarUrl = skillAvatarDataUrl(readSkillAvatar(root, contributor.avatar)); } catch { /* Missing avatars keep their nickname and use the default icon. */ }
    return { nick: contributor.nick, avatarUrl, profileUrl: contributor.profileUrl };
  }

  private authoredContributorView(doc: AuthoredSkill): SkillContributorView | undefined {
    if (!doc.contributor?.nick) return undefined;
    const avatar = doc.contributor.avatar;
    return this.contributorView({ nick: doc.contributor.nick, profileUrl: doc.contributor.profileUrl, avatar: avatar ? `assets/${avatar.id}${avatar.extension}` : undefined }, this.authorRoot(doc.id));
  }

  private installedContributorView(packagePath: string): SkillContributorView | undefined {
    try { return this.contributorView(readSkillLibraryMetadata(packagePath)?.contributor, packagePath); }
    catch { return undefined; }
  }

  private packageContributor(doc: AuthoredSkill): SkillContributor | undefined {
    const contributor = doc.contributor;
    if (!contributor || !contributor.nick && !contributor.avatar && !contributor.profileUrl) return undefined;
    const avatar = contributor.avatar;
    const result = SkillContributorSchema.parse({ nick: contributor.nick, profileUrl: contributor.profileUrl, avatar: avatar ? `references/${avatar.id}${avatar.extension}` : undefined });
    if (avatar) readSkillAvatar(this.authorRoot(doc.id), `assets/${avatar.id}${avatar.extension}`);
    return result;
  }

  private defaultContributor(id: string): AuthoredSkillContributor | undefined {
    const root = path.join(this.paths.catalog, "skill-contributor");
    try {
      const saved = SkillContributorSchema.parse(JSON.parse(fs.readFileSync(path.join(root, "profile.json"), "utf8")));
      const contributor: AuthoredSkillContributor = { nick: saved.nick, profileUrl: saved.profileUrl };
      if (saved.avatar) try { contributor.avatar = this.storeAvatar(id, readSkillAvatar(root, saved.avatar), path.extname(saved.avatar).toLowerCase()); } catch { /* The nickname can still be reused. */ }
      return contributor;
    } catch { return undefined; }
  }

  private rememberContributor(doc: AuthoredSkill): void {
    // Legacy copies keep the original author's attribution without changing our defaults.
    if (!doc.contributor || doc.copiedFrom) return;
    const root = path.join(this.paths.catalog, "skill-contributor");
    const contributor = this.packageContributor(doc);
    if (!contributor) { fs.rmSync(path.join(root, "profile.json"), { force: true }); return; }
    let avatar: string | undefined;
    if (doc.contributor.avatar) {
      const asset = doc.contributor.avatar;
      const bytes = readSkillAvatar(this.authorRoot(doc.id), `assets/${asset.id}${asset.extension}`);
      avatar = `${crypto.createHash("sha256").update(bytes).digest("hex")}${asset.extension}`;
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, avatar), bytes);
    }
    writeJsonAtomic(path.join(root, "profile.json"), { nick: contributor.nick, avatar, profileUrl: contributor.profileUrl });
  }

  readImage(id: string, asset: SkillAsset): string {
    const selected = SkillAssetSchema.parse(asset);
    if (selected.kind !== "image") throw new Error(m.errors.asset);
    const file = this.assetFile(id, selected);
    const bytes = fs.readFileSync(file);
    if (bytes.length > 10 * 1024 * 1024) throw new Error(m.errors.asset);
    return `data:image/${selected.extension === ".webp" ? "webp" : selected.extension === ".png" ? "png" : "jpeg"};base64,${bytes.toString("base64")}`;
  }

  private dependencies(doc: AuthoredSkill): SkillSelectionInput[] {
    const all = new Map<string, SkillSelectionInput>();
    const visit = (reference: SkillSelectionInput, ancestors: Set<string>, depth: number) => {
      if (depth > 3 || ancestors.has(reference.key) || reference.key === `user/om-user-${doc.id}`) throw new Error(m.errors.dependency);
      const record = this.packages.getInstalled(reference.key, reference.digest);
      if (!record || !this.packages.isEnabled(record) || !this.packages.inspectInstalledCopy(record).valid) throw new Error(m.errors.dependency);
      const previous = all.get(reference.key);
      if (previous && previous.digest !== reference.digest) throw new Error(m.errors.dependency);
      all.set(reference.key, reference);
      if (all.size > 10) throw new Error(m.errors.dependency);
      const next = new Set(ancestors).add(reference.key);
      for (const child of readSkillLibraryMetadata(record.packagePath)?.dependencies || []) visit(child, next, depth + 1);
    };
    for (const reference of doc.instructions.flatMap(block => block.skills)) visit(reference, new Set(), 1);
    return [...all.values()];
  }

  private recoverPublish(): void {
    const file = path.join(this.privateRoot, "publishing.json");
    if (!fs.existsSync(file)) return;
    const pending = JSON.parse(fs.readFileSync(file, "utf8")) as { document: AuthoredSkill; operationId: string; request: string; digest: string };
    const document = AuthoredSkillSchema.parse(pending.document);
    const installed = this.packages.getInstalled(`user/om-user-${document.id}`, pending.digest);
    if (installed && this.packages.isInstalledCopyUsable(installed)) {
      const metadata = readSkillLibraryMetadata(installed.packagePath);
      if (metadata?.document?.revision !== document.revision) throw new Error(m.errors.conflict);
      writeJsonAtomic(path.join(this.authorRoot(document.id), "skill.json"), document);
      this.rememberContributor(document);
      writeJsonAtomic(path.join(this.privateRoot, "operations", `${this.id(pending.operationId)}.json`), { id: document.id, request: pending.request, digest: installed.digest });
      fs.rmSync(this.draftFile(document.id), { force: true });
    }
    fs.rmSync(file, { force: true });
  }

  private documents(): AuthoredSkill[] {
    const docs = new Map<string, AuthoredSkill>();
    if (fs.existsSync(this.sources)) for (const id of fs.readdirSync(this.sources)) {
      if (!/^[a-f0-9-]{36}$/.test(id)) continue;
      const file = path.join(this.authorRoot(id), "skill.json");
      if (fs.existsSync(file)) docs.set(id, AuthoredSkillSchema.parse(JSON.parse(fs.readFileSync(file, "utf8"))));
    }
    const drafts = path.join(this.privateRoot, "drafts");
    if (fs.existsSync(drafts)) for (const file of fs.readdirSync(drafts)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue;
      const draft = AuthoredSkillSchema.parse(JSON.parse(fs.readFileSync(path.join(drafts, file), "utf8")));
      if (!docs.has(draft.id)) docs.set(draft.id, draft);
    }
    return [...docs.values()];
  }
  private bindings(): Bindings { const file = path.join(this.privateRoot, "bindings.json"); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) as Bindings : {}; }
  private hasDraft(id: string): boolean { return fs.existsSync(this.draftFile(id)); }
  private draftFile(id: string): string { return path.join(this.privateRoot, "drafts", `${this.id(id)}.json`); }
  private id(id: string): string { return AuthoredSkillSchema.shape.id.parse(id); }
  private authorRoot(id: string): string {
    const target = path.join(this.sources, this.id(id));
    for (const check of [path.join(this.root, ".agent"), this.sources, target]) if (fs.existsSync(check) && fs.lstatSync(check).isSymbolicLink()) throw new Error(m.errors.asset);
    return target;
  }
  private assetFile(id: string, asset: SkillAsset, requireExists = true): string {
    const a = SkillAssetSchema.parse(asset);
    const base = this.authorRoot(id);
    const assets = path.join(base, "assets");
    if (fs.existsSync(assets) && fs.lstatSync(assets).isSymbolicLink()) throw new Error(m.errors.asset);
    const file = path.join(assets, `${a.id}${a.extension}`);
    if (requireExists && (!fs.existsSync(file) || !fs.realpathSync(file).startsWith(`${base}${path.sep}`))) throw new Error(m.errors.asset);
    return file;
  }
}
