import type { EntityCandidate } from '../core/types';
import { cleanText, dedupeBy, slug } from '../core/text';

interface LocalNerEntity {
  text?: string;
  name?: string;
  span?: string;
  value?: string;
  label?: string;
  type?: string;
  tag?: string;
  entity_type?: string;
  score?: number;
  confidence?: number;
  probability?: number;
}

interface LocalNerPayload {
  entities?: LocalNerEntity[];
  predictions?: LocalNerEntity[];
  results?: LocalNerEntity[];
}

const allowedLocalNerTypes = new Set<EntityCandidate['type']>(['person', 'law_firm', 'judge']);

function localNerItems(payload: LocalNerPayload): LocalNerEntity[] {
  return payload.entities || payload.predictions || payload.results || [];
}

function labelToType(label: string): EntityCandidate['type'] {
  const key = cleanText(label).toLowerCase().replace(/[\s-]+/g, '_');
  if (key.includes('judge') || key === 'judicial_officer') return 'judge';
  if (key.includes('law_firm') || key.includes('lawfirm') || key.includes('firm') || key.includes('solicitor_firm') || key.includes('legal_practice')) return 'law_firm';
  if (key.includes('person') || key.includes('per') || key.includes('people') || key.includes('individual')) return 'person';
  return 'unknown';
}

export function normalizeLocalNerResponse(payload: LocalNerPayload, options: { source?: EntityCandidate['source'] } = {}): EntityCandidate[] {
  const source = options.source || 'local-ner';
  const entities = localNerItems(payload).map((item) => {
    const name = cleanText(item.text || item.name || item.span || item.value);
    const type = labelToType(item.label || item.type || item.tag || item.entity_type || '');
    return {
      id: `${source}-${type}-${slug(name)}`,
      name,
      originalText: name,
      type,
      group: type === 'law_firm' ? 'Law firms' : type === 'judge' ? 'Judges' : 'People',
      confidence: Number(item.score ?? item.confidence ?? item.probability ?? 0.7),
      source
    } satisfies EntityCandidate;
  }).filter((entity) => entity.name && allowedLocalNerTypes.has(entity.type));
  return dedupeBy(entities, (entity) => entity.name);
}

function isAllowedTailscaleIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part));
  return parts.length === 4
    && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && parts[0] === 100
    && parts[1] >= 64
    && parts[1] <= 127;
}

export function assertLoopbackNerEndpoint(endpoint: string): string {
  const cleaned = cleanText(endpoint);
  if (!cleaned) throw new Error('Local NER endpoint is not configured. Add it in Settings.');
  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    throw new Error('Local NER endpoint must be a valid loopback or Tailscale URL.');
  }
  const allowedHosts = new Set(['127.0.0.1', 'localhost']);
  const allowedHost = allowedHosts.has(url.hostname) || isAllowedTailscaleIpv4(url.hostname);
  if (url.protocol !== 'http:' || !allowedHost) {
    throw new Error('Local NER endpoint must use http://127.0.0.1, http://localhost, or a Tailscale 100.64.0.0/10 IP.');
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
