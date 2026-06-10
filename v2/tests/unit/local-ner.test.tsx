import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { normalizeLocalNerResponse, extractEntitiesWithLocalNer, assertLoopbackNerEndpoint } from '../../extension/src/providers/localNerProvider';
import { createMessageHandler } from '../../extension/src/background/messageHandler';
import { CourtlensSidebar } from '../../extension/src/sidebar/CourtlensSidebar';

const matter = {
  caseNumber: '2025/00490454',
  matterTitle: 'Mitchell v State of New South Wales [2026] NSWSC 122',
  court: 'Supreme Court of New South Wales',
  venue: 'Sydney',
  source: 'caselaw' as const,
  url: 'https://www.caselaw.nsw.gov.au/decision/mock'
};

const nerPayload = {
  entities: [
    { text: 'Jane Citizen', label: 'PERSON', score: 0.96 },
    { text: 'Acme Legal', label: 'LAW_FIRM', score: 0.91 },
    { text: 'Acme Pty Ltd', label: 'ORG', score: 0.89 },
    { text: 'NSW Police', label: 'GOVERNMENT_AGENCY', score: 0.88 },
    { text: 'Harrison J', label: 'JUDGE', score: 0.93 }
  ]
};

const refinedHarnessPayload = {
  predictions: [
    { span: 'Jane Citizen', entity_type: 'person', probability: 0.96 },
    { span: 'Example & Co Lawyers', entity_type: 'solicitor_firm', probability: 0.92 },
    { span: 'Harrison J', entity_type: 'judicial officer', probability: 0.93 },
    { span: 'State of New South Wales', entity_type: 'government', probability: 0.94 }
  ]
};

describe('local NER / GLiNER-compatible seam', () => {
  it('normalizes and filters local NER labels to people, law firms, and judges only', () => {
    const entities = normalizeLocalNerResponse(nerPayload, { source: 'local-ner' });
    expect(entities.map((entity) => [entity.name, entity.type, entity.confidence])).toEqual([
      ['Jane Citizen', 'person', 0.96],
      ['Acme Legal', 'law_firm', 0.91],
      ['Harrison J', 'judge', 0.93]
    ]);
  });

  it('accepts refined harness prediction shape without surfacing disallowed tags', () => {
    const entities = normalizeLocalNerResponse(refinedHarnessPayload, { source: 'local-ner' });
    expect(entities.map((entity) => [entity.name, entity.type, entity.confidence])).toEqual([
      ['Jane Citizen', 'person', 0.96],
      ['Example & Co Lawyers', 'law_firm', 0.92],
      ['Harrison J', 'judge', 0.93]
    ]);
  });

  it('allows loopback and Tailscale NER endpoints but rejects public and ordinary LAN endpoints before fetch', async () => {
    expect(() => assertLoopbackNerEndpoint('https://example.com/extract')).toThrow(/127\.0\.0\.1|localhost|Tailscale/);
    expect(() => assertLoopbackNerEndpoint('http://192.168.1.10/extract')).toThrow(/127\.0\.0\.1|localhost|Tailscale/);
    expect(() => assertLoopbackNerEndpoint('http://100.128.0.1/extract')).toThrow(/127\.0\.0\.1|localhost|Tailscale/);
    expect(assertLoopbackNerEndpoint('http://localhost:8766/extract')).toBe('http://localhost:8766/extract');
    expect(assertLoopbackNerEndpoint('http://100.89.36.94:8766/extract')).toBe('http://100.89.36.94:8766/extract');
  });

  it('posts judgment text to the configured local NER endpoint', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => nerPayload,
      init
    })) as unknown as typeof fetch;

    const entities = await extractEntitiesWithLocalNer({ endpoint: 'http://127.0.0.1:8766/extract', text: 'Judgment body', fetcher });

    expect(entities[0].name).toBe('Jane Citizen');
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe('http://127.0.0.1:8766/extract');
    expect(JSON.parse(String((vi.mocked(fetcher).mock.calls[0][1] as RequestInit).body))).toEqual({ text: 'Judgment body' });
  });

  it('background route uses stored local NER endpoint', async () => {
    const handler = createMessageHandler({
      get: async () => ({ localNerEndpoint: 'http://127.0.0.1:8766/extract' }),
      set: async () => undefined,
      fetcher: vi.fn(async () => ({ ok: true, status: 200, json: async () => nerPayload })) as unknown as typeof fetch
    });

    const result = await handler({ type: 'COURTLENS_EXTRACT_ENTITIES', text: 'Judgment body' });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Jane Citizen', type: 'person' })]));
  });

  it('sidebar can enhance caselaw entities with local NER results', async () => {
    const onExtractEntities = vi.fn(async () => normalizeLocalNerResponse(nerPayload, { source: 'local-ner' }));
    render(<CourtlensSidebar initialContext={{ matter, documentText: 'Judgment body' }} onExtractEntities={onExtractEntities} />);

    fireEvent.click(screen.getByRole('button', { name: /enhance entities/i }));

    await waitFor(() => expect(onExtractEntities).toHaveBeenCalledWith('Judgment body'));
    expect(await screen.findByText('Jane Citizen')).toBeInTheDocument();
    expect(screen.getByText('Acme Legal')).toBeInTheDocument();
    expect(screen.queryByText('Acme Pty Ltd')).not.toBeInTheDocument();
    expect(screen.queryByText('NSW Police')).not.toBeInTheDocument();
  });
});
