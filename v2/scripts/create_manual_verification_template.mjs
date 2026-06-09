import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = process.cwd();
const artifactsDir = join(root, 'artifacts');
const archivePath = join(artifactsDir, 'argus-delta-courtlens.zip');
const outputPath = join(artifactsDir, 'manual-verification.json');

function fail(message) {
  throw new Error(`Manual verification template failed: ${message}`);
}

function parseArgs(argv) {
  const parsed = { force: false };
  for (const arg of argv) {
    if (arg === '--force') parsed.force = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: npm run create:manual-verification-template -- [--force]\n\nCreates artifacts/manual-verification.json with current HEAD and release ZIP SHA-256 placeholders. Does not include secrets.`);
      process.exit(0);
    } else fail(`unknown argument ${arg}`);
  }
  return parsed;
}

function gitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) fail('could not determine current git HEAD');
  return result.stdout.trim();
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const args = parseArgs(process.argv.slice(2));
if (!existsSync(archivePath)) fail('artifacts/argus-delta-courtlens.zip is missing; run npm run package:extension first');
if (existsSync(outputPath) && !args.force) fail('artifacts/manual-verification.json already exists; pass --force to overwrite');

const template = {
  headSha: gitHead(),
  releaseZipSha256: sha256(archivePath),
  generatedBy: 'npm run create:manual-verification-template',
  instructions: [
    'Replace placeholder statuses/results only after running the referenced verification commands.',
    'Do not paste ARGUS_DELTA_TOKEN, ABN_GUID, COURTLENS_ABN_GUID, client data, or confidential matter details.',
    'After editing, run: npm run verify:manual-verification -- --require-all',
  ],
  ciArtifactParity: {
    status: 'pending',
    command: 'npm run verify:ci-artifact-parity -- --run-id <run-id> --require-workflow-dispatch',
    ciRunUrl: 'https://github.com/pduffin89/NSW-Courts-plus/actions/runs/<run-id>',
    result: 'TODO: record pass/fail, current HEAD, and release ZIP SHA without secrets',
  },
  credentialedProviderSmoke: {
    status: 'pending',
    command: 'npm run verify:live-smoke-artifact -- --run-id <run-id> --require-credentialed --require-workflow-dispatch',
    ciRunUrl: 'https://github.com/pduffin89/NSW-Courts-plus/actions/runs/<run-id>',
    result: 'TODO: confirm authenticated Argus and credentialed ABN name-search branches passed; do not include token/GUID values',
  },
  operatorNswWorkflowSmoke: {
    status: 'pending',
    command: 'npm run smoke:operator -- --profile-dir artifacts/operator-chrome-profile && npm run verify:operator-smoke-evidence',
    result: 'TODO: confirm headed Online Registry and Caselaw operator workflows passed without confidential details',
  },
};

mkdirSync(artifactsDir, { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(template, null, 2)}\n`);
console.log(`Manual verification template written to ${outputPath}`);
console.log(`headSha ${template.headSha}`);
console.log(`releaseZipSha256 ${template.releaseZipSha256}`);
