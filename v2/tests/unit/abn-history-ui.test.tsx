import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CourtlensSidebar } from '../../extension/src/sidebar/CourtlensSidebar';

const matter = {
  caseNumber: '2025/00490454',
  matterTitle: 'Acme Pty Ltd v Smith',
  court: 'Supreme Court',
  venue: 'Sydney',
  source: 'courtlist' as const,
  url: 'https://example.test'
};

describe('ABN history UI', () => {
  it('renders ABN history details for an ABN result card', async () => {
    const onSearch = vi.fn(async () => ({
      providerId: 'abn',
      query: 'Acme',
      hasMore: false,
      items: [{
        id: 'abn-12345678901',
        abn: '12345678901',
        title: 'ACME PTY LTD',
        subtitle: 'ABN 12345678901 · NSW 2000',
        source: 'ABN Lookup',
        snippets: [],
        badges: ['12345678901']
      }]
    }));
    const onAbnHistory = vi.fn(async () => ({
      abn: '12345678901',
      recordUrl: 'https://abr.business.gov.au/ABN/View?id=12345678901',
      historyUrl: 'https://abr.business.gov.au/AbnHistory/View?id=12345678901',
      current: { entityName: 'ACME PTY LTD', abnStatus: 'Active from 2020', entityType: 'Australian Private Company', gst: 'Registered', mainBusinessLocation: 'NSW 2000', abnLastUpdated: '9 June 2026', recordExtracted: '10 June 2026' },
      history: { entityName: [{ value: 'ACME PTY LTD', from: '2020', to: 'current' }], abnStatus: [], entityType: '', gst: [], mainBusinessLocation: [] }
    }));

    render(<CourtlensSidebar initialContext={{ matter }} onSearch={onSearch} onAbnHistory={onAbnHistory} />);
    fireEvent.click(screen.getByRole('tab', { name: /research/i }));
    fireEvent.click(screen.getByRole('button', { name: /search abn/i }));
    expect(await screen.findByText('ACME PTY LTD')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show abn history/i }));

    await waitFor(() => expect(onAbnHistory).toHaveBeenCalledWith('12345678901'));
    expect(await screen.findByText(/Active from 2020/i)).toBeInTheDocument();
    expect(screen.getByText(/Record extracted: 10 June 2026/i)).toBeInTheDocument();
  });
});
