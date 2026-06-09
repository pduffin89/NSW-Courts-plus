import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildDocumentApplicationPayload } from '../../extension/src/documents/documentApplication';
import { generateApplicationPdfs } from '../../extension/src/documents/pdfGeneration';
import { createMessageHandler } from '../../extension/src/background/messageHandler';

describe('PDF generation', () => {
  it('generates flattened application PDFs from bundled templates without network calls', async () => {
    const payload = buildDocumentApplicationPayload({
      matter: { caseNumber: '2025/00490454', matterTitle: 'Smith v Acme', court: 'Supreme Court', venue: 'Sydney', source: 'courtlist', url: 'https://example.test', plaintiff: 'Smith', defendant: 'Acme' },
      requestedDocuments: ['originating_process', 'transcript'],
      applicant: { name: 'Reporter One', organisation: 'Argus Delta', email: 'r@example.test', phone: '0400000000' }
    });
    const media = await readFile('extension/public/forms/access_application_2026.pdf');
    const nonParty = await readFile('extension/public/forms/application_non_party_access.pdf');

    const files = await generateApplicationPdfs(payload, {
      mediaTemplate: media,
      nonPartyTemplate: nonParty,
      includeMediaAccess: true,
      includeNonPartyAccess: true
    });

    expect(files).toHaveLength(2);
    expect(files[0].name).toContain('media_access_2026.pdf');
    const decoder = new TextDecoder();
    expect(decoder.decode(files[0].bytes.slice(0, 4))).toBe('%PDF');
    expect(files[0].bytes.length).toBeGreaterThan(100_000);
    expect(files[1].name).toContain('non_party_access.pdf');
    expect(decoder.decode(files[1].bytes.slice(0, 4))).toBe('%PDF');
  });

  it('background route returns generated PDF attachments as base64 payloads', async () => {
    const media = await readFile('extension/public/forms/access_application_2026.pdf');
    const nonParty = await readFile('extension/public/forms/application_non_party_access.pdf');
    const handler = createMessageHandler({
      get: async () => undefined,
      set: async () => undefined,
      loadAsset: async (path) => path.includes('access_application') ? media : nonParty
    });

    const result = await handler({
      type: 'COURTLENS_GENERATE_DOCUMENTS',
      matter: { caseNumber: '2025/00490454', matterTitle: 'Smith v Acme', court: 'Supreme Court', venue: 'Sydney', source: 'courtlist', url: 'https://example.test' },
      requestedDocuments: ['originating_process'],
      applicant: { name: 'Reporter', organisation: 'Argus Delta', email: 'r@example.test' }
    });

    expect(result.ok).toBe(true);
    expect((result.data as any).attachments).toHaveLength(2);
    expect((result.data as any).attachments[0]).toMatchObject({ mime: 'application/pdf' });
    expect((result.data as any).attachments[0].base64.length).toBeGreaterThan(100_000);
  });
});
