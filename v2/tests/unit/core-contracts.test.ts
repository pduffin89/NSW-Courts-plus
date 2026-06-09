import { describe, expect, it } from 'vitest';
import { parseCourtlistRowCells } from '../../extension/src/parsers/nswCourtlistParser';
import { parseNewsSearchCandidates } from '../../extension/src/parsers/partyParser';
import { extractCaselawMetadata } from '../../extension/src/parsers/nswCaselawParser';
import { extractJudgmentEntities } from '../../extension/src/parsers/judgmentEntityParser';
import { normalizeArgusDeltaResponse, prepareArgusDeltaQuery } from '../../extension/src/providers/argusDeltaProvider';
import { buildDocumentApplicationPayload, resolveCourtRecipient } from '../../extension/src/documents/documentApplication';

describe('court-list parsing', () => {
  it('extracts case number, title, court, jurisdiction, listing type, location and parties from NSW row cells', () => {
    const matter = parseCourtlistRowCells([
      '09 Jun 2026',
      '09:30 AM',
      '2025/00490454',
      'SMITH v ACME PTY LTD',
      'Civil',
      'Supreme Court',
      'Directions',
      'Registrar Jones',
      'Sydney',
      'Online'
    ]);

    expect(matter).toMatchObject({
      caseNumber: '2025/00490454',
      matterTitle: 'SMITH v ACME PTY LTD',
      court: 'Supreme Court',
      jurisdiction: 'Civil',
      listingType: 'Directions',
      venue: 'Sydney',
      plaintiff: 'SMITH',
      defendant: 'ACME PTY LTD'
    });
  });
});

describe('party candidates', () => {
  it('splits legal matter titles into deduped smart-cased candidate names', () => {
    const candidates = parseNewsSearchCandidates({
      matterTitle: 'NOTICE OF MOTION CIVIL - JOHN SMITH & JANE DOE v ACME PTY LTD',
      jurisdiction: 'Civil'
    });

    expect(candidates.map((candidate) => candidate.name)).toEqual(['John Smith', 'Jane Doe', 'Acme']);
    expect(candidates.every((candidate) => candidate.source === 'courtlist')).toBe(true);
  });

  it('for criminal matters searches the accused rather than the Crown', () => {
    const candidates = parseNewsSearchCandidates({ matterTitle: 'R v ANDREW JAMES MITCHELL', jurisdiction: 'Criminal' });
    expect(candidates.map((candidate) => candidate.name)).toEqual(['Andrew James Mitchell']);
  });
});

describe('caselaw extraction', () => {
  it('extracts NSW Caselaw metadata from a judgment document', () => {
    document.body.innerHTML = `
      <h1>Mitchell v State of New South Wales [2026] NSWSC 122</h1>
      <dl>
        <dt>Court</dt><dd>Supreme Court of New South Wales</dd>
        <dt>File number(s)</dt><dd>2025/00490454</dd>
        <dt>Decision date</dt><dd>9 June 2026</dd>
        <dt>Judge(s)</dt><dd>Harrison J</dd>
      </dl>`;

    expect(extractCaselawMetadata(document)).toMatchObject({
      matterTitle: 'Mitchell v State of New South Wales [2026] NSWSC 122',
      caseNumber: '2025/00490454',
      court: 'Supreme Court of New South Wales',
      decisionDate: '9 June 2026',
      judges: ['Harrison J']
    });
  });

  it('groups judgment body people, companies, councils and judges without duplicates', () => {
    const entities = extractJudgmentEntities('Harrison J heard from Jane Citizen for Acme Pty Ltd and Byron Shire Council. Jane Citizen referred to NSW Police.');
    expect(entities.map((entity) => [entity.name, entity.type])).toEqual([
      ['Harrison J', 'judge'],
      ['Jane Citizen', 'person'],
      ['Acme Pty Ltd', 'company'],
      ['Byron Shire Council', 'council'],
      ['NSW Police', 'government']
    ]);
  });
});

describe('Argus Delta provider', () => {
  it('strips quotes for API calls while preserving display query and exact mode', () => {
    expect(prepareArgusDeltaQuery('"Andrew James Mitchell"', true)).toEqual({
      apiQuery: 'Andrew James Mitchell',
      displayQuery: '"Andrew James Mitchell"',
      exact: true
    });
  });

  it('normalizes nullable Argus Delta results and builds stable composite keys', () => {
    const page = normalizeArgusDeltaResponse('Andrew James Mitchell', {
      items: [{ title: 'R v Andrew James Mitchell', caseNumbers: ['2025/00490454'], court: null, location: null, date: null, createdAt: '2026-06-09T00:00:00Z' }],
      hasMore: true,
      nextOffset: 10
    });

    expect(page.items[0]).toMatchObject({
      title: 'R v Andrew James Mitchell',
      subtitle: '2025/00490454',
      source: 'Argus Delta',
      badges: ['2025/00490454']
    });
    expect(page.items[0].id).toContain('r-v-andrew-james-mitchell');
    expect(page.hasMore).toBe(true);
    expect(page.nextOffset).toBe(10);
  });
});

describe('document workflow', () => {
  it('routes known courts and builds a validated application payload', () => {
    expect(resolveCourtRecipient('Supreme Court')).toBe('sc.enquiries@justice.nsw.gov.au');
    const payload = buildDocumentApplicationPayload({
      matter: { caseNumber: '2025/00490454', matterTitle: 'Smith v Acme', court: 'Supreme Court', venue: 'Sydney', source: 'courtlist', url: 'https://example.test' },
      requestedDocuments: ['Statement of Claim'],
      applicant: { name: 'Reporter One', organisation: 'Argus Delta', email: 'r@example.test' }
    });

    expect(payload.email.to).toBe('sc.enquiries@justice.nsw.gov.au');
    expect(payload.fileBaseName).toContain('2025-00490454');
    expect(payload.validationErrors).toEqual([]);
  });
});
