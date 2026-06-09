import type { EntityCandidate, EntityType } from '../core/types';
import { cleanText, dedupeBy, slug } from '../core/text';

function candidate(name: string, type: EntityType, confidence = 0.74): EntityCandidate {
  return {
    id: `judgment-${type}-${slug(name)}`,
    name: cleanText(name),
    originalText: cleanText(name),
    type,
    group: type === 'judge' ? 'Judges' : type === 'company' ? 'Companies' : type === 'council' ? 'Councils' : type === 'government' ? 'Government' : 'People',
    confidence,
    source: 'judgment-body'
  };
}

export function extractJudgmentEntities(text: string): EntityCandidate[] {
  const body = cleanText(text);
  const entities: EntityCandidate[] = [];
  for (const match of body.matchAll(/\b([A-Z][a-z]+\s+J)\b/g)) entities.push(candidate(match[1], 'judge', 0.9));
  for (const match of body.matchAll(/\b([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){1,3}\s+(?:Pty\s+Ltd|Limited|Ltd|Corporation|Corp))\b/g)) entities.push(candidate(match[1], 'company', 0.86));
  for (const match of body.matchAll(/\b([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+)*\s+Council)\b/g)) entities.push(candidate(match[1], 'council', 0.86));
  for (const match of body.matchAll(/\b(NSW\s+(?:Police|Health|Government|Trustee|Department)|State\s+of\s+New\s+South\s+Wales)\b/g)) entities.push(candidate(match[1], 'government', 0.82));
  const protectedEntityNames = entities.map((entity) => entity.name.toLowerCase());
  const people: EntityCandidate[] = [];
  for (const match of body.matchAll(/\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/g)) {
    const name = match[1];
    const lower = name.toLowerCase();
    if (/\b(?:Pty|Ltd|Council|Police|South Wales)\b/.test(name)) continue;
    if (protectedEntityNames.some((entityName) => entityName.includes(lower))) continue;
    people.push(candidate(name, 'person', 0.68));
  }
  const grouped = [
    ...entities.filter((entity) => entity.type === 'judge'),
    ...people,
    ...entities.filter((entity) => entity.type !== 'judge')
  ];
  return dedupeBy(grouped, (entity) => entity.name);
}
