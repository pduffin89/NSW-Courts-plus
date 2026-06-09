import type { ProviderResultPage } from './types';
import { cleanText } from './text';
import { normalizeArgusDeltaResponse, prepareArgusDeltaQuery, validateArgusDeltaQuery } from '../providers/argusDeltaProvider';
import { searchNews } from '../providers/newsProvider';
import { searchFederalCourt, searchNswCaselaw } from '../providers/htmlSearchProvider';
import { searchAbn } from '../providers/abnProvider';

export type ProviderId = 'argus-delta' | 'news' | 'abn' | 'federal-court' | 'nsw-caselaw';

export interface RouteSearchOptions {
  providerId: ProviderId;
  query: string;
  exact?: boolean;
  limit?: number;
  offset?: number;
  page?: number;
  token?: string;
  proxyUrl?: string;
  abnGuid?: string;
  fetcher?: typeof fetch;
}

export async function routeSearch(options: RouteSearchOptions): Promise<ProviderResultPage> {
  const fetcher = options.fetcher || fetch;
  const query = cleanText(options.query);
  if (!query) throw new Error('Search query is required.');

  if (options.providerId === 'argus-delta') {
    const prepared = prepareArgusDeltaQuery(query, options.exact);
    const validation = validateArgusDeltaQuery(prepared.apiQuery);
    if (validation) throw new Error(validation);
    const base = options.proxyUrl || 'https://be-api.argusdelta.com/public/court-lists/search';
    const url = new URL(base);
    url.searchParams.set('query', prepared.apiQuery);
    url.searchParams.set('limit', String(options.limit || 10));
    url.searchParams.set('offset', String(options.offset || 0));
    const response = await fetcher(url.toString(), {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
      }
    });
    if (!response.ok) throw new Error(`Argus Delta request failed (${response.status}).`);
    return normalizeArgusDeltaResponse(prepared.displayQuery, await response.json(), prepared.exact);
  }

  if (options.providerId === 'news') return searchNews(query, fetcher);
  if (options.providerId === 'federal-court') return searchFederalCourt(query, fetcher, options.page);
  if (options.providerId === 'nsw-caselaw') return searchNswCaselaw(query, fetcher, options.page);
  if (options.providerId === 'abn') return searchAbn(query, options.abnGuid || '', fetcher, options.limit);
  throw new Error(`Unsupported provider: ${options.providerId satisfies never}`);
}
