import type { OpenmindRootPreview } from "@shared/contracts";
import { messages as m } from "@shared/messages";

export function openmindRootPreviewBody(preview: OpenmindRootPreview): string {
  const root = preview.canonicalRoot || m.openmindRoot.unresolved;
  const missing = preview.health.missingCreateIfNeededEntries.length;
  const unknown = preview.health.unknownPreservedEntries.length;
  const notes = [
    m.openmindRoot.root(root),
    m.openmindRoot.status(preview.canBind),
    missing ? m.openmindRoot.missing(missing) : m.openmindRoot.structureReady,
    unknown ? m.openmindRoot.unknown(unknown) : m.openmindRoot.noUnknown
  ];
  if (preview.blockingReasons.length) notes.push(m.openmindRoot.blockers(preview.blockingReasons.join("；")));
  return notes.join("\n");
}

export function openmindRootPreviewError(preview: OpenmindRootPreview): string {
  return preview.blockingReasons.join("；") || m.openmindRoot.cannotBind;
}
