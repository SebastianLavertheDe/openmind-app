const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const appRoot = path.resolve(__dirname, "..");
const buildRoot = path.join(appRoot, ".build");
const evidenceRoot = path.join(buildRoot, "release-evidence");
const packageJsonPath = path.join(appRoot, "package.json");
const packageLockPath = path.join(appRoot, "package-lock.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const packageLock = JSON.parse(fs.readFileSync(packageLockPath, "utf8"));
const generatedAt = new Date().toISOString();

if (packageLock.lockfileVersion !== 3) {
  throw new Error(`Unsupported package-lock lockfileVersion: ${packageLock.lockfileVersion}`);
}
if (!fs.existsSync(buildRoot)) throw new Error(".build is missing. Run npm run build before release evidence generation.");

const productionPackages = collectProductionPackages();
const licenseComponents = productionPackages.map(toLicenseComponent);
const unknownLicenses = licenseComponents.filter((component) => component.license === "NOASSERTION");
if (unknownLicenses.length) {
  throw new Error(`License metadata is missing for ${unknownLicenses.length} production dependencies:\n${unknownLicenses.map((item) => `- ${item.name}@${item.version}`).join("\n")}`);
}

const artifactFiles = collectBuildFiles();
const artifactTreeDigest = digestArtifactTree(artifactFiles);
const git = readGitEvidence();
const toolchain = {
  node: process.version,
  npm: readCommand("npm", ["--version"]),
  electron: packageJson.devDependencies?.electron || packageJson.dependencies?.electron || null,
  platform: process.platform,
  arch: process.arch
};
const inputDigests = {
  packageJsonSha256: sha256File(packageJsonPath),
  packageLockSha256: sha256File(packageLockPath)
};

const sbom = buildCycloneDxSbom(productionPackages);
const licenses = {
  schemaVersion: 1,
  kind: "openmind-license-report",
  generatedAt,
  source: "package-lock.json production dependency closure",
  componentCount: licenseComponents.length,
  unknownLicenseCount: unknownLicenses.length,
  components: licenseComponents
};
const provenance = {
  schemaVersion: 1,
  kind: "openmind-build-provenance",
  generatedAt,
  builder: "openmind-desktop",
  app: { name: packageJson.name, version: packageJson.version },
  command: "npm run build",
  source: git,
  toolchain,
  inputs: inputDigests,
  artifact: {
    root: ".build",
    fileCount: artifactFiles.length,
    totalBytes: artifactFiles.reduce((sum, file) => sum + file.bytes, 0),
    treeSha256: artifactTreeDigest
  }
};

fs.rmSync(evidenceRoot, { recursive: true, force: true });
fs.mkdirSync(evidenceRoot, { recursive: true });
writeJson("sbom.cdx.json", sbom);
writeJson("licenses.json", licenses);
writeJson("provenance.json", provenance);

const evidenceFiles = ["sbom.cdx.json", "licenses.json", "provenance.json"].map((name) => {
  const filePath = path.join(evidenceRoot, name);
  return { path: `release-evidence/${name}`, bytes: fs.statSync(filePath).size, sha256: sha256File(filePath) };
});
writeJson("index.json", {
  schemaVersion: 1,
  kind: "openmind-release-evidence-index",
  generatedAt,
  app: { name: packageJson.name, version: packageJson.version },
  artifacts: evidenceFiles,
  sbom: { format: "CycloneDX", path: "release-evidence/sbom.cdx.json", componentCount: sbom.components.length },
  licenses: { path: "release-evidence/licenses.json", componentCount: licenses.componentCount, unknownLicenseCount: licenses.unknownLicenseCount },
  provenance: { path: "release-evidence/provenance.json", treeSha256: provenance.artifact.treeSha256 }
});

console.log(`Release evidence generated: ${productionPackages.length} production components, ${artifactFiles.length} build files.`);

function collectProductionPackages() {
  const packages = new Map();
  for (const name of Object.keys(packageJson.dependencies || {})) visit(resolveLockKey("", name), true, name);
  return [...packages.values()].sort((left, right) => {
    const leftName = left.installed.name || packageNameFromKey(left.key);
    const rightName = right.installed.name || packageNameFromKey(right.key);
    const leftVersion = left.installed.version || left.lockEntry.version || "";
    const rightVersion = right.installed.version || right.lockEntry.version || "";
    return leftName.localeCompare(rightName) || leftVersion.localeCompare(rightVersion);
  });

  function visit(key, required, requestedName = "unknown") {
    if (!key) {
      if (required) throw new Error(`Unable to resolve required production dependency from package-lock.json: ${requestedName}`);
      return;
    }
    if (packages.has(key)) return;
    const lockEntry = packageLock.packages[key];
    if (!lockEntry || !key.startsWith("node_modules/")) {
      if (required) throw new Error(`Missing required package-lock entry: ${key}`);
      return;
    }
    const packageJsonFile = path.join(appRoot, key, "package.json");
    if (!fs.existsSync(packageJsonFile)) {
      if (required) throw new Error(`Installed production dependency is missing: ${key}`);
      return;
    }
    const installed = JSON.parse(fs.readFileSync(packageJsonFile, "utf8"));
    const record = { key, lockEntry, installed };
    packages.set(key, record);
    for (const dependencyName of new Set([
      ...Object.keys(lockEntry.dependencies || {}),
      ...Object.keys(lockEntry.peerDependencies || {}),
      ...Object.keys(lockEntry.optionalDependencies || {})
    ])) {
      const optional = Boolean(lockEntry.optionalDependencies?.[dependencyName] || lockEntry.peerDependenciesMeta?.[dependencyName]?.optional);
      visit(resolveLockKey(key, dependencyName), !optional, `${key} -> ${dependencyName}`);
    }
  }
}

function resolveLockKey(parentKey, dependencyName) {
  let directory = parentKey ? path.posix.dirname(parentKey) : "node_modules";
  while (directory && directory !== ".") {
    const candidate = `${directory}/${dependencyName}`;
    if (packageLock.packages[candidate]) return candidate;
    const parent = path.posix.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

function toLicenseComponent(record) {
  const name = record.installed.name || packageNameFromKey(record.key);
  const version = record.installed.version || record.lockEntry.version;
  const license = normalizeLicense(record.installed.license || record.installed.licenses);
  return {
    name,
    version,
    license,
    licenseSource: `${record.key}/package.json`,
    purl: packageUrl(name, version),
    integrity: record.lockEntry.integrity || null,
    resolved: record.lockEntry.resolved || null,
    packageJsonSha256: sha256File(path.join(appRoot, record.key, "package.json"))
  };
}

function buildCycloneDxSbom(records) {
  const appRef = packageUrl(packageJson.name, packageJson.version);
  const components = records.map((record) => {
    const name = record.installed.name || packageNameFromKey(record.key);
    const version = record.installed.version || record.lockEntry.version;
    const component = {
      type: "library",
      bomRef: packageUrl(name, version),
      group: name.startsWith("@") ? name.split("/")[0] : undefined,
      name: name.startsWith("@") ? name.split("/").slice(1).join("/") : name,
      version,
      scope: "required",
      purl: packageUrl(name, version),
      licenses: [cycloneDxLicense(normalizeLicense(record.installed.license || record.installed.licenses))]
    };
    const hash = integrityHash(record.lockEntry.integrity);
    if (hash) component.hashes = [hash];
    if (!component.group) delete component.group;
    return component;
  });
  const dependencies = [{ ref: appRef, dependsOn: Object.keys(packageJson.dependencies || {}).map((name) => packageUrlFromRecord(resolveLockKey("", name), name)).filter(Boolean) }];
  for (const record of records) {
    const name = record.installed.name || packageNameFromKey(record.key);
    const version = record.installed.version || record.lockEntry.version;
    const dependsOn = new Set();
    for (const dependencyName of new Set([
      ...Object.keys(record.lockEntry.dependencies || {}),
      ...Object.keys(record.lockEntry.peerDependencies || {}),
      ...Object.keys(record.lockEntry.optionalDependencies || {})
    ])) {
      const key = resolveLockKey(record.key, dependencyName);
      const child = key && records.find((item) => item.key === key);
      if (child) dependsOn.add(packageUrl(child.installed.name || packageNameFromKey(child.key), child.installed.version || child.lockEntry.version));
    }
    dependencies.push({ ref: packageUrl(name, version), dependsOn: [...dependsOn].sort() });
  }
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: generatedAt,
      tools: [{ vendor: "OpenMind", name: "generate-release-evidence", version: packageJson.version }],
      component: { type: "application", bomRef: appRef, name: packageJson.name, version: packageJson.version, purl: appRef }
    },
    components,
    dependencies
  };
}

function packageUrlFromRecord(key, fallbackName) {
  if (!key) return null;
  const record = packageLock.packages[key];
  return record ? packageUrl(packageNameFromKey(key) || fallbackName, record.version) : null;
}

function packageNameFromKey(key) {
  return key.replace(/^node_modules\//, "").split("/node_modules/").at(-1);
}

function packageUrl(name, version) {
  return `pkg:npm/${name}@${version}`;
}

function normalizeLicense(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) return value.map((item) => normalizeLicense(item)).filter(Boolean).join(" OR ") || "NOASSERTION";
  if (value && typeof value === "object") return normalizeLicense(value.type || value.name || value.id);
  return "NOASSERTION";
}

function cycloneDxLicense(value) {
  if (/^[A-Za-z][A-Za-z0-9.-]*$/.test(value)) return { license: { id: value } };
  if (/\b(OR|AND)\b/.test(value)) return { expression: value };
  return { license: { name: value } };
}

function integrityHash(integrity) {
  if (typeof integrity !== "string") return null;
  const match = integrity.match(/^(sha512|sha384|sha256)-([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  return { alg: match[1].toUpperCase(), content: Buffer.from(match[2], "base64").toString("hex") };
}

function collectBuildFiles() {
  const files = [];
  walk(buildRoot, "");
  return files.sort((left, right) => left.path.localeCompare(right.path));

  function walk(directory, relativeDirectory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (!relativeDirectory && entry.name === "release-evidence") continue;
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Build provenance refuses symlink: ${relative}`);
      if (stat.isDirectory()) walk(absolute, relative);
      else if (stat.isFile()) files.push({ path: relative.replaceAll(path.sep, "/"), bytes: stat.size, sha256: sha256File(absolute) });
      else throw new Error(`Build provenance refuses special file: ${relative}`);
    }
  }
}

function digestArtifactTree(files) {
  const hash = crypto.createHash("sha256");
  for (const file of files) hash.update(`${file.path}\0${file.bytes}\0${file.sha256}\n`);
  return hash.digest("hex");
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readGitEvidence() {
  const commit = readCommand("git", ["rev-parse", "HEAD"]);
  const status = readCommand("git", ["status", "--porcelain"]);
  return { commit: commit || null, dirty: Boolean(status), statusEntryCount: status ? status.split(/\r?\n/).filter(Boolean).length : 0 };
}

function readCommand(command, args) {
  try {
    return execFileSync(command, args, { cwd: appRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(evidenceRoot, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
