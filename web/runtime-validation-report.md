# Runtime Validation Report

**Generated**: 2026-10-02T17:45:55+07:00  
**Target**: `D:\Dormitry-web\web`

## Summary

| Step | Status | Exit Code | Details |
|------|--------|-----------|---------|
| Startup | PASS | 0 | API health returned `{"status":"ok","database":"connected"}`; isolated integration-test API instances also passed readiness checks. |
| Build | PASS | 0 | `npm.cmd run build`; TypeScript checks and Vite production build succeeded. Vite reported the existing >500 kB bundle-size advisory. |
| Lint | PASS | 0 | `npm.cmd run lint`; no diagnostics. |
| Integration Tests | PASS | 0 | `npm.cmd test`; 15 passed, 0 failed, 0 skipped across the unit/schema tests and three PostgreSQL-backed portal API flows. |
| Browser Smoke | PASS | 0 | Playwright 1.63.0 installed Chromium and captured the running SPA at `http://127.0.0.1:5174/`; the temporary screenshot was removed. |
| Dependency Audit | PASS | 0 | `npm.cmd audit --omit=dev`; 0 vulnerabilities. |

**Overall**: NEEDS_SIGNOFF — the tenant invoice isolation, print-data, upload/download, and upload-limit flows passed against PostgreSQL. Browser validation confirmed SPA rendering, but did not automate the signed-in tenant UI flow. Payment evidence remains a submission for staff review, not a confirmed payment.

## Environment

- Docker: UNAVAILABLE — `Get-Command docker -ErrorAction SilentlyContinue` returned no command; no Docker-based infrastructure was used. The configured local PostgreSQL service was available.
- Node.js: AVAILABLE — `v22.18.0`.
- Playwright: AVAILABLE — `npx.cmd --yes playwright --version` returned `Version 1.63.0`; Chromium installation and browser capture exited successfully.
- Infra tier: PRIMARY (real PostgreSQL configured in `.env`); tests seed unique temporary records and remove them afterward.
- Browser tier: Chromium smoke only; a browser-driven tenant journey remains unverified.

## Integration Journeys

1. Tenant login, dashboard read-back, printable invoice data, other-tenant invoice denial, and anonymous access denial.
2. Reject invalid file content, upload a valid PDF, download and read it back, verify cross-tenant/anonymous download denial, and verify dashboard persistence.
3. Submit six simultaneous uploads and verify exactly five succeed and one receives HTTP 409; verify oversized upload receives HTTP 413 and read back the five persisted files.

Test files:
- `tests/portal-isolation.test.ts`
- `tests/portal-evidence.test.ts`
- `tests/portal-evidence-limits.test.ts`

## Known Gaps

- A dedicated Playwright test that signs in as a tenant and exercises the rendered portal UI was not added; the three new end-to-end API flows exercise real HTTP, authentication, and PostgreSQL.
- File storage is local/private and has no antivirus scanning or cloud object-storage integration. Configure a protected storage path, access controls, backup, and retention before production.
- Attaching a receipt does not confirm receipt of funds or create a payment ledger entry; staff must perform the normal payment confirmation workflow.
