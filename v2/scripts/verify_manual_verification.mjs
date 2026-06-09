import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = process.cwd();
const artifactsDir = join(root, 'artifacts');
const manualPath = join(artifactsDir, 'manual-verification.json');
const outputPath = join(artifactsDir, 'manual-verification-audit.json');
const releaseZipPath = join(artifactsDir, 'argus-delta-courtlens.zip');
const gateKeys = ['ciArtifactParity', 'credentialedProviderSmoke', 'operatorNswWorkflowSmoke'];

function fail(message) {
  throw new Error(`Manual verification audit failed: ${message}`);
}

function parseArgs(argv) {
  const parsed = { require: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--require-ci-parity') parsed.require.push('ciArtifactParity');
    else if (arg === '--require-credentialed') parsed.require.push('credentialedProviderSmoke');
    else if (arg === '--require-operator') parsed.require.push('operatorNswWorkflowSmoke');
    else if (arg === '--require-all') parsed.require.push(...gateKeys);
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: npm run verify:manual-verification -- [--require-ci-parity] [--require-credentialed] [--require-operator] [--require-all]\n\nValidates artifacts/manual-verification.json for current HEAD, release ZIP SHA-256, required gate evidence, and obvious secret leakage.`);
      process.exit(0);
    } else fail(`unknown argument ${arg}`);
  }
  parsed.require = [...new Set(parsed.require)];
  return parsed;
}

function gitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) fail('could not determine current git HEAD');
  return result.stdout.trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function findPotentialSecrets(text) {
  const patterns = [
    /ARGUS_DELTA_TOKEN\s*=\s*['\"]?(?!\*{3})([^\s'\"]{12,})/gi,
    /(?:ABN_GUID|COURTLENS_ABN_GUID)\s*=\s*['\"]?(?!\*{3})([^\s'\"]{12,})/gi,
    /bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
    /api[_-]?key\s*[:=]\s*['\"]?(?!\*{3})[A-Za-z0-9._~+/=-]{16,}/gi,
  ];
  const findings = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) findings.push(match[0]);
  }
  return findings;
}

function evidenceHead(payload) {
  return payload?.gitHead || payload?.headSha || payload?.releaseGitHead || null;
}

function gateOk(value) {
  return value?.status === 'pass' || value?.ok === true;
}

function validateGate(payload, key, required, errors) {
  const value = payload?.[key];
  if (!value) {
    if (required) errors.push(`${key} is required but missing`);
    return { key, present: false, ok: false, required };
  }
  const ok = gateOk(value);
  if (!ok) errors.push(`${key} is present but not pass/ok`);
  if (!value.command && !value.ciRunUrl) errors.push(`${key} must include command or ciRunUrl`);
  if (!value.result && !value.notes) errors.push(`${key} must include result or notes`);
  return { key, present: true, ok, required, command: value.command || null, ciRunUrl: value.ciRunUrl || null };
}

const args = parseArgs(process.argv.slice(2));
const currentHead = gitHead();
if (!existsSync(manualPath)) fail('artifacts/manual-verification.json is missing');
const rawText = readFileSync(manualPath, 'utf8');
const secrets = findPotentialSecrets(rawText);
if (secrets.length > 0) fail(`potential secret values found in manual evidence (${secrets.length})`);
if (!existsSync(releaseZipPath)) fail('artifacts/argus-delta-courtlens.zip is missing; run npm run package:extension first');
const manual = readJson(manualPath);
const manualHead = evidenceHead(manual);
const actualReleaseZipSha256 = sha256(releaseZipPath);
const recordedReleaseZipSha256 = manual.releaseZipSha256 || manual.archiveSha256 || manual.release?.zipSha256 || null;
const errors = [];
if (!manualHead) errors.push('manual-verification.json must include gitHead or headSha');
else if (manualHead !== currentHead) errors.push(`manual-verification head ${manualHead} does not match current HEAD ${currentHead}`);
if (!recordedReleaseZipSha256) errors.push('manual-verification.json must include releaseZipSha256 or archiveSha256');
else if (recordedReleaseZipSha256 !== actualReleaseZipSha256) errors.push(`manual-verification release ZIP SHA ${recordedReleaseZipSha256} does not match actual ${actualReleaseZipSha256}`);

const gateResults = gateKeys.map((key) => validateGate(manual, key, args.require.includes(key), errors));
if (errors.length > 0) fail(errors.join('; '));

const audit = {
  generatedAt: new Date().toISOString(),
  status: 'pass',
  command: `npm run verify:manual-verification${args.require.length ? ` -- ${args.require.map((key) => ({ ciArtifactParity: '--require-ci-parity', credentialedProviderSmoke: '--require-credentialed', operatorNswWorkflowSmoke: '--require-operator' }[key])).join(' ')}` : ''}`,
  headSha: currentHead,
  releaseZipSha256: actualReleaseZipSha256,
  requiredGates: args.require,
  gates: gateResults,
};
mkdirSync(artifactsDir, { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(audit, null, 2)}\n`);
console.log(`Manual verification evidence verified for HEAD ${currentHead}`);
console.log(`Evidence written to ${outputPath}`);
