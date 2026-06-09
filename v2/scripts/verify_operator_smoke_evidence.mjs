import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const artifactsDir = join(root, 'artifacts');
const operatorEvidencePath = join(artifactsDir, 'operator-live-smoke.json');
const verifierEvidencePath = join(artifactsDir, 'operator-smoke-verification.json');

function fail(message) {
  throw new Error(`Operator smoke evidence verification failed: ${message}`);
}

function parseArgs(argv) {
  const parsed = { allowSkipCourtlist: false, allowSkipCaselaw: false, requireDocuments: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--allow-skip-courtlist') parsed.allowSkipCourtlist = true;
    else if (arg === '--allow-skip-caselaw') parsed.allowSkipCaselaw = true;
    else if (arg === '--require-documents') parsed.requireDocuments = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: npm run verify:operator-smoke-evidence -- [--allow-skip-courtlist] [--allow-skip-caselaw] [--require-documents]\n\nVerifies artifacts/operator-live-smoke.json from a headed operator smoke run.`);
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

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const args = parseArgs(process.argv.slice(2));
const currentHead = gitHead();
if (!existsSync(operatorEvidencePath)) fail('artifacts/operator-live-smoke.json is missing; run npm run smoke:operator first');
const evidence = readJson(operatorEvidencePath);
if (evidence.status !== 'pass') fail(`operator smoke status ${evidence.status} is not pass`);
if (evidence.gitHead !== currentHead) fail(`operator smoke gitHead ${evidence.gitHead || 'missing'} does not match current HEAD ${currentHead}`);
if (evidence.courtlist?.skipped === true && !args.allowSkipCourtlist) fail('courtlist workflow was skipped; pass --allow-skip-courtlist only if intentionally out of scope');
if (evidence.caselaw?.skipped === true && !args.allowSkipCaselaw) fail('caselaw workflow was skipped; pass --allow-skip-caselaw only if intentionally out of scope');
if (args.requireDocuments && evidence.courtlist?.documentsSkipped === true) fail('document generation was skipped but --require-documents was set');

const verifierEvidence = {
  generatedAt: new Date().toISOString(),
  status: 'pass',
  command: `npm run verify:operator-smoke-evidence${args.allowSkipCourtlist ? ' -- --allow-skip-courtlist' : ''}${args.allowSkipCaselaw ? ' -- --allow-skip-caselaw' : ''}${args.requireDocuments ? ' -- --require-documents' : ''}`,
  headSha: currentHead,
  operatorEvidence: {
    generatedAt: evidence.generatedAt,
    courtlistSkipped: Boolean(evidence.courtlist?.skipped),
    caselawSkipped: Boolean(evidence.caselaw?.skipped),
    documentsSkipped: Boolean(evidence.courtlist?.documentsSkipped),
    profileDir: evidence.profileDir || null,
    argusDeltaTokenPresent: Boolean(evidence.argusDeltaTokenPresent),
  },
};
mkdirSync(artifactsDir, { recursive: true });
writeFileSync(verifierEvidencePath, `${JSON.stringify(verifierEvidence, null, 2)}\n`);
console.log(`Operator smoke evidence verified for HEAD ${currentHead}`);
console.log(`Evidence written to ${verifierEvidencePath}`);
