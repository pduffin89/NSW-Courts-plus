# Manual and credentialed verification runbook

Use this runbook when completing release gates that cannot run with public, non-secret CI alone.

Do not paste secrets into logs, screenshots, issues, commits, or release notes. Record only whether a secret was present and whether the command passed.

## Evidence summary template

```text
Release git HEAD:
Release ZIP SHA-256:
CI run URL:
CI artifact parity command:
CI artifact parity result:

Credentialed Argus smoke:
- ARGUS_DELTA_TOKEN configured in environment or GitHub secret: yes/no
- Command/run URL:
- Result:
- Notes, without token value:

Credentialed ABN name-search smoke:
- ABN_GUID or COURTLENS_ABN_GUID configured in environment or GitHub secret: yes/no
- Command/run URL:
- Result:
- Notes, without GUID value:

Operator NSW workflow smoke:
- Operator profile path, if reused:
- Online Registry URL tested:
- Caselaw URL tested:
- Documents tab tested: yes/no
- Command:
- Result:
- Notes, without client-confidential details:
```

## Credentialed provider smoke

### Local credentialed run

```bash
cd '/Users/perry/Local Projects/AD Chrome Extension/v2'
ARGUS_DELTA_TOKEN='...' ABN_GUID='...' npm run smoke:live
ARGUS_DELTA_TOKEN='...' ABN_GUID='...' npm run package:extension
```

Acceptable environment variable alternatives:

- `ARGUS_DELTA_TOKEN` for authenticated Argus Delta live search.
- `ABN_GUID` or `COURTLENS_ABN_GUID` for ABN Lookup name-search JSONP.

Expected pass evidence:

- Argus health succeeds.
- Unauthenticated Argus search is rejected as expected.
- Authenticated Argus search returns `200` without printing the token.
- Authenticated Argus short-query validation returns `400`.
- ABN current/history public pages pass.
- ABN name-search JSONP returns the stable public ATO record.
- `artifacts/delivery-audit.json` reports the live provider criterion as `pass`, not `partial-external-credential-needed`.

### GitHub credentialed run

1. Configure repository secrets:
   - `ARGUS_DELTA_TOKEN`
   - `ABN_GUID` or `COURTLENS_ABN_GUID`
2. Manually dispatch `Courtlens v2 CI` from GitHub Actions.
3. Verify the run is successful.
4. Verify CI artifact parity:

```bash
npm run verify:ci-artifact-parity -- --run-id <run-id>
```

Expected pass evidence:

- Workflow event is `workflow_dispatch`.
- Full delivery job passes.
- Standalone live-smoke job passes.
- `delivery-audit.json` in the CI artifact records the credential branches as present.
- Release ZIP SHA equals local release ZIP SHA.

## Operator-assisted NSW workflow smoke

Run this when a login-specific Online Registry workflow, a target matter, or a human browser session must be proven.

```bash
cd '/Users/perry/Local Projects/AD Chrome Extension/v2'
npm run package:extension
npm run smoke:operator -- --profile-dir artifacts/operator-chrome-profile
```

Useful variants:

```bash
npm run smoke:operator -- --courtlist-url 'https://onlineregistry.lawlink.nsw.gov.au/content/court-lists' --caselaw-url 'https://www.caselaw.nsw.gov.au/decision/...'
npm run smoke:operator -- --skip-documents
ARGUS_DELTA_TOKEN='...' npm run smoke:operator
```

Expected pass evidence:

- Chromium launches with the real unpacked `dist/` extension.
- Operator reaches a live NSW Online Registry matter list.
- Courtlens row buttons appear.
- Clicking `Courtlens` opens the Shadow DOM sidebar.
- Overview, Research, and Documents tabs are visible.
- Unless `--skip-documents` is used, Documents tab generates PDF attachments.
- If a Caselaw URL is supplied, Courtlens launcher/sidebar mounts on that live page.

## Screenshot and privacy rules

- Use fixture-generated screenshots in `artifacts/screenshots/` for store submissions when possible.
- Do not capture real tokens, ABN GUIDs, client email addresses, confidential matter names, or non-public filings.
- If a real live page must be shown, crop or redact confidential details before release records are shared.

## Machine-readable manual evidence

`npm run smoke:live` writes `artifacts/live-smoke.json`; when both `ARGUS_DELTA_TOKEN` and `ABN_GUID`/`COURTLENS_ABN_GUID` are present and pass, `npm run audit:completion` can clear the credentialed provider gate from that artifact. `npm run verify:live-smoke-artifact -- --run-id <run-id> --require-credentialed` writes `artifacts/standalone-live-smoke-artifact.json` and can also clear that gate after a credentialed CI rerun. `npm run smoke:operator` writes `artifacts/operator-live-smoke.json` after a successful headed operator session; `npm run verify:operator-smoke-evidence` writes `artifacts/operator-smoke-verification.json` after validating it for the current HEAD. `npm run verify:ci-artifact-parity -- --run-id <run-id>` writes `artifacts/ci-artifact-parity.json` when parity passes. `npm run audit:completion` reads those files plus optional machine-readable evidence from `artifacts/manual-verification.json`, but manual evidence only counts after `npm run verify:manual-verification -- --require-all` writes current-head `artifacts/manual-verification-audit.json`. Create manual evidence only after running the relevant commands; do not include secret values.

Example shape:

```json
{
  "headSha": "<current git HEAD>",
  "releaseZipSha256": "<artifacts/argus-delta-courtlens.zip sha256>",
  "ciArtifactParity": {
    "status": "pass",
    "command": "npm run verify:ci-artifact-parity -- --run-id 123456789",
    "ciRunUrl": "https://github.com/pduffin89/NSW-Courts-plus/actions/runs/123456789",
    "result": "passed for HEAD ... and ZIP sha256 ..."
  },
  "credentialedProviderSmoke": {
    "status": "pass",
    "command": "ARGUS_DELTA_TOKEN=*** ABN_GUID=*** npm run smoke:live",
    "result": "authenticated Argus and ABN name-search branches passed; no secret values logged"
  },
  "operatorNswWorkflowSmoke": {
    "status": "pass",
    "command": "npm run smoke:operator -- --profile-dir artifacts/operator-chrome-profile",
    "result": "operator verified live Online Registry and Caselaw sidebar workflows"
  }
}
```

## Completion rule

Only clear the external/manual gates when the evidence summary is filled out with concrete command output or CI run URLs, `npm run verify:manual-verification -- --require-all` passes, and no unresolved credential/operator items remain. `npm run audit:completion` should pass before the thread goal is marked complete.
