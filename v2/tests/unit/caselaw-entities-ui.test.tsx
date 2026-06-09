import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CourtlensSidebar } from '../../extension/src/sidebar/CourtlensSidebar';
import { readCaselawPageContext } from '../../extension/src/content/caselaw';

const matter = {
  caseNumber: '2025/00490454',
  matterTitle: 'Mitchell v State of New South Wales [2026] NSWSC 122',
  court: 'Supreme Court of New South Wales',
  venue: 'Sydney',
  source: 'caselaw' as const,
  url: 'https://www.caselaw.nsw.gov.au/decision/mock'
};

describe('Caselaw judgment entities in sidebar', () => {
  it('renders judgment-body entities passed from the caselaw content script', () => {
    const entities = [
      { id: 'judgment-judge-harrison-j', name: 'Harrison J', originalText: 'Harrison J', type: 'judge' as const, group: 'Judges', confidence: 0.9, source: 'judgment-body' as const },
      { id: 'judgment-company-acme-pty-ltd', name: 'Acme Pty Ltd', originalText: 'Acme Pty Ltd', type: 'company' as const, group: 'Companies', confidence: 0.86, source: 'judgment-body' as const },
      { id: 'judgment-council-byron-shire-council', name: 'Byron Shire Council', originalText: 'Byron Shire Council', type: 'council' as const, group: 'Councils', confidence: 0.86, source: 'judgment-body' as const }
    ];

    render(<CourtlensSidebar initialContext={{ matter, entities }} />);

    expect(screen.getByText('Harrison J')).toBeInTheDocument();
    expect(screen.getByText('Acme Pty Ltd')).toBeInTheDocument();
    expect(screen.getByText('Byron Shire Council')).toBeInTheDocument();
  });

  it('caselaw content script returns metadata and extracted entities together', () => {
    document.body.innerHTML = `
      <h1>Mitchell v State of New South Wales [2026] NSWSC 122</h1>
      <dl><dt>Court</dt><dd>Supreme Court of New South Wales</dd><dt>File number(s)</dt><dd>2025/00490454</dd><dt>Judge(s)</dt><dd>Harrison J</dd></dl>
      <p>Harrison J heard from Jane Citizen for Acme Pty Ltd and Byron Shire Council.</p>`;

    const context = readCaselawPageContext(document);

    expect(context.matter.caseNumber).toBe('2025/00490454');
    expect(context.entities.map((entity) => entity.name)).toContain('Acme Pty Ltd');
  });
});
