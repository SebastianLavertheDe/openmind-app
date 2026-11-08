/** File references in documents are relative to the document, not the renderer URL. */
export function documentFileReference(value: string): string | null {
  let path = value.trim().replaceAll("\\", "/");
  if (!path || /[\u0000-\u001f\u007f]/.test(path) || path.startsWith("#")) return null;
  if (/^file:/i.test(path)) {
    try {
      const url = new URL(path);
      if (url.hostname && url.hostname !== "localhost") return null;
      path = decodeURIComponent(url.pathname).replace(/^\/([a-z]:\/)/i, "$1");
    } catch { return null; }
  } else {
    try { path = decodeURIComponent(path); } catch { return null; }
  }
  path = path.replaceAll("\\", "/");
  if (path.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:\//i.test(path)) return null;
  if (/[\u0000-\u001f\u007f]/.test(path)) return null;
  path = path.split(/[?#]/, 1)[0];
  return /(?:^|\/)[^/]+\.[a-z\d][a-z\d._-]{0,9}$/i.test(path) ? path : null;
}

export function resolveDocumentFileLink(value: string, documentPath: string): string | null {
  const reference = documentFileReference(value);
  if (!reference) return null;
  const base = documentPath.replaceAll("\\", "/");
  const rooted = /^(?:[a-z]:\/|\/|openmind\/)/i.test(reference);
  const path = rooted ? reference : `${base.slice(0, base.lastIndexOf("/") + 1)}${reference}`;
  const segments: string[] = [];
  const absolute = path.startsWith("/");
  const floor = /^(?:[a-z]:\/|openmind\/)/i.test(path) ? 1 : 0;
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length <= floor) return null;
      segments.pop();
    } else segments.push(segment);
  }
  return `${absolute ? "/" : ""}${segments.join("/")}`;
}
