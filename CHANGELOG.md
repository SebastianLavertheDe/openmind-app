# Changelog

## Unreleased

### Distribution UX

- Skills Center now accepts public HTTPS Git repositories, ZIP files and local
  directories through an inspect → confirm → install flow. The UI shows the
  Manifest identity, digest, file count, warnings and issues before import,
  rejects credential-bearing/non-HTTPS Git URLs and supports cancelling a Git
  inspection.
- Installed Skill lifecycle flags have been removed. An explicit successful
  install creates one registry record per Skill; every list/run/bridge path
  derives usability from the managed package path, Manifest identity and exact
  digest, while Runtime preparation remains an execution-time check.
- Complete Git-source installs now write an atomic local receipt containing the
  normalized repository, resolved revision and full package snapshot. Startup
  requires a valid OpenMind data directory; official `cctools-skills` packages
  are optional. Receipt, revision and digest
  disagreements are reported by Skill Center and enforced at execution rather
  than forcing an existing user back through setup. Startup never contacts Git.
- Installed Skills can now be enabled or disabled from Skill Center. The
  root-scoped preference controls future AI conversations and new execution
  submissions; each conversation persists its exact Skill definition and
  package digest snapshot, so toggling a Skill never changes an existing
  conversation or restarts its Provider process. Package integrity is still
  checked at execution time, and forks inherit the source conversation's
  snapshot. Only Agent packages enter a conversation snapshot; Process and
  Workflow packages remain on their Broker and Automation execution paths.
- Settings can install Claude Code through its official HTTPS native installer
  or Codex CLI into App-private tools using the managed Node Runtime Pack. The
  installer records source/digest metadata, reports progress, supports cancel,
  is idempotent and removes partial state on failure. Linux and WSL remain
  manual-install paths in this first phase.
- Installed-but-unauthenticated CLI providers expose an external terminal login
  flow and a one-click recheck. WSL cards expose copyable install/login/recheck
  steps without pretending to provide a Windows-side one-click WSL installer.
- First launch now presents one setup step at a time for the OpenMind data
  directory, optional Provider readiness and
  final confirmation. Each completed step slides left into the next; Provider
  setup may be skipped and Skills are no longer checked during setup.
- The default Skills switch in Settings installs official Skills and enables
  the four built-in schedules. Turning it off stops their jobs before removing
  the packages, preserving generated content, personal settings and custom
  schedules. Creative and Daily Brief navigation appear only while the switch
  is on.

### Security and release notes

- The App continues to run Skills with the current OS user's privileges; static
  inspection, exact digest checks, Runtime readiness, capability declarations
  and audit records are controls and UX, not an OS sandbox.
- Windows/macOS clean-machine and independent security-review evidence remain
  release-host acceptance work and must be recorded in the existing evidence
  documents rather than inferred from Linux unit tests.
