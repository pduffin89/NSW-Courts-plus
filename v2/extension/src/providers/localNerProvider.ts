import type { EntityCandidate } from '../core/types';
import { cleanText, dedupeBy, slug } from '../core/text';

interface LocalNerEntity {
  text?: string;
  name?: string;
  label?: string;
  type?: string;
  score?: number;
  confidence?: number;
}

interface LocalNerPayload {
  entities?: LocalNerEntity[];
}

function labelToType(label: string): EntityCandidate['type'] {
  const key = cleanText(label).toLowerCase();
  if (key.includes('judge')) return 'judge';
  if (key.includes('council')) return 'council';
  if (key.includes('government') || key === 'gov' || key.includes('agency')) return 'government';
  if (key.includes('company') || key.includes('org') || key.includes('corporate')) return 'company';
  if (key.includes('lawyer') || key.includes('representative') || key.includes('barrister') || key.includes('solicitor')) return 'legal_representative';
  if (key.includes('person') || key.includes('per')) return 'person';
  return 'unknown';
}

export function normalizeLocalNerResponse(payload: LocalNerPayload, options: { source?: EntityCandidate['source'] } = {}): EntityCandidate[] {
  const source = options.source || 'local-ner';
  const entities = (payload.entities || []).map((item) => {
    const name = cleanText(item.text || item.name);
    const type = labelToType(item.label || item.type || '');
    return {
      id: `${source}-${type}-${slug(name)}`,
      name,
      originalText: name,
      type,
      group: type === 'unknown' ? 'Entities' : `${type.slice(0, 1).toUpperCase()}${type.slice(1).replace(/_/g, ' ')}`,
      confidence: Number(item.score ?? item.confidence ?? 0.7),
      source
    } satisfies EntityCandidate;
  }).filter((entity) => entity.name);
  return dedupeBy(entities, (entity) => entity.name);
}

export function assertLoopbackNerEndpoint(endpoint: string): string {
  const cleaned = cleanText(endpoint);
  if (!cleaned) throw new Error('Local NER endpoint is not configured. Add it in Settings.');
  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    throw new Error('Local NER endpoint must be a valid loopback URL.');
  }
  const allowedHosts = new Set(['127.0.0.1', 'localhost']);
  if (url.protocol !== 'http:' || !allowedHosts.has(url.hostname)) {
    throw new Error('Local NER endpoint must use http://127.0.0.1 or http://localhost.');
  }
  return url.toString();
}

export async function extractEntitiesWithLocalNer(options: { endpoint: string; text: string; fetcher?: typeof fetch }): Promise<EntityCandidate[]> {
  const endpoint = assertLoopbackNerEndpoint(options.endpoint);
  const response = await (options.fetcher || fetch)(endpoint, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: options.text })
  });
  if (!response.ok) throw new Error(`Local NER request failed (${response.status}).`);
  return normalizeLocalNerResponse(await response.json(), { source: 'local-ner' });
}
