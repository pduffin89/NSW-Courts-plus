import type { ProviderResultItem, ProviderResultPage } from '../core/types';
import { cleanText, slug } from '../core/text';

export interface AbnHistoryEntry {
  value: string;
  from: string;
  to: string;
}

export interface AbnCurrentDetails {
  entityName: string;
  abnStatus: string;
  entityType: string;
  gst: string;
  mainBusinessLocation: string;
  abnLastUpdated: string;
  recordExtracted: string;
}

export interface AbnHistoryDetails {
  entityName: AbnHistoryEntry[];
  abnStatus: AbnHistoryEntry[];
  entityType: string;
  gst: AbnHistoryEntry[];
  mainBusinessLocation: AbnHistoryEntry[];
}

export interface AbnHistoryResponse {
  abn: string;
  recordUrl: string;
  historyUrl: string;
  current: AbnCurrentDetails;
  history: AbnHistoryDetails;
}

function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D+/g, '');
}

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

function normalizeHtmlText(value: string): string {
  return cleanText(decodeHtmlEntities(stripTags(value)));
}

function parseTableRows(html: string): Array<Array<{ tag: 'th' | 'td'; text: string; colspan: number }>> {
  const rows: Array<Array<{ tag: 'th' | 'td'; text: string; colspan: number }>> = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(String(html || '')))) {
    const rowHtml = rowMatch[1];
    const cells: Array<{ tag: 'th' | 'td'; text: string; colspan: number }> = [];
    const cellRe = /<(th|td)([^>]*)>([\s\S]*?)<\/\1>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowHtml))) {
      const colspanMatch = String(cellMatch[2] || '').match(/colspan\s*=\s*["']?(\d+)/i);
      cells.push({
        tag: cleanText(cellMatch[1]).toLowerCase() as 'th' | 'td',
        text: normalizeHtmlText(cellMatch[3] || ''),
        colspan: colspanMatch ? Number(colspanMatch[1]) : 1
      });
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function normalizeAbnHeading(value: string): keyof AbnCurrentDetails | keyof AbnHistoryDetails | '' {
  const key = cleanText(value).toLowerCase().replace(/:$/, '');
  if (key === 'entity name') return 'entityName';
  if (key === 'abn status') return 'abnStatus';
  if (key === 'entity type') return 'entityType';
  if (key.includes('goods') && key.includes('tax')) return 'gst';
  if (key === 'main business location') return 'mainBusinessLocation';
  return '';
}

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

export function buildAbnCurrentPageUrl(abn: string): string {
  return `https://abr.business.gov.au/ABN/View?id=${digitsOnly(abn)}`;
}

export function buildAbnHistoryPageUrl(abn: string): string {
  return `https://abr.business.gov.au/AbnHistory/View?id=${digitsOnly(abn)}`;
}

export function parseAbnCurrentDetailsHtml(html: string): AbnCurrentDetails {
  const current: AbnCurrentDetails = {
    entityName: '',
    abnStatus: '',
    entityType: '',
    gst: '',
    mainBusinessLocation: '',
    abnLastUpdated: '',
    recordExtracted: ''
  };
  for (const cells of parseTableRows(html)) {
    if (cells.length < 2 || cells[0].tag !== 'th' || cells[1].tag !== 'td') continue;
    const heading = normalizeAbnHeading(cells[0].text);
    if (heading && typeof current[heading as keyof AbnCurrentDetails] === 'string') {
      current[heading as keyof AbnCurrentDetails] = cells[1].text;
    }
  }
  const updatedMatch = String(html || '').match(/ABN last updated:\s*<\/strong>\s*([\s\S]*?)<\/li>/i);
  if (updatedMatch) current.abnLastUpdated = normalizeHtmlText(updatedMatch[1] || '');
  const extractedMatch = String(html || '').match(/Record extracted:\s*<\/strong>\s*([\s\S]*?)<\/li>/i);
  if (extractedMatch) current.recordExtracted = normalizeHtmlText(extractedMatch[1] || '');
  return current;
}

export function parseAbnHistoryDetailsHtml(html: string): AbnHistoryDetails {
  const history: AbnHistoryDetails = {
    entityName: [],
    abnStatus: [],
    entityType: '',
    gst: [],
    mainBusinessLocation: []
  };
  let section: keyof AbnHistoryDetails | '' = '';
  for (const cells of parseTableRows(html)) {
    if (!cells.length) continue;
    if (cells[0].tag === 'th') {
      const heading = normalizeAbnHeading(cells[0].text) as keyof AbnHistoryDetails | '';
      if (heading) {
        section = heading;
        continue;
      }
    }
    if (!section) continue;
    if (section === 'entityType') {
      const textCell = cells.find((cell) => cell.tag === 'td');
      if (textCell) history.entityType = textCell.text;
      continue;
    }
    if (cells[0].tag !== 'td') continue;
    const entry = {
      value: cells[0]?.text || '',
      from: cells[1]?.text || '',
      to: cells[2]?.text || ''
    };
    (history[section] as AbnHistoryEntry[]).push(entry);
  }
  return history;
}

export async function fetchAbnHistoryDetails(abn: string, fetcher: typeof fetch = fetch): Promise<AbnHistoryResponse> {
  const normalized = digitsOnly(abn);
  if (normalized.length !== 11) throw new Error('ABN must be 11 digits.');
  const recordUrl = buildAbnCurrentPageUrl(normalized);
  const historyUrl = buildAbnHistoryPageUrl(normalized);
  const [currentResponse, historyResponse] = await Promise.all([
    fetcher(recordUrl, { method: 'GET', cache: 'no-store' }),
    fetcher(historyUrl, { method: 'GET', cache: 'no-store' })
  ]);
  if (!currentResponse.ok) throw new Error(`ABN current details request failed (${currentResponse.status}).`);
  if (!historyResponse.ok) throw new Error(`ABN historical details request failed (${historyResponse.status}).`);
  const [currentHtml, historyHtml] = await Promise.all([currentResponse.text(), historyResponse.text()]);
  return {
    abn: normalized,
    recordUrl,
    historyUrl,
    current: parseAbnCurrentDetailsHtml(currentHtml),
    history: parseAbnHistoryDetailsHtml(historyHtml)
  };
}
