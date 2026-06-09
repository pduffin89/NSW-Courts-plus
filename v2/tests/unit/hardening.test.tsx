import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { routeSearch } from '../../extension/src/core/searchRouter';
import { normalizeArgusDeltaResponse } from '../../extension/src/providers/argusDeltaProvider';
import { parseAbnJsonp, buildAbnNameSearchUrl } from '../../extension/src/providers/abnProvider';
import { createMessageHandler } from '../../extension/src/background/messageHandler';
import { CourtlensSidebar } from '../../extension/src/sidebar/CourtlensSidebar';

describe('provider hardening', () => {
  it('applies client-side exact filtering to Argus Delta normalized results', () => {
    const page = normalizeArgusDeltaResponse('"Andrew James Mitchell"', {
      items: [
        { title: 'R v Andrew James Mitchell', caseNumbers: ['2025/1'] },
        { title: 'R v Andrew Mitchell', caseNumbers: ['2025/2'] }
      ],
      hasMore: false
    }, true);
    expect(page.items.map((item) => item.title)).toEqual(['R v Andrew James Mitchell']);
  });

  it('builds ABN name lookup URLs and parses JSONP rows', () => {
    const url = buildAbnNameSearchUrl('Acme Pty Ltd', 'guid-123', 5);
    expect(url).toContain('name=Acme+Pty+Ltd');
    expect(url).toContain('guid=guid-123');
    const rows = parseAbnJsonp('callback({"Names":[{"Abn":"12345678901","Name":"ACME PTY LTD","State":"NSW","Postcode":"2000"}]})');
    expect(rows[0]).toMatchObject({ abn: '12345678901', title: 'ACME PTY LTD', subtitle: 'ABN 12345678901 · NSW 2000' });
  });

  it('routes ABN searches with configured GUID', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, text: async () => 'callback({"Names":[]})' })) as unknown as typeof fetch;
    const page = await routeSearch({ providerId: 'abn', query: 'Acme', abnGuid: 'guid-123', fetcher });
    expect(page.providerId).toBe('abn');
    expect(vi.mocked(fetcher).mock.calls[0][0]).toContain('abr.business.gov.au');
  });
});

describe('settings and document message flows', () => {
  it('background can build a document application payload from a message', async () => {
    const handler = createMessageHandler({ get: async () => undefined, set: async () => undefined, fetcher: fetch });
    const result = await handler({
      type: 'COURTLENS_BUILD_DOCUMENT_PAYLOAD',
      matter: { caseNumber: '2025/00490454', matterTitle: 'Smith v Acme', court: 'Supreme Court', venue: 'Sydney', source: 'courtlist', url: 'https://example.test' },
      requestedDocuments: ['Statement of Claim'],
      applicant: { name: 'Reporter', organisation: 'Argus Delta', email: 'r@example.test' }
    });
    expect(result).toMatchObject({ ok: true, data: { email: { to: 'sc.enquiries@justice.nsw.gov.au' }, validationErrors: [] } });
  });

  it('settings tab saves Argus token without displaying the token after save', async () => {
    const onSaveSettings = vi.fn(async () => undefined);
    render(<CourtlensSidebar initialContext={{ matter: { caseNumber: '2025/00490454', matterTitle: 'Smith v Acme', court: 'Supreme Court', venue: 'Sydney', source: 'courtlist', url: 'https://example.test' } }} onSaveSettings={onSaveSettings} />);
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }));
    fireEvent.change(screen.getByLabelText(/argus delta token/i), { target: { value: 'super-secret-token' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(onSaveSettings).toHaveBeenCalledWith(expect.objectContaining({ argusDeltaToken: 'super-secret-token' })));
    expect(screen.queryByText('super-secret-token')).not.toBeInTheDocument();
  });
});
