import type { MatterContext } from '../core/types';
import { cleanText } from '../core/text';

const CASE_NUMBER_RE = /\b\d{4}\/\d{1,10}\b|\b\d{12}\b/;

export function splitMatterParties(matterTitle: string): [string, string] {
  const parts = cleanText(matterTitle).split(/\s+v\s+/i);
  if (parts.length < 2) return ['', ''];
  return [cleanText(parts[0]), cleanText(parts.slice(1).join(' v '))];
}

export function parseCourtlistRowCells(cells: string[], url = ''): MatterContext {
  const normalized = cells.map(cleanText);
  const caseSource = normalized[2] || normalized.find((cell) => CASE_NUMBER_RE.test(cell)) || '';
  const caseNumber = caseSource.match(CASE_NUMBER_RE)?.[0] || '';
  const matterTitle = normalized[3] || caseNumber;
  const [plaintiff, defendant] = splitMatterParties(matterTitle);
  return {
    caseNumber,
    matterTitle,
    court: normalized[5] || inferCourt(normalized.join(' ')),
    venue: normalized[8] || '',
    source: 'courtlist',
    url,
    jurisdiction: normalized[4] || '',
    listingType: normalized[6] || '',
    listingDate: cleanText(`${normalized[0] || ''} ${normalized[1] || ''}`),
    plaintiff,
    defendant
  };
}

export function parseCourtlistRowElement(row: Element, url = globalThis.location?.href || ''): MatterContext | null {
  const cells = Array.from(row.querySelectorAll('td')).map((cell) => cleanText(cell.textContent));
  if (cells.length) {
    const matter = parseCourtlistRowCells(cells, url);
    return matter.caseNumber ? matter : null;
  }
  const text = cleanText(row.textContent);
  const caseNumber = text.match(CASE_NUMBER_RE)?.[0] || '';
  if (!caseNumber) return null;
  return { caseNumber, matterTitle: caseNumber, court: inferCourt(text), venue: '', source: 'courtlist', url };
}

export function inferCourt(text: string): string {
  const lower = cleanText(text).toLowerCase();
  if (lower.includes('district')) return 'District Court';
  if (lower.includes('local')) return 'Local Court';
  if (lower.includes('children')) return "Children's Court";
  if (lower.includes('coroner')) return "Coroner's Court";
  return 'Supreme Court';
}
