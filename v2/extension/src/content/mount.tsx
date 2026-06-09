import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CourtlensSidebar } from '../sidebar/CourtlensSidebar';
import sidebarCss from '../styles/sidebar.css?inline';
import type { EntityCandidate, MatterContext, ProviderResultPage } from '../core/types';
import type { ProviderId } from '../core/searchRouter';

let root: Root | null = null;
let host: HTMLElement | null = null;

export function openCourtlensSidebar(matter: MatterContext, entities: EntityCandidate[] = []): void {
  if (!host) {
    host = document.createElement('div');
    host.id = 'argus-delta-courtlens-root';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = sidebarCss;
    const mount = document.createElement('div');
    shadow.append(style, mount);
    document.documentElement.appendChild(host);
    root = createRoot(mount);
  }
  const onSearch = async (input: { providerId: ProviderId; query: string; exact: boolean }): Promise<ProviderResultPage> => {
    const response = await chrome.runtime.sendMessage({ type: 'COURTLENS_SEARCH', ...input });
    if (!response?.ok) throw new Error(response?.error || 'Search failed');
    return response.data;
  };
  const onLoadSettings = async () => {
    const response = await chrome.runtime.sendMessage({ type: 'COURTLENS_GET_SETTINGS' });
    if (!response?.ok) throw new Error(response?.error || 'Settings load failed');
    return response.data;
  };
  const onSaveSettings = async (settings: { argusDeltaToken?: string; argusDeltaProxyUrl?: string; abnGuid?: string; applicantName?: string; applicantOrganisation?: string; applicantEmail?: string }): Promise<void> => {
    const response = await chrome.runtime.sendMessage({ type: 'COURTLENS_SAVE_SETTINGS', settings });
    if (!response?.ok) throw new Error(response?.error || 'Settings save failed');
  };
  const onGenerateDocuments = async (input: { matter: unknown; requestedDocuments: string[]; applicant: unknown }) => {
    const response = await chrome.runtime.sendMessage({ type: 'COURTLENS_GENERATE_DOCUMENTS', ...input });
    if (!response?.ok) throw new Error(response?.error || 'Document generation failed');
    return response.data;
  };
  const onAbnHistory = async (abn: string) => {
    const response = await chrome.runtime.sendMessage({ type: 'COURTLENS_ABN_HISTORY_DETAILS', abn });
    if (!response?.ok) throw new Error(response?.error || 'ABN history failed');
    return response.data;
  };
  const onOpenGmailDraft = async (email: { to: string; subject: string; body: string }) => {
    const response = await chrome.runtime.sendMessage({ type: 'COURTLENS_OPEN_GMAIL_DRAFT', email });
    if (!response?.ok) throw new Error(response?.error || 'Gmail draft failed');
    return response.data;
  };
  root?.render(<CourtlensSidebar initialContext={{ matter, entities }} onSearch={onSearch} onLoadSettings={onLoadSettings} onSaveSettings={onSaveSettings} onGenerateDocuments={onGenerateDocuments} onAbnHistory={onAbnHistory} onOpenGmailDraft={onOpenGmailDraft} />);
}
