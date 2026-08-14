# Changelog

## Unreleased

### Distribution UX

- Skills Center now accepts public HTTPS Git repositories, ZIP files and local
  directories through an inspect → confirm → install flow. The UI shows the
  Manifest identity, digest, file count, warnings and issues before import,
  rejects credential-bearing/non-HTTPS Git URLs and supports cancelling a Git
  inspection.
- Installed valid Skills are promoted to active + ready through the Main-owned
  lifecycle after static validation and Runtime preparation. The removed
  `executionTrust` host-approval gate is not recreated by the distribution UI;
  the App still makes the OS-user execution boundary explicit.
- Settings can install Claude Code through its official HTTPS native installer
  or Codex CLI into App-private tools using the managed Node Runtime Pack. The
  installer records source/digest metadata, reports progress, supports cancel,
  is idempotent and removes partial state on failure. Linux and WSL remain
  manual-install paths in this first phase.
- Installed-but-unauthenticated CLI providers expose an external terminal login
  flow and a one-click recheck. WSL cards expose copyable install/login/recheck
  steps without pretending to provide a Windows-side one-click WSL installer.
- First launch now has a three-step onboarding checklist for mymind root,
  Skill import and Provider readiness. Optional steps can be completed or
  skipped; completion is persisted in App-private settings.

### Security and release notes

- The App continues to run Skills with the current OS user's privileges; static
  inspection, exact digest checks, Runtime readiness, capability declarations
  and audit records are controls and UX, not an OS sandbox.
- Windows/macOS clean-machine and independent security-review evidence remain
  release-host acceptance work and must be recorded in the existing evidence
  documents rather than inferred from Linux unit tests.
