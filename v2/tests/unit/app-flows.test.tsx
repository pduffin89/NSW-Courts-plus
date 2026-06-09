import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { routeSearch } from '../../extension/src/core/searchRouter';
import { createMessageHandler } from '../../extension/src/background/messageHandler';
import { CourtlensSidebar } from '../../extension/src/sidebar/CourtlensSidebar';
import { injectCourtlensButton } from '../../extension/src/content/courtlist';
import { readCaselawPageContext } from '../../extension/src/content/caselaw';

describe('provider router', () => {
  it('routes Argus exact search without sending quote marks to the API URL', async () => {
    const fetcher = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => ({ items: [], hasMore: false })
    })) as unknown as typeof fetch;

    await routeSearch({ providerId: 'argus-delta', query: '"Andrew James Mitchell"', exact: true, token: 'secret', fetcher });

    const fetchMock = vi.mocked(fetcher);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('query=Andrew+James+Mitchell');
    expect(String(url)).not.toContain('%22');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer secret' });
  });

  it('parses Google News RSS and provider HTML into normalized cards', async () => {
    const fetcher = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () => String(url).includes('news.google')
        ? '<rss><channel><item><title>Case update</title><link>https://news.example/a</link><pubDate>Tue, 09 Jun 2026 00:00:00 GMT</pubDate><description>Snippet</description></item></channel></rss>'
        : '<html><body><a href="/case/1">Smith v Acme</a><p>Catchwords text</p></body></html>'
    })) as unknown as typeof fetch;

    const news = await routeSearch({ providerId: 'news', query: 'Smith', fetcher });
    const fed = await routeSearch({ providerId: 'federal-court', query: 'Smith', fetcher });
    expect(news.items[0].title).toBe('Case update');
    expect(fed.items[0].title).toBe('Smith v Acme');
  });
});

describe('background message handler', () => {
  it('saves settings and performs searches through injected storage/fetch', async () => {
    const storage = new Map<string, unknown>();
    const handler = createMessageHandler({
      get: async (key) => storage.get(key),
      set: async (items) => Object.entries(items).forEach(([key, value]) => storage.set(key, value)),
      fetcher: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [], hasMore: false }) })) as unknown as typeof fetch
    });

    await handler({ type: 'COURTLENS_SAVE_SETTINGS', settings: { argusDeltaToken: 'secret' } });
    const result = await handler({ type: 'COURTLENS_SEARCH', providerId: 'argus-delta', query: 'akram', exact: false });
    expect(result).toMatchObject({ ok: true, data: { providerId: 'argus-delta' } });
  });
});

describe('React sidebar', () => {
  it('renders overview, switches tabs, and triggers research callbacks', async () => {
    const onSearch = vi.fn(async () => ({ providerId: 'argus-delta', query: 'Smith', items: [], hasMore: false }));
    render(<CourtlensSidebar initialContext={{ matter: { caseNumber: '2025/00490454', matterTitle: 'Smith v Acme', court: 'Supreme Court', venue: 'Sydney', source: 'courtlist', url: 'https://example.test' } }} onSearch={onSearch} />);

    expect(screen.getByText('Smith v Acme')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /research/i }));
    fireEvent.click(screen.getByRole('button', { name: /search argus delta/i }));
    await waitFor(() => expect(onSearch).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('tab', { name: /documents/i }));
    expect(screen.getByText(/application payload/i)).toBeInTheDocument();
  });
});

describe('content scripts', () => {
  it('injects one Courtlens button into a court-list row and reads caselaw context', () => {
    const table = document.createElement('table');
    table.innerHTML = '<tr><td>09 Jun 2026</td><td>09:30</td><td>2025/00490454</td><td>Smith v Acme</td><td>Civil</td><td>Supreme Court</td><td>Directions</td><td></td><td>Sydney</td><td></td></tr>';
    const row = table.querySelector('tr')!;
    injectCourtlensButton(row, () => undefined);
    injectCourtlensButton(row, () => undefined);
    expect(row.querySelectorAll('[data-courtlens-open]').length).toBe(1);

    document.body.innerHTML = '<h1>Smith v Acme [2026] NSWSC 1</h1><dl><dt>Court</dt><dd>Supreme Court</dd><dt>File number(s)</dt><dd>2025/00490454</dd></dl>';
    expect(readCaselawPageContext(document).matter.caseNumber).toBe('2025/00490454');
  });
});
