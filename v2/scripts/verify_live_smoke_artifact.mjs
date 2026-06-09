import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const repoRoot = join(root, '..');
const workflowName = 'Courtlens v2 CI';
const artifactName = 'argus-delta-courtlens-live-smoke';
const evidencePath = join(root, 'artifacts', 'standalone-live-smoke-artifact.json');

function fail(message) {
  throw new Error(`Standalone live-smoke artifact verification failed: ${message}`);
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
  const parsed = { runId: process.env.COURTLENS_CI_RUN_ID || '', requireCredentialed: false, allowDifferentHead: false, requireWorkflowDispatch: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--run-id') parsed.runId = argv[++index] || '';
    else if (arg === '--require-credentialed') parsed.requireCredentialed = true;
    else if (arg === '--allow-different-head') parsed.allowDifferentHead = true;
    else if (arg === '--require-workflow-dispatch') parsed.requireWorkflowDispatch = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: npm run verify:live-smoke-artifact -- [--run-id <id>] [--require-credentialed] [--allow-different-head] [--require-workflow-dispatch]\n\nVerifies the standalone ${artifactName} artifact uploaded by ${workflowName}. Use --require-workflow-dispatch for credentialed/manual release reruns.`);
      process.exit(0);
    } else fail(`unknown argument ${arg}`);
  }
  return parsed;
}

function latestSuccessfulRun() {
  const json = run('gh', [
    'run', 'list',
    '--workflow', workflowName,
    '--status', 'success',
    '--limit', '1',
    '--json', 'databaseId,headSha,conclusion,status,url,event',
  ], { cwd: repoRoot });
  const runs = JSON.parse(json);
  if (!Array.isArray(runs) || runs.length === 0) fail(`no successful ${workflowName} run found`);
  return runs[0];
}

function runDetails(runId) {
  const json = run('gh', ['run', 'view', String(runId), '--json', 'databaseId,headSha,conclusion,status,url,event'], { cwd: repoRoot });
  return JSON.parse(json);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function localHead() {
  return run('git', ['rev-parse', 'HEAD']).trim();
}

const args = parseArgs(process.argv.slice(2));
const runInfo = args.runId ? runDetails(args.runId) : latestSuccessfulRun();
if (runInfo.status !== 'completed' || runInfo.conclusion !== 'success') {
  fail(`run ${runInfo.databaseId || args.runId} is not completed/success: ${runInfo.status}/${runInfo.conclusion}`);
}
if (args.requireWorkflowDispatch && runInfo.event !== 'workflow_dispatch') {
  fail(`run ${runInfo.databaseId || args.runId} event ${runInfo.event || 'unknown'} is not workflow_dispatch`);
}
const currentHead = localHead();
if (!args.allowDifferentHead && runInfo.headSha !== currentHead) {
  fail(`CI run head ${runInfo.headSha} does not match local HEAD ${currentHead}; pass --allow-different-head intentionally`);
}

const tmp = mkdtempSync(join(tmpdir(), 'courtlens-live-smoke-artifact-'));
try {
  run('gh', ['run', 'download', String(runInfo.databaseId), '--name', artifactName, '--dir', tmp], { cwd: repoRoot });
  const liveSmokePath = join(tmp, 'live-smoke.json');
  if (!existsSync(liveSmokePath)) fail(`${artifactName} did not contain live-smoke.json`);
  const liveSmoke = readJson(liveSmokePath);
  if (liveSmoke?.gitHead !== runInfo.headSha) fail(`live-smoke gitHead ${liveSmoke?.gitHead} does not match run head ${runInfo.headSha}`);
  if (liveSmoke?.status !== 'pass') fail(`live-smoke status ${liveSmoke?.status} is not pass`);
  const credentialedStatus = liveSmoke?.credentialedProviderSmoke?.status;
  if (args.requireCredentialed && credentialedStatus !== 'pass') {
    fail(`credentialed provider smoke status ${credentialedStatus} is not pass`);
  }
  const evidence = {
    generatedAt: new Date().toISOString(),
    status: 'pass',
    command: `npm run verify:live-smoke-artifact -- --run-id ${runInfo.databaseId}${args.requireCredentialed ? ' --require-credentialed' : ''}${args.requireWorkflowDispatch ? ' --require-workflow-dispatch' : ''}`,
    runId: String(runInfo.databaseId),
    runUrl: runInfo.url,
    runEvent: runInfo.event,
    requiredWorkflowDispatch: args.requireWorkflowDispatch,
    headSha: runInfo.headSha,
    localHeadSha: currentHead,
    artifactName,
    liveSmoke: {
      status: liveSmoke.status,
      credentialedProviderStatus: credentialedStatus,
      credentialsPresent: liveSmoke.credentialsPresent,
      checkCount: Array.isArray(liveSmoke.checks) ? liveSmoke.checks.length : null,
    },
  };
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Standalone live-smoke artifact verified: run ${runInfo.databaseId} (${runInfo.headSha}) ${runInfo.url}`);
  console.log(`live-smoke credentialed provider status ${credentialedStatus}`);
  console.log(`Evidence written to ${evidencePath}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
