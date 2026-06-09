import { routeSearch, type ProviderId } from '../core/searchRouter';
import { buildDocumentApplicationPayload } from '../documents/documentApplication';
import { generateApplicationPdfs } from '../documents/pdfGeneration';

export interface CourtlensSettings {
  argusDeltaToken?: string;
  argusDeltaProxyUrl?: string;
  abnGuid?: string;
  applicantName?: string;
  applicantOrganisation?: string;
  applicantEmail?: string;
}

interface Dependencies {
  get: (key: string) => Promise<unknown>;
  set: (items: Record<string, unknown>) => Promise<void>;
  fetcher?: typeof fetch;
  loadAsset?: (path: string) => Promise<Uint8Array | ArrayBuffer>;
}

const SETTINGS_KEY = 'courtlensSettings';

function bytesToBase64(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  if (typeof btoa === 'function') return btoa(binary);
  return Buffer.from(bytes).toString('base64');
}

export function createMessageHandler(deps: Dependencies) {
  return async function handleMessage(message: any): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    try {
      if (message?.type === 'COURTLENS_SAVE_SETTINGS') {
        const current = ((await deps.get(SETTINGS_KEY)) || {}) as CourtlensSettings;
        const next = { ...current, ...(message.settings || {}) };
        await deps.set({ [SETTINGS_KEY]: next });
        return { ok: true, data: { saved: true } };
      }
      if (message?.type === 'COURTLENS_GET_SETTINGS') {
        return { ok: true, data: ((await deps.get(SETTINGS_KEY)) || {}) as CourtlensSettings };
      }
      if (message?.type === 'COURTLENS_SEARCH') {
        const settings = ((await deps.get(SETTINGS_KEY)) || {}) as CourtlensSettings;
        const data = await routeSearch({
          providerId: message.providerId as ProviderId,
          query: message.query,
          exact: Boolean(message.exact),
          limit: message.limit,
          offset: message.offset,
          page: message.page,
          token: settings.argusDeltaToken,
          proxyUrl: settings.argusDeltaProxyUrl,
          abnGuid: settings.abnGuid,
          fetcher: deps.fetcher
        });
        return { ok: true, data };
      }
      if (message?.type === 'COURTLENS_BUILD_DOCUMENT_PAYLOAD' || message?.type === 'COURTLENS_GENERATE_DOCUMENTS') {
        const data = buildDocumentApplicationPayload({
          matter: message.matter,
          requestedDocuments: message.requestedDocuments || [],
          applicant: message.applicant
        });
        if (message.type === 'COURTLENS_BUILD_DOCUMENT_PAYLOAD') return { ok: true, data };
        if (!deps.loadAsset) throw new Error('Document asset loader is not configured.');
        const files = await generateApplicationPdfs(data, {
          mediaTemplate: await deps.loadAsset('forms/access_application_2026.pdf'),
          nonPartyTemplate: await deps.loadAsset('forms/application_non_party_access.pdf'),
          includeMediaAccess: message.includeMediaAccess !== false,
          includeNonPartyAccess: message.includeNonPartyAccess !== false
        });
        return {
          ok: true,
          data: {
            ...data,
            attachments: files.map((file) => ({ name: file.name, mime: 'application/pdf', base64: bytesToBase64(file.bytes) }))
          }
        };
      }
      return { ok: false, error: `Unsupported message type: ${message?.type || 'unknown'}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}
