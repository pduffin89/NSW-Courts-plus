import type { ProviderResultPage } from '../core/types';
import { cleanText, slug } from '../core/text';
import { buildGoogleNewsRssUrl } from '../parsers/partyParser';

function textFromXml(element: Element, selector: string): string {
  return cleanText(element.querySelector(selector)?.textContent || '');
}

export function parseGoogleNewsRss(query: string, rss: string): ProviderResultPage {
  const doc = new DOMParser().parseFromString(rss, 'text/xml');
  const items = Array.from(doc.querySelectorAll('item')).map((item) => {
    const title = textFromXml(item, 'title');
    const link = textFromXml(item, 'link');
    const date = textFromXml(item, 'pubDate');
    const snippet = textFromXml(item, 'description');
    return {
      id: `news-${slug(title)}-${slug(date)}`,
      title,
      subtitle: date || 'Google News',
      url: link,
      source: 'Google News',
      date,
      snippets: snippet ? [snippet.replace(/<[^>]+>/g, '')] : [],
      badges: ['News']
    };
  });
  return { providerId: 'news', query, items, hasMore: false };
}

export async function searchNews(query: string, fetcher: typeof fetch = fetch): Promise<ProviderResultPage> {
  const url = buildGoogleNewsRssUrl(query);
  const response = await fetcher(url, { method: 'GET', cache: 'no-store' });
  if (!response.ok) throw new Error(`Google News request failed (${response.status}).`);
  return parseGoogleNewsRss(query, await response.text());
}
