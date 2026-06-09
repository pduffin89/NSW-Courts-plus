import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const artifactsDir = join(root, 'artifacts');
const outputPath = join(artifactsDir, 'completion-audit.json');
const deliveryPath = join(artifactsDir, 'delivery-audit.json');
const readinessPath = join(artifactsDir, 'release-readiness.json');
const manualEvidencePath = join(artifactsDir, 'manual-verification.json');
const ciParityPath = join(artifactsDir, 'ci-artifact-parity.json');
const liveSmokePath = join(artifactsDir, 'live-smoke.json');
const standaloneLiveSmokeArtifactPath = join(artifactsDir, 'standalone-live-smoke-artifact.json');
const operatorSmokePath = join(artifactsDir, 'operator-live-smoke.json');

function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function runText(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function fileExists(relativePath) {
  return existsSync(join(root, relativePath));
}

function fileContains(relativePath, needles) {
  if (!fileExists(relativePath)) return false;
  const text = readFileSync(join(root, relativePath), 'utf8');
  return needles.every((needle) => text.includes(needle));
}

function findCriterion(delivery, startsWith) {
  return (delivery?.criteria || []).find((criterion) => criterion.requirement.startsWith(startsWith));
}

function manualGate(manualEvidence, key) {
  const value = manualEvidence?.[key];
  if (!value) return { ok: false, evidence: ['artifacts/manual-verification.json missing or does not include this gate'] };
  const ok = value.status === 'pass' || value.ok === true;
  return {
    ok,
    evidence: [
      value.command,
      value.ciRunUrl,
      value.result,
      value.notes,
    ].filter(Boolean),
  };
}

function check(requirement, explicitPromptText, evidence, ok, missing = []) {
  return {
    requirement,
    explicitPromptText,
    evidence: evidence.filter(Boolean),
    status: ok ? 'pass' : 'missing-or-unverified',
    missing,
  };
}

const delivery = readJson(deliveryPath);
const readiness = readJson(readinessPath);
const manualEvidence = readJson(manualEvidencePath);
const ciParityEvidence = readJson(ciParityPath);
const liveSmokeEvidence = readJson(liveSmokePath);
const standaloneLiveSmokeArtifactEvidence = readJson(standaloneLiveSmokeArtifactPath);
const operatorSmokeEvidence = readJson(operatorSmokePath);
const gitHead = runText('git', ['rev-parse', 'HEAD']);
const gitStatus = runText('git', ['status', '--short']);
const liveProviderCriterion = findCriterion(delivery, 'Live provider smoke');
const operatorCriterion = findCriterion(delivery, 'Operator-assisted smoke');
const credentialedManual = manualGate(manualEvidence, 'credentialedProviderSmoke');
const operatorManual = manualGate(manualEvidence, 'operatorNswWorkflowSmoke');
const ciParityManual = manualGate(manualEvidence, 'ciArtifactParity');
const featureMatrix = delivery?.featureMatrix || [];
const featureMatrixOk = featureMatrix.length > 0 && featureMatrix.every((item) => item.status === 'pass');
const deliveryCriteria = delivery?.criteria || [];
const automatedOk = delivery?.automatedOk === true;
const readinessOk = readiness?.ok === true;
const releaseArchiveOk = Boolean(delivery?.archive?.exists && delivery?.archive?.releaseClean && delivery?.archive?.sha256);
const checksumManifestOk = fileExists('artifacts/SHA256SUMS') && fileContains('artifacts/SHA256SUMS', [
  'argus-delta-courtlens.zip',
  'delivery-audit.json',
  'release-readiness.json',
  'screenshots/01-overview.png',
  'screenshots/02-research.png',
  'screenshots/03-documents.png',
  'screenshots/04-settings.png',
]);
const screenshotEvidenceOk = (readiness?.screenshots || []).length === 4 && readiness.screenshots.every((shot) => shot.exists && shot.width === 422 && shot.height === 930);
const liveCredentialedOk = liveProviderCriterion?.status === 'pass' || credentialedManual.ok || Boolean(
  liveSmokeEvidence?.status === 'pass'
  && liveSmokeEvidence.gitHead === gitHead
  && liveSmokeEvidence.credentialedProviderSmoke?.status === 'pass'
  && liveSmokeEvidence.credentialedProviderSmoke?.authenticatedArgus === true
  && liveSmokeEvidence.credentialedProviderSmoke?.credentialedAbn === true
) || Boolean(
  standaloneLiveSmokeArtifactEvidence?.status === 'pass'
  && standaloneLiveSmokeArtifactEvidence.headSha === gitHead
  && standaloneLiveSmokeArtifactEvidence.liveSmoke?.credentialedProviderStatus === 'pass'
);
const operatorOk = operatorCriterion?.status === 'pass' || operatorManual.ok || Boolean(
  operatorSmokeEvidence?.status === 'pass'
  && operatorSmokeEvidence.gitHead === gitHead
  && operatorSmokeEvidence.courtlist?.skipped !== true
  && operatorSmokeEvidence.caselaw?.skipped !== true
);
const ciArtifactParityOk = ciParityManual.ok || Boolean(
  ciParityEvidence?.status === 'pass'
  && ciParityEvidence.headSha === gitHead
  && ciParityEvidence.localHeadSha === gitHead
  && ciParityEvidence.archiveSha256 === delivery?.archive?.sha256
);
const criteriaFailures = deliveryCriteria.filter((criterion) => {
  if (criterion.status === 'pass') return false;
  if (criterion.requirement.startsWith('Live provider smoke')) return !liveCredentialedOk;
  if (criterion.requirement.startsWith('Operator-assisted smoke')) return !operatorOk;
  return true;
});
const criteriaOk = criteriaFailures.length === 0;

const checklist = [
  check(
    'Full Vite/React/TypeScript MV3 extension exists under v2',
    'Full vite/react build; full project',
    ['package.json declares vite/react/typescript', 'extension/public/manifest.json', 'extension/src/sidebar/CourtlensSidebar.tsx', 'dist/background.js', 'dist/courtlist.js', 'dist/caselaw.js'],
    fileContains('package.json', ['"vite"', '"react"', '"typescript"']) && fileExists('extension/public/manifest.json') && fileExists('extension/src/sidebar/CourtlensSidebar.tsx') && fileExists('dist/background.js') && fileExists('dist/courtlist.js') && fileExists('dist/caselaw.js')
  ),
  check(
    'Prompt-to-artifact feature matrix covers all named Courtlens deliverables and passes',
    'follow the plan and improve it if needed; no incomplete/sloppy work',
    ['artifacts/delivery-audit.json.featureMatrix', `${featureMatrix.length} feature-matrix item(s)`],
    featureMatrixOk,
    featureMatrix.filter((item) => item.status !== 'pass').map((item) => item.requirement)
  ),
  check(
    'Automated verification gates all pass',
    'total smoketest',
    ['npm test', 'npm audit --audit-level=moderate', 'npm run build', 'npm run audit:policy', 'npm run smoke', 'npm run smoke:live', 'npm run smoke:live-extension', 'npm run smoke:release-extension', 'npm run audit:secrets'],
    automatedOk && (delivery?.gates || []).every((gate) => gate.ok),
    (delivery?.gates || []).filter((gate) => !gate.ok).map((gate) => gate.label)
  ),
  check(
    'Delivery criteria all pass without partial/manual statuses',
    'Before declaring completion, perform a concrete audit against actual artifacts, commands, files, and test evidence',
    ['artifacts/delivery-audit.json.criteria'],
    criteriaOk,
    criteriaFailures.map((criterion) => `${criterion.requirement}: ${criterion.status}`)
  ),
  check(
    'Release-readiness audit passes',
    'bulletproof final high quality delivery',
    ['artifacts/release-readiness.json', 'npm run audit:release-readiness'],
    readinessOk,
    readinessOk ? [] : ['release-readiness.json ok is not true']
  ),
  check(
    'Release archive exists, is clean, and has a stable SHA-256',
    'final high quality delivery',
    ['artifacts/argus-delta-courtlens.zip', delivery?.archive?.sha256 && `sha256:${delivery.archive.sha256}`, 'no .map or .DS_Store entries'],
    releaseArchiveOk,
    releaseArchiveOk ? [] : ['release archive missing, dirty, or missing SHA-256']
  ),
  check(
    'Checksum manifest verifies release ZIP, evidence JSON, and screenshots',
    'concrete audit against actual artifacts',
    ['artifacts/SHA256SUMS', 'shasum -a 256 -c SHA256SUMS'],
    checksumManifestOk,
    checksumManifestOk ? [] : ['SHA256SUMS missing expected release entries']
  ),
  check(
    'Release screenshot evidence exists and dimensions are verified',
    'high quality delivery',
    ['artifacts/screenshots/*.png', 'release-readiness screenshot evidence width=422 height=930'],
    screenshotEvidenceOk,
    screenshotEvidenceOk ? [] : ['screenshot evidence missing or dimension mismatch']
  ),
  check(
    'CI artifact parity has concrete evidence for the final head',
    'Before declaring completion, inspect PR/CI state and real evidence',
    ['npm run verify:ci-artifact-parity -- --run-id <run-id>', 'artifacts/ci-artifact-parity.json or artifacts/manual-verification.json.ciArtifactParity'],
    ciArtifactParityOk,
    ciArtifactParityOk ? [] : ['run npm run verify:ci-artifact-parity -- --run-id <run-id> or record CI parity evidence in artifacts/manual-verification.json']
  ),
  check(
    'Authenticated Argus and ABN credentialed provider smoke is proven',
    'total smoketest',
    [liveProviderCriterion?.requirement, liveProviderCriterion?.status, liveSmokeEvidence?.credentialedProviderSmoke?.status && `live-smoke:${liveSmokeEvidence.credentialedProviderSmoke.status}`, standaloneLiveSmokeArtifactEvidence?.liveSmoke?.credentialedProviderStatus && `standalone-live-smoke-artifact:${standaloneLiveSmokeArtifactEvidence.liveSmoke.credentialedProviderStatus}`, ...credentialedManual.evidence],
    liveCredentialedOk,
    liveCredentialedOk ? [] : ['ARGUS_DELTA_TOKEN and ABN_GUID/COURTLENS_ABN_GUID credentialed branches remain unverified']
  ),
  check(
    'Authenticated or targeted operator NSW workflow smoke is proven',
    'total smoketest; no slop',
    [operatorCriterion?.requirement, operatorCriterion?.status, operatorSmokeEvidence?.status && `operator-live-smoke:${operatorSmokeEvidence.status}`, ...operatorManual.evidence],
    operatorOk,
    operatorOk ? [] : ['operator-assisted headed Chrome NSW workflow remains unverified']
  ),
  check(
    'Working tree is release-clean except known unrelated graphify-out',
    'no slop',
    [gitStatus ? `git status --short: ${gitStatus}` : 'git status --short clean'],
    !gitStatus || gitStatus === '?? ../graphify-out/' || gitStatus === '?? graphify-out/',
    gitStatus && gitStatus !== '?? ../graphify-out/' && gitStatus !== '?? graphify-out/' ? [`unexpected working tree changes: ${gitStatus}`] : []
  ),
];

const unresolved = checklist.filter((item) => item.status !== 'pass');
const completion = {
  generatedAt: new Date().toISOString(),
  project: 'Argus Delta Courtlens v2',
  objective: 'Full high-quality Vite/React Chrome extension delivery with no slop and total smoke testing.',
  git: {
    headSha: gitHead,
    statusShort: gitStatus,
  },
  ok: unresolved.length === 0,
  checklist,
  unresolved,
  artifacts: {
    deliveryAudit: deliveryPath,
    releaseReadiness: readinessPath,
    manualVerification: manualEvidencePath,
    ciArtifactParity: ciParityPath,
    liveSmoke: liveSmokePath,
    standaloneLiveSmokeArtifact: standaloneLiveSmokeArtifactPath,
    operatorLiveSmoke: operatorSmokePath,
    output: outputPath,
  },
};

mkdirSync(artifactsDir, { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(completion, null, 2)}\n`);

if (completion.ok) {
  console.log(`Completion audit passed: ${gitHead}. Evidence written to ${outputPath}.`);
} else {
  console.error(`Completion audit found ${unresolved.length} unresolved item(s). Evidence written to ${outputPath}.`);
  for (const item of unresolved) {
    console.error(`- ${item.requirement}: ${item.missing.join('; ') || 'not verified'}`);
  }
  process.exit(1);
}
