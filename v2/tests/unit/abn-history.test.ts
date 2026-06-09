import { describe, expect, it, vi } from 'vitest';
import {
  buildAbnCurrentPageUrl,
  buildAbnHistoryPageUrl,
  parseAbnCurrentDetailsHtml,
  parseAbnHistoryDetailsHtml,
  fetchAbnHistoryDetails
} from '../../extension/src/providers/abnProvider';
import { createMessageHandler } from '../../extension/src/background/messageHandler';

const currentHtml = `
<table>
  <tr><th>Entity name:</th><td>ACME PTY LTD</td></tr>
  <tr><th>ABN status:</th><td>Active from 01 Jan 2020</td></tr>
  <tr><th>Entity type:</th><td>Australian Private Company</td></tr>
  <tr><th>Goods & Services Tax (GST):</th><td>Registered from 01 Jan 2020</td></tr>
  <tr><th>Main business location:</th><td>NSW 2000</td></tr>
</table>
<ul><li><strong>ABN last updated:</strong> 9 June 2026</li><li><strong>Record extracted:</strong> 10 June 2026</li></ul>`;

const historyHtml = `
<table>
  <tr><th colspan="3">Entity name</th></tr>
  <tr><td>ACME PTY LTD</td><td>01 Jan 2020</td><td>current</td></tr>
  <tr><th colspan="3">ABN status</th></tr>
  <tr><td>Active</td><td>01 Jan 2020</td><td>current</td></tr>
  <tr><th colspan="3">Goods & Services Tax (GST)</th></tr>
  <tr><td>Registered</td><td>01 Jan 2020</td><td>current</td></tr>
  <tr><th colspan="3">Main business location</th></tr>
  <tr><td>NSW 2000</td><td>01 Jan 2020</td><td>current</td></tr>
</table>`;

describe('ABN history provider', () => {
  it('builds current and history URLs from noisy ABN input', () => {
    expect(buildAbnCurrentPageUrl('12 345 678 901')).toBe('https://abr.business.gov.au/ABN/View?id=12345678901');
    expect(buildAbnHistoryPageUrl('12 345 678 901')).toBe('https://abr.business.gov.au/AbnHistory/View?id=12345678901');
  });

  it('parses current and historical ABN detail tables', () => {
    expect(parseAbnCurrentDetailsHtml(currentHtml)).toMatchObject({
      entityName: 'ACME PTY LTD',
      abnStatus: 'Active from 01 Jan 2020',
      entityType: 'Australian Private Company',
      gst: 'Registered from 01 Jan 2020',
      mainBusinessLocation: 'NSW 2000',
      abnLastUpdated: '9 June 2026',
      recordExtracted: '10 June 2026'
    });
    expect(parseAbnHistoryDetailsHtml(historyHtml).entityName).toEqual([{ value: 'ACME PTY LTD', from: '01 Jan 2020', to: 'current' }]);
    expect(parseAbnHistoryDetailsHtml(historyHtml).gst).toEqual([{ value: 'Registered', from: '01 Jan 2020', to: 'current' }]);
  });

  it('fetches current and history pages and normalizes the response', async () => {
    const fetcher = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () => String(url).includes('AbnHistory') ? historyHtml : currentHtml
    })) as unknown as typeof fetch;

    const details = await fetchAbnHistoryDetails('12345678901', fetcher);
    expect(details).toMatchObject({
      abn: '12345678901',
      recordUrl: 'https://abr.business.gov.au/ABN/View?id=12345678901',
      historyUrl: 'https://abr.business.gov.au/AbnHistory/View?id=12345678901',
      current: { entityName: 'ACME PTY LTD' }
    });
    expect(vi.mocked(fetcher)).toHaveBeenCalledTimes(2);
  });

  it('background exposes ABN history details route', async () => {
    const handler = createMessageHandler({
      get: async () => undefined,
      set: async () => undefined,
      fetcher: vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        text: async () => String(url).includes('AbnHistory') ? historyHtml : currentHtml
      })) as unknown as typeof fetch
    });

    const result = await handler({ type: 'COURTLENS_ABN_HISTORY_DETAILS', abn: '12345678901' });
    expect(result).toMatchObject({ ok: true, data: { abn: '12345678901', current: { entityName: 'ACME PTY LTD' } } });
  });
});
