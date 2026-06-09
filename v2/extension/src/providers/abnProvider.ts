import type { ProviderResultItem, ProviderResultPage } from '../core/types';
import { cleanText, slug } from '../core/text';

export function buildAbnNameSearchUrl(query: string, guid: string, maxResults = 10): string {
  const url = new URL('https://abr.business.gov.au/json/MatchingNames.aspx');
  url.searchParams.set('name', cleanText(query));
  url.searchParams.set('maxResults', String(maxResults));
  url.searchParams.set('guid', cleanText(guid));
  return url.toString();
}

function parseJsonp(text: string): any {
  const trimmed = text.trim();
  const start = trimmed.indexOf('(');
  const end = trimmed.lastIndexOf(')');
  const json = start >= 0 && end > start ? trimmed.slice(start + 1, end) : trimmed;
  return JSON.parse(json);
}

export function parseAbnJsonp(text: string): ProviderResultItem[] {
  const payload = parseJsonp(text);
  if (payload?.Message) throw new Error(cleanText(payload.Message));
  return (Array.isArray(payload?.Names) ? payload.Names : []).map((row: any) => {
    const abn = cleanText(row.Abn);
    const name = cleanText(row.Name) || 'Unnamed ABN record';
    const statePostcode = [row.State, row.Postcode].map(cleanText).filter(Boolean).join(' ');
    return {
      id: `abn-${slug(abn || name)}`,
      abn,
      title: name,
      subtitle: [abn ? `ABN ${abn}` : '', statePostcode].filter(Boolean).join(' · '),
      url: abn ? `https://abr.business.gov.au/ABN/View?id=${encodeURIComponent(abn)}` : 'https://abr.business.gov.au/',
      source: 'ABN Lookup',
      snippets: [],
      badges: [abn, statePostcode].filter(Boolean),
      raw: row
    };
  });
}

export async function searchAbn(query: string, guid: string, fetcher: typeof fetch = fetch, maxResults = 10): Promise<ProviderResultPage> {
  if (!cleanText(guid)) throw new Error('ABN GUID is required. Add it in Courtlens Settings.');
  const url = buildAbnNameSearchUrl(query, guid, maxResults);
  const response = await fetcher(url, { method: 'GET', cache: 'no-store' });
  if (!response.ok) throw new Error(`ABN Lookup request failed (${response.status}).`);
  return { providerId: 'abn', query, items: parseAbnJsonp(await response.text()), hasMore: false };
}
