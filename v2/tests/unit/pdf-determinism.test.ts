import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildDocumentApplicationPayload } from '../../extension/src/documents/documentApplication';
import { generateApplicationPdfs } from '../../extension/src/documents/pdfGeneration';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const matter = {
  caseNumber: '2025/00490454',
  matterTitle: 'Smith v Acme',
  court: 'Supreme Court',
  venue: 'Sydney',
  source: 'courtlist' as const,
  url: 'https://example.test',
  plaintiff: 'Smith',
  defendant: 'Acme'
};

const applicant = {
  name: 'Reporter One',
  organisation: 'Argus Delta',
  email: 'r@example.test',
  phone: '0400000000'
};

describe('PDF deterministic generation matrix', () => {
  it('generates byte-identical PDFs for identical payloads and templates', async () => {
    const payload = buildDocumentApplicationPayload({
      matter,
      requestedDocuments: ['originating_process', 'transcript', 'exhibits'],
      applicant
    });
    const media = await readFile('extension/public/forms/access_application_2026.pdf');
    const nonParty = await readFile('extension/public/forms/application_non_party_access.pdf');

    const first = await generateApplicationPdfs(payload, { mediaTemplate: media, nonPartyTemplate: nonParty });
    const second = await generateApplicationPdfs(payload, { mediaTemplate: media, nonPartyTemplate: nonParty });

    expect(first.map((file) => file.name)).toEqual(second.map((file) => file.name));
    expect(first.map((file) => sha256(file.bytes))).toEqual(second.map((file) => sha256(file.bytes)));
  });

  it('keeps selected document options isolated across different requests', async () => {
    const media = await readFile('extension/public/forms/access_application_2026.pdf');
    const nonParty = await readFile('extension/public/forms/application_non_party_access.pdf');
    const transcriptPayload = buildDocumentApplicationPayload({ matter, requestedDocuments: ['transcript'], applicant });
    const exhibitsPayload = buildDocumentApplicationPayload({ matter, requestedDocuments: ['exhibits'], applicant });

    const transcriptFiles = await generateApplicationPdfs(transcriptPayload, { mediaTemplate: media, nonPartyTemplate: nonParty });
    const exhibitsFiles = await generateApplicationPdfs(exhibitsPayload, { mediaTemplate: media, nonPartyTemplate: nonParty });

    expect(transcriptFiles.map((file) => sha256(file.bytes))).not.toEqual(exhibitsFiles.map((file) => sha256(file.bytes)));
    for (const file of [...transcriptFiles, ...exhibitsFiles]) {
      expect(new TextDecoder().decode(file.bytes.slice(0, 4))).toBe('%PDF');
      expect(file.bytes.length).toBeGreaterThan(100_000);
    }
  });
});
