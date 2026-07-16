# Provider E2E Checklist

This checklist backs `todo.md` section 18.2. Unit and contract tests are not enough here; each row must be executed with the packaged Windows build.

Generate the current evidence status with:

```bash
npm run provider:e2e:report
```

The command writes `.build/provider-e2e-report.json`. It is intentionally non-blocking by default because pending rows require real Windows/WSL Provider accounts and GUI execution. After filling this checklist with dated evidence, run strict mode:

```bash
CCTOOLS_PROVIDER_E2E_STRICT=1 npm run provider:e2e:report
```

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
