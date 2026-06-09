import type { EntityCandidate } from '../core/types';
import { cleanText, dedupeBy, slug, smartCase } from '../core/text';

interface PartyMatterInput {
  matterTitle: string;
  jurisdiction?: string;
}

function stripNoise(text: string): string {
  return cleanText(text)
    .replace(/^notice\s+of\s+motion(?:\s+civil)?\s*[-:]\s*/i, '')
    .replace(/^in\s+the\s+matter\s+of\s+/i, '');
}

function stripCorporateSuffix(text: string): string {
  return cleanText(text).replace(/\s+(?:pty|proprietary)\.?\s*(?:ltd|limited)\.?$/i, '');
}

function cleanEntity(text: string): string {
  return smartCase(stripCorporateSuffix(cleanText(text).replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, '').replace(/^the\s+/i, '')));
}

function splitOnV(text: string): [string, string] | null {
  const match = cleanText(text).match(/\s+v\s+/i);
  if (!match || typeof match.index !== 'number') return null;
  return [cleanText(text.slice(0, match.index)), cleanText(text.slice(match.index + match[0].length))];
}

function expandSegment(segment: string): string[] {
  const text = stripNoise(segment);
  if (!text) return [];
  const patterns = [/\bby\s+(?:his|her|their)\s+tutor\s+/i, /\blitigation\s+guardian\s+for\s+/i, /\b(?:on|of)\s+behalf\s+of\s+/i, /\btrading\s+as(?:\s+as)?\s+/i, /\bformerly\s+known\s+as\s+/i];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && typeof match.index === 'number') {
      return [text.slice(0, match.index), text.slice(match.index + match[0].length)].map(cleanEntity).filter(Boolean);
    }
  }
  return text.split(/\s*&\s*/g).map(cleanEntity).filter(Boolean);
}

function isCriminal(matter: PartyMatterInput): boolean {
  return cleanText(matter.jurisdiction).toLowerCase().includes('criminal') || /^\s*r\s+v\s+/i.test(matter.matterTitle);
}

export function parseNewsSearchCandidates(matter: PartyMatterInput): EntityCandidate[] {
  const matterTitle = cleanText(matter.matterTitle);
  if (!matterTitle) return [];
  const stripped = stripNoise(matterTitle);
  const split = splitOnV(stripped);
  const names = split
    ? isCriminal(matter)
      ? expandSegment(split[1])
      : [...expandSegment(split[0]), ...expandSegment(split[1])]
    : expandSegment(stripped);

  return dedupeBy(names, (name) => name).map((name) => ({
    id: `courtlist-${slug(name)}`,
    name,
    originalText: name,
    type: /\b(?:pty|ltd|limited|corp|company|co)\b/i.test(name) ? 'company' : 'party',
    group: 'Parties',
    confidence: 0.86,
    source: 'courtlist'
  }));
}

export function buildGoogleNewsRssUrl(query: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(cleanText(query))}&hl=en-AU&gl=AU&ceid=AU:en`;
}
