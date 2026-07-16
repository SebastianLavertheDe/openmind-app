# Release Checklist

## Automated Gate

```bash
npm run typecheck
npm test
npm run verify
npm run perf:check
npm run audit:evidence
npm run scale:check
npm run visual:snapshot
npm run provider:e2e:report
npm run package:safety
npm run dist:win
```

- JSONL concurrent append, recovery, large-output chunking and reassembly pass.
- Provider semantic-event and permission-policy contract tests pass.
- Direct-directory routing and legacy ChangeSet compatibility tests pass.
- Integration smoke verifies content, creative projects, WSL path handling, structured skills and forbidden provider flags.
- Production build contains the TypeScript Electron entry, Utility Process and React renderer.
- Legacy DOM renderer and legacy AI/skill process managers are absent.
- Renderer JavaScript chunks stay under the 500 KiB budget.
- Architecture, visual-source, preview-mode and path-boundary evidence is written to `.build/audit-evidence.json`.
- Scale evidence is written to `.build/scale-report.json`.
- Visual snapshot evidence is written to `.build/visual-snapshot-report.json` and `.build/visual-snapshots/`.
- Provider E2E pending/complete status is written to `.build/provider-e2e-report.json`.
- Built/package files are scanned for `.env`, obvious API keys, AI runtime state and user content paths.

## Windows Native

- Open a Windows-local Git project.
- Settings shows usable Windows Claude Code and Codex providers.
- Start read-only, edit and auto sessions.
- Confirm delete/elevation/outside-workspace actions pause before execution.
- Cancel a running Provider and a running skill; verify process trees exit.
- Run an edit task and verify changes appear immediately in the selected project directory.
- Verify destructive and project-external actions still pause for approval.

## Windows To WSL

- Open `\\wsl.localhost\<distro>\...` project.
- Verify Windows-native and WSL Provider diagnostics are independent.
- Run a WSL skill and confirm streaming output.
- Run an edit task and verify it writes directly to the connected WSL project without creating a worktree.
- Verify Windows attachments and project paths remain readable.

## Recovery And Scale

- Restart with completed and failed runs; verify records remain.
- Force-close during a run; verify the run is marked interrupted on restart.
- Open/search a project with 1000 sessions and a long session with tens of thousands of events.
- Run at least three different sessions concurrently and queue a second message in one active session.

## Packaging

- Test the single-file Portable EXE and ZIP build without installation.
- Test the NSIS install/uninstall flow.
- Confirm no `.env`, `.cctools/ai/.runtime/`, Provider state or project content is embedded in the package.
- Record signing status. Unsigned development packages may trigger Windows SmartScreen.
- Record final package evidence in `docs/RELEASE_EVIDENCE.md`.
