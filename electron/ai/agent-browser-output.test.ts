import { describe, expect, it } from "vitest";
import { resolveAgentBrowserOutputDir } from "./agent-browser-output";

describe("Internal Agent browser output boundary", () => {
  it("requires and returns the canonical external binding", () => {
    const output = resolveAgentBrowserOutputDir(
      [{ id: "browser-evidence", externalExportId: "browserEvidenceDir" }],
      { browserEvidenceDir: { bindingId: "browserEvidenceDir", canonicalPath: "/tmp/browser-evidence" } }
    );
    expect(output).toBe("/tmp/browser-evidence");
  });

  it.each([
    ["missing artifact binding", [{ id: "browser-evidence" }], undefined],
    ["missing location", [{ id: "browser-evidence", externalExportId: "browserEvidenceDir" }], {}],
    ["revoked location", [{ id: "browser-evidence", externalExportId: "browserEvidenceDir" }], { browserEvidenceDir: { bindingId: "browserEvidenceDir", canonicalPath: "/tmp/browser-evidence", revoked: true } }],
    ["relative location", [{ id: "browser-evidence", externalExportId: "browserEvidenceDir" }], { browserEvidenceDir: { bindingId: "browserEvidenceDir", canonicalPath: "browser-evidence" } }]
  ])("fails closed for %s", (_label, artifacts, bindings) => {
    expect(() => resolveAgentBrowserOutputDir(artifacts, bindings)).toThrow();
  });

  it("rejects multiple external output declarations instead of guessing", () => {
    expect(() => resolveAgentBrowserOutputDir([
      { externalExportId: "browserEvidenceDir" },
      { externalExportId: "otherExport" }
    ], {
      browserEvidenceDir: { bindingId: "browserEvidenceDir", canonicalPath: "/tmp/browser-evidence" },
      otherExport: { bindingId: "otherExport", canonicalPath: "/tmp/other" }
    })).toThrow();
  });
});
