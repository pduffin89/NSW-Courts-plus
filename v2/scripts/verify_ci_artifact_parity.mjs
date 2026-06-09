import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = process.cwd();
const repoRoot = join(root, '..');
const workflowName = 'Courtlens v2 CI';
const artifactName = 'argus-delta-courtlens';
const expectedFiles = [
  'argus-delta-courtlens.zip',
  'delivery-audit.json',
  'release-readiness.json',
  'SHA256SUMS',
];
const expectedScreenshots = [
  'screenshots/01-overview.png',
  'screenshots/02-research.png',
  'screenshots/03-documents.png',
  'screenshots/04-settings.png',
];

function fail(message) {
  throw new Error(`CI artifact parity failed: ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: options.encoding || 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
    maxBuffer: options.maxBuffer || 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const details = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    fail(`${command} ${args.join(' ')} exited ${result.status}${details ? `: ${details}` : ''}`);
  }
  return result.stdout;
}

function parseArgs(argv) {
  const parsed = { runId: process.env.COURTLENS_CI_RUN_ID || '', allowDifferentHead: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--run-id') parsed.runId = argv[++index] || '';
    else if (arg === '--allow-different-head') parsed.allowDifferentHead = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: npm run verify:ci-artifact-parity -- [--run-id <id>] [--allow-different-head]\n\nRequires GitHub CLI authentication. Run after npm run package:extension.\nBy default, compares local artifacts to the latest completed ${workflowName} run.`);
      process.exit(0);
    } else fail(`unknown argument ${arg}`);
  }
  return parsed;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assertExists(path) {
  if (!existsSync(path)) fail(`${path} is missing`);
}

function latestSuccessfulRun() {
  const json = run('gh', [
    'run', 'list',
    '--workflow', workflowName,
    '--status', 'success',
    '--limit', '1',
    '--json', 'databaseId,headSha,conclusion,status,url',
  ], { cwd: repoRoot });
  const runs = JSON.parse(json);
  if (!Array.isArray(runs) || runs.length === 0) fail(`no successful ${workflowName} run found`);
  return runs[0];
}

function runDetails(runId) {
  const json = run('gh', ['run', 'view', String(runId), '--json', 'databaseId,headSha,conclusion,status,url'], { cwd: repoRoot });
  return JSON.parse(json);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function pngDimensions(path) {
  const buffer = readFileSync(path);
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') fail(`${path} is not a PNG file`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function verifyChecksums(dir) {
  const sumsPath = join(dir, 'SHA256SUMS');
  const lines = readFileSync(sumsPath, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean);
  const seen = new Set();
  for (const line of lines) {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/i);
    if (!match) fail(`invalid checksum line in ${sumsPath}: ${line}`);
    const [, expectedSha, relativePath] = match;
    const filePath = join(dir, relativePath);
    assertExists(filePath);
    const actualSha = sha256(filePath);
    if (actualSha !== expectedSha) fail(`${relativePath} checksum mismatch: expected ${expectedSha}, got ${actualSha}`);
    seen.add(relativePath);
  }
  for (const file of [...expectedFiles.filter((name) => name !== 'SHA256SUMS'), ...expectedScreenshots]) {
    if (!seen.has(file)) fail(`SHA256SUMS does not include ${file}`);
  }
}

const args = parseArgs(process.argv.slice(2));
const runInfo = args.runId ? runDetails(args.runId) : latestSuccessfulRun();
if (runInfo.status !== 'completed' || runInfo.conclusion !== 'success') {
  fail(`run ${runInfo.databaseId || args.runId} is not completed/success: ${runInfo.status}/${runInfo.conclusion}`);
}

for (const file of expectedFiles) assertExists(join(root, 'artifacts', file));
for (const screenshot of expectedScreenshots) assertExists(join(root, 'artifacts', screenshot));
verifyChecksums(join(root, 'artifacts'));

const localAudit = readJson(join(root, 'artifacts', 'delivery-audit.json'));
const localReadiness = readJson(join(root, 'artifacts', 'release-readiness.json'));
const localHead = localAudit?.git?.headSha;
if (!localHead || localReadiness?.gitHead !== localHead) fail('local audit/readiness git heads are missing or inconsistent');
if (!args.allowDifferentHead && runInfo.headSha !== localHead) {
  fail(`CI run head ${runInfo.headSha} does not match local audit head ${localHead}; rerun npm run package:extension or pass --allow-different-head intentionally`);
}

const tmp = mkdtempSync(join(tmpdir(), 'courtlens-ci-artifacts-'));
try {
  run('gh', ['run', 'download', String(runInfo.databaseId), '--name', artifactName, '--dir', tmp], { cwd: repoRoot });
  for (const file of expectedFiles) assertExists(join(tmp, file));
  for (const screenshot of expectedScreenshots) assertExists(join(tmp, screenshot));
  verifyChecksums(tmp);

  const ciAudit = readJson(join(tmp, 'delivery-audit.json'));
  const ciReadiness = readJson(join(tmp, 'release-readiness.json'));
  if (ciAudit?.git?.headSha !== runInfo.headSha) fail(`CI audit head ${ciAudit?.git?.headSha} does not match run head ${runInfo.headSha}`);
  if (ciReadiness?.gitHead !== runInfo.headSha) fail(`CI readiness head ${ciReadiness?.gitHead} does not match run head ${runInfo.headSha}`);
  if (!ciAudit?.automatedOk) fail('CI delivery audit automatedOk is not true');
  if (!ciReadiness?.ok) fail('CI release readiness ok is not true');

  const localArchiveSha = localAudit?.archive?.sha256;
  const ciArchiveSha = ciAudit?.archive?.sha256;
  const localReadinessArchiveSha = localReadiness?.archive?.sha256;
  const ciReadinessArchiveSha = ciReadiness?.archive?.sha256;
  const localZipSha = sha256(join(root, 'artifacts', 'argus-delta-courtlens.zip'));
  const ciZipSha = sha256(join(tmp, 'argus-delta-courtlens.zip'));
  if (localZipSha !== ciZipSha) fail(`release ZIP differs between local and CI: local ${localZipSha}, CI ${ciZipSha}`);
  const screenshotComparisons = expectedScreenshots.map((screenshot) => ({
    screenshot,
    localSha: sha256(join(root, 'artifacts', screenshot)),
    ciSha: sha256(join(tmp, screenshot)),
    localDimensions: pngDimensions(join(root, 'artifacts', screenshot)),
    ciDimensions: pngDimensions(join(tmp, screenshot)),
  }));
  for (const comparison of screenshotComparisons) {
    const expectedDimensions = { width: 422, height: 930 };
    if (JSON.stringify(comparison.localDimensions) !== JSON.stringify(expectedDimensions)) {
      fail(`${comparison.screenshot} local dimensions ${JSON.stringify(comparison.localDimensions)} do not match ${JSON.stringify(expectedDimensions)}`);
    }
    if (JSON.stringify(comparison.ciDimensions) !== JSON.stringify(expectedDimensions)) {
      fail(`${comparison.screenshot} CI dimensions ${JSON.stringify(comparison.ciDimensions)} do not match ${JSON.stringify(expectedDimensions)}`);
    }
  }
  for (const [label, value] of [
    ['local audit archive sha', localArchiveSha],
    ['CI audit archive sha', ciArchiveSha],
    ['local readiness archive sha', localReadinessArchiveSha],
    ['CI readiness archive sha', ciReadinessArchiveSha],
  ]) {
    if (value !== localZipSha) fail(`${label} ${value} does not match release ZIP ${localZipSha}`);
  }

  const evidence = {
    generatedAt: new Date().toISOString(),
    status: 'pass',
    command: `npm run verify:ci-artifact-parity -- --run-id ${runInfo.databaseId}`,
    runId: String(runInfo.databaseId),
    runUrl: runInfo.url,
    headSha: runInfo.headSha,
    localHeadSha: localHead,
    archiveSha256: localZipSha,
    ciArchiveSha256: ciZipSha,
    screenshotComparisons,
  };
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  writeFileSync(join(root, 'artifacts', 'ci-artifact-parity.json'), `${JSON.stringify(evidence, null, 2)}\n`);

  console.log(`CI artifact parity passed: run ${runInfo.databaseId} (${runInfo.headSha}) ${runInfo.url}`);
  console.log(`argus-delta-courtlens.zip sha256 ${localZipSha}`);
  for (const comparison of screenshotComparisons) console.log(`${comparison.screenshot} local sha256 ${comparison.localSha}; CI sha256 ${comparison.ciSha}; dimensions ${comparison.localDimensions.width}x${comparison.localDimensions.height}`);
  console.log(`local evidence: ${basename('delivery-audit.json')} and ${basename('release-readiness.json')} verify head ${localHead} and archive ${localZipSha}`);
  console.log(`CI evidence: ${basename('delivery-audit.json')} and ${basename('release-readiness.json')} verify head ${runInfo.headSha} and archive ${ciZipSha}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
