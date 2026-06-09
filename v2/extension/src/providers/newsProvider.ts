import type { ProviderResultPage } from '../core/types';
import { cleanText, slug } from '../core/text';
import { buildGoogleNewsRssUrl } from '../parsers/partyParser';

function decodeXmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
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

function tagText(source: string, tag: string): string {
  const match = source.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return cleanText(decodeXmlEntities(match?.[1] || ''));
}

export function parseGoogleNewsRss(query: string, rss: string): ProviderResultPage {
  const itemMatches = Array.from(String(rss || '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)).slice(0, 20);
  const items = itemMatches.map((match) => {
    const item = match[1] || '';
    const title = tagText(item, 'title');
    const link = tagText(item, 'link');
    const date = tagText(item, 'pubDate');
    const snippet = cleanText(stripTags(decodeXmlEntities(tagText(item, 'description'))));
    return {
      id: `news-${slug(title)}-${slug(date)}`,
      title,
      subtitle: date || 'Google News',
      url: link,
      source: 'Google News',
      date,
      snippets: snippet ? [snippet] : [],
      badges: ['News']
    };
  }).filter((item) => item.title);
  return { providerId: 'news', query, items, hasMore: false };
}

export async function searchNews(query: string, fetcher: typeof fetch = fetch): Promise<ProviderResultPage> {
  const url = buildGoogleNewsRssUrl(query);
  const response = await fetcher(url, { method: 'GET', cache: 'no-store' });
  if (!response.ok) throw new Error(`Google News request failed (${response.status}).`);
  return parseGoogleNewsRss(query, await response.text());
}
