# Provider E2E Checklist

This checklist backs `todo.md` section 18.2. Unit and contract tests are not enough here; each row must be executed with the packaged Windows build.

Generate the current evidence status with:

```bash
npm run provider:e2e:report
```

The command writes `.build/provider-e2e-report.json`. It is intentionally non-blocking by default because pending rows require real Windows/WSL Provider accounts and GUI execution. After filling this checklist with dated evidence, run strict mode:

```bash
OPENMIND_PROVIDER_E2E_STRICT=1 npm run provider:e2e:report
```

The report counts only the two status cells in each checklist row (Windows
native and WSL); prose mentions of `pending` are not evidence cells. Every
status cell must be `passed`, and the row's Evidence column must be non-empty,
before strict mode can pass. Passed rows must use the following machine-readable
fields; placeholder values such as `done` or `ok` are rejected:

```text
date=2026-08-07; package=OpenMind-Portable-1.0.24-win-x64.exe; project=C:\Users\qa\openmind-provider-fixture; evidence=https://evidence.example.test/provider/claude-simple-prompt.zip
```

`date` must be a real calendar date, `package` must be a package filename,
`project` must be a concrete path, and `evidence` must be a URL, path or
external report identifier. Duplicate evidence keys and impossible dates are
rejected. The contract fixture can be checked with
`npm run provider:e2e:contract`; it never edits this pending checklist.

## Claude Code

| Case | Windows native project | WSL project | Evidence |
| --- | --- | --- | --- |
| Provider detection shows version and login status | pending | pending | |
| Simple prompt streams visible text | pending | pending | |
| Tool call renders as a grouped tool card | pending | pending | |
| Read-only permission blocks writes | pending | pending | |
| Edit permission asks before delete/outside path | pending | pending | |
| Auto permission still asks before dangerous actions | pending | pending | |
| Cancel running request kills the full process tree | pending | pending | |
| Failed login shows actionable `/login` message | pending | pending | |

## Codex CLI App Server

| Case | Windows native project | WSL project | Evidence |
| --- | --- | --- | --- |
| Provider detection shows version and app-server compatibility | pending | pending | |
| Simple prompt streams visible text | pending | pending | |
| Tool call renders as a grouped tool card | pending | pending | |
| Approval request pauses the run before execution | pending | pending | |
| Cancel running request kills the full process tree | pending | pending | |
| Protocol mismatch blocks start with diagnostics | pending | pending | |

## Notes

- Windows-native Provider state and WSL Provider state must be diagnosed separately.
- Do not mark `AUDIT-AI-E2E-*` done until this file contains concrete dates, package name, project path and evidence notes.
