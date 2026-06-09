import type { MatterContext } from '../core/types';
import { cleanText } from '../core/text';

const CASE_NUMBER_RE = /\b\d{4}\/\d{1,10}\b|\b\d{12}\b/;

function valueAfterLabel(document: Document, label: string): string {
  const terms = Array.from(document.querySelectorAll('dt'));
  const term = terms.find((dt) => cleanText(dt.textContent).toLowerCase().startsWith(label.toLowerCase()));
  if (term?.nextElementSibling) return cleanText(term.nextElementSibling.textContent);
  const text = cleanText(document.body.textContent);
  const match = text.match(new RegExp(`${label}\\s+([^\\n]+?)(?:Court|File|Decision|Judge|$)`, 'i'));
  return cleanText(match?.[1] || '');
}

export function extractCaselawMetadata(document: Document, url = document.location?.href || ''): MatterContext {
  const title = cleanText(document.querySelector('h1')?.textContent || document.title);
  const court = valueAfterLabel(document, 'Court');
  const fileText = valueAfterLabel(document, 'File number');
  const judgeText = valueAfterLabel(document, 'Judge');
  return {
    matterTitle: title,
    caseNumber: fileText.match(CASE_NUMBER_RE)?.[0] || '',
    court,
    venue: court.includes('Supreme') ? 'Sydney' : '',
    source: 'caselaw',
    url,
    decisionDate: valueAfterLabel(document, 'Decision date'),
    judges: judgeText.split(/[,;]\s*/).map(cleanText).filter(Boolean),
    citations: Array.from(title.matchAll(/\[[0-9]{4}\]\s+[A-Z]+\s+\d+/g)).map((match) => match[0])
  };
}
