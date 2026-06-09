import type { ProviderResultPage } from '../core/types';
import { cleanText, slug } from '../core/text';

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, ' ');
}

function attrValue(attrs: string, name: string): string {
  const match = attrs.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return decodeHtmlEntities(match?.[1] || match?.[2] || match?.[3] || '');
}

export function parseSearchHtml(providerId: string, source: string, query: string, html: string, baseUrl: string): ProviderResultPage {
  const anchors = Array.from(String(html || '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi))
    .map((match) => {
      const attrs = match[1] || '';
      const body = match[2] || '';
      const title = cleanText(decodeHtmlEntities(stripTags(body)));
      const href = attrValue(attrs, 'href');
      return { title, href };
    })
    .filter((anchor) => anchor.title.length > 3)
    .slice(0, 10);

  const items = anchors.map((anchor, index) => {
    const url = anchor.href ? new URL(anchor.href, baseUrl).toString() : baseUrl;
    return {
      id: `${providerId}-${slug(anchor.title)}-${index}`,
      title: anchor.title,
      subtitle: source,
      url,
      source,
      snippets: [],
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
