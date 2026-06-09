import type { ProviderResultItem, ProviderResultPage } from '../core/types';
import { cleanText, slug, stripWrappingQuotes } from '../core/text';

interface ArgusDeltaItem {
  title?: string | null;
  caseNumbers?: string[] | string | null;
  court?: string | null;
  location?: string | null;
  listingType?: string | null;
  date?: string | null;
  time?: string | null;
  createdAt?: string | null;
  rowId?: string | null;
  feedId?: string | null;
  [key: string]: unknown;
}

interface ArgusDeltaResponse {
  items?: ArgusDeltaItem[];
  hasMore?: boolean;
  nextOffset?: number;
}

export function prepareArgusDeltaQuery(query: string, exact = false): { apiQuery: string; displayQuery: string; exact: boolean } {
  const displayQuery = cleanText(query);
  const apiQuery = stripWrappingQuotes(displayQuery);
  return { apiQuery, displayQuery, exact: exact || /^['\"].*['\"]$/.test(displayQuery) };
}

function caseNumbersFor(item: ArgusDeltaItem): string[] {
  if (Array.isArray(item.caseNumbers)) return item.caseNumbers.map(cleanText).filter(Boolean);
  const one = cleanText(item.caseNumbers);
  return one ? [one] : [];
}

export function normalizeArgusDeltaResponse(query: string, payload: ArgusDeltaResponse, exact = false): ProviderResultPage {
  const exactPhrase = stripWrappingQuotes(query).toLowerCase();
  const sourceItems = exact && exactPhrase
    ? (payload.items || []).filter((item) => cleanText([item.title, caseNumbersFor(item).join(' ')].join(' ')).toLowerCase().includes(exactPhrase))
    : (payload.items || []);
  const items: ProviderResultItem[] = sourceItems.map((item) => {
    const cases = caseNumbersFor(item);
    const title = cleanText(item.title) || cases[0] || 'Untitled court-list result';
    const metadata = [item.court, item.location, item.listingType, item.date, item.time].map(cleanText).filter(Boolean);
    const idSeed = [title, cases.join('-'), item.createdAt, item.rowId, item.feedId].map(cleanText).filter(Boolean).join('-');
    return {
      id: `argus-${slug(idSeed)}`,
      title,
      subtitle: cases.join(', ') || metadata.join(' · ') || 'Court-list result',
      source: 'Argus Delta',
      date: cleanText(item.date || item.createdAt),
      snippets: metadata,
      badges: [...cases, cleanText(item.court), cleanText(item.location)].filter(Boolean),
      raw: item
    };
  });
  return {
    providerId: 'argus-delta',
    query,
    items,
    hasMore: Boolean(payload.hasMore),
    nextOffset: payload.nextOffset,
    raw: payload
  };
}

export function validateArgusDeltaQuery(query: string): string | null {
  return stripWrappingQuotes(query).length >= 2 ? null : 'Argus Delta searches require at least 2 characters.';
}
