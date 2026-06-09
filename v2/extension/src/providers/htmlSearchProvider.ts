import type { ProviderResultPage } from '../core/types';
import { cleanText, slug } from '../core/text';

export function parseSearchHtml(providerId: string, source: string, query: string, html: string, baseUrl: string): ProviderResultPage {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const anchors = Array.from(doc.querySelectorAll('a')).filter((a) => cleanText(a.textContent).length > 3).slice(0, 10);
  const items = anchors.map((anchor, index) => {
    const title = cleanText(anchor.textContent);
    const href = anchor.getAttribute('href') || '';
    const url = href ? new URL(href, baseUrl).toString() : baseUrl;
    const nearby = cleanText(anchor.parentElement?.textContent || anchor.nextElementSibling?.textContent || '');
    return {
      id: `${providerId}-${slug(title)}-${index}`,
      title,
      subtitle: source,
      url,
      source,
      snippets: nearby && nearby !== title ? [nearby] : [],
      badges: [source]
    };
  });
  return { providerId, query, items, hasMore: items.length >= 10 };
}

export function federalCourtSearchUrl(query: string, page = 1): string {
  const startRank = Math.max(1, (page - 1) * 10 + 1);
  return `https://search.judgments.fedcourt.gov.au/s/search.html?query_sand=${encodeURIComponent(query)}&start_rank=${startRank}`;
}

export function nswCaselawSearchUrl(query: string, page = 1): string {
  return `https://www.caselaw.nsw.gov.au/search?query=${encodeURIComponent(query)}&page=${page}`;
}

export async function searchFederalCourt(query: string, fetcher: typeof fetch = fetch, page = 1): Promise<ProviderResultPage> {
  const url = federalCourtSearchUrl(query, page);
  const response = await fetcher(url, { method: 'GET', cache: 'no-store' });
  if (!response.ok) throw new Error(`Federal Court search request failed (${response.status}).`);
  return parseSearchHtml('federal-court', 'Federal Court', query, await response.text(), url);
}

export async function searchNswCaselaw(query: string, fetcher: typeof fetch = fetch, page = 1): Promise<ProviderResultPage> {
  const url = nswCaselawSearchUrl(query, page);
  const response = await fetcher(url, { method: 'GET', cache: 'no-store' });
  if (!response.ok) throw new Error(`NSW Caselaw search request failed (${response.status}).`);
  return parseSearchHtml('nsw-caselaw', 'NSW Caselaw', query, await response.text(), url);
}
