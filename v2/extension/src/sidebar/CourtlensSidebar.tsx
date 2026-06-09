import React, { useMemo, useState } from 'react';
import type { MatterContext, ProviderResultPage } from '../core/types';
import { parseNewsSearchCandidates } from '../parsers/partyParser';
import { buildDocumentApplicationPayload } from '../documents/documentApplication';
import type { ProviderId } from '../core/searchRouter';

interface SettingsDraft {
  argusDeltaToken?: string;
  argusDeltaProxyUrl?: string;
  abnGuid?: string;
  applicantName?: string;
  applicantOrganisation?: string;
  applicantEmail?: string;
}

interface GeneratedAttachment {
  name: string;
  mime: string;
  base64: string;
}

interface AbnHistoryView {
  abn: string;
  current: {
    entityName: string;
    abnStatus: string;
    entityType: string;
    gst: string;
    mainBusinessLocation: string;
    abnLastUpdated: string;
    recordExtracted: string;
  };
}

interface Props {
  initialContext: { matter: MatterContext };
  onSearch?: (input: { providerId: ProviderId; query: string; exact: boolean }) => Promise<ProviderResultPage>;
  onSaveSettings?: (settings: SettingsDraft) => Promise<void>;
  onGenerateDocuments?: (input: { matter: MatterContext; requestedDocuments: string[]; applicant: { name: string; organisation: string; email: string } }) => Promise<{ attachments: GeneratedAttachment[] }>;
  onAbnHistory?: (abn: string) => Promise<AbnHistoryView>;
  onOpenGmailDraft?: (email: { to: string; subject: string; body: string }) => Promise<{ tabId?: number }>;
}

const tabs = ['Overview', 'Research', 'Documents', 'Settings'] as const;
type Tab = typeof tabs[number];

function tabId(tab: Tab): string {
  return `cl-tab-${tab.toLowerCase()}`;
}

function panelId(tab: Tab): string {
  return `cl-panel-${tab.toLowerCase()}`;
}

export function CourtlensSidebar({ initialContext, onSearch, onSaveSettings, onGenerateDocuments, onAbnHistory, onOpenGmailDraft }: Props) {
  const [active, setActive] = useState<Tab>('Overview');
  const [exact, setExact] = useState(true);
  const [result, setResult] = useState<ProviderResultPage | null>(null);
  const [status, setStatus] = useState('Ready');
  const [settings, setSettings] = useState<SettingsDraft>({});
  const [attachments, setAttachments] = useState<GeneratedAttachment[]>([]);
  const [abnDetails, setAbnDetails] = useState<Record<string, AbnHistoryView>>({});
  const matter = initialContext.matter;
  const candidates = useMemo(
    () => parseNewsSearchCandidates({ matterTitle: matter.matterTitle, jurisdiction: matter.jurisdiction }),
    [matter.matterTitle, matter.jurisdiction]
  );
  const primary = candidates[0]?.name || matter.plaintiff || matter.matterTitle;
  const payload = buildDocumentApplicationPayload({
    matter,
    requestedDocuments: ['Statement of Claim', 'Submissions', 'Orders'],
    applicant: { name: 'Applicant', organisation: 'Argus Delta', email: 'configure@example.invalid' }
  });

  async function runSearch(providerId: ProviderId) {
    setStatus(`Searching ${providerId}…`);
    try {
      const page = await (onSearch
        ? onSearch({ providerId, query: primary, exact })
        : Promise.resolve({ providerId, query: primary, items: [], hasMore: false }));
      setResult(page);
      setStatus(page.items.length ? `${page.items.length} result(s)` : 'No results returned');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function openGmailDraft() {
    setStatus('Opening Gmail draft…');
    try {
      await onOpenGmailDraft?.(payload.email);
      setStatus('Gmail draft opened');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function showAbnHistory(abn: string) {
    setStatus('Loading ABN history…');
    try {
      const details = await onAbnHistory?.(abn);
      if (details) setAbnDetails((current) => ({ ...current, [abn]: details }));
      setStatus(details ? 'ABN history loaded' : 'ABN history unavailable');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function generateDocuments() {
    setStatus('Generating PDFs…');
    try {
      const response = await onGenerateDocuments?.({
        matter,
        requestedDocuments: payload.requestedDocuments,
        applicant: payload.applicant
      });
      setAttachments(response?.attachments || []);
      setStatus(response?.attachments?.length ? `${response.attachments.length} PDF(s) generated` : 'No PDFs generated');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveSettings() {
    const cleanSettings = Object.fromEntries(
      Object.entries(settings).filter(([, value]) => typeof value === 'string' && value.length > 0 && value !== '••••••••')
    ) as SettingsDraft;
    await onSaveSettings?.(cleanSettings);
    setSettings((current) => ({
      ...current,
      argusDeltaToken: current.argusDeltaToken ? '••••••••' : '',
      abnGuid: current.abnGuid ? '••••••••' : ''
    }));
    setStatus('Settings saved locally');
  }

  return (
    <aside className="cl-shell" aria-label="Argus Delta Courtlens">
      <header className="cl-header">
        <p className="cl-eyebrow">Argus Delta</p>
        <h1>Courtlens</h1>
        <span className="cl-status" role="status" aria-live="polite">{status}</span>
      </header>

      <nav className="cl-tabs" role="tablist" aria-label="Courtlens sections">
        {tabs.map((tab) => (
          <button
            id={tabId(tab)}
            key={tab}
            role="tab"
            aria-selected={active === tab}
            aria-controls={panelId(tab)}
            tabIndex={active === tab ? 0 : -1}
            onClick={() => setActive(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>

      <main className="cl-panel">
        <section id={panelId('Overview')} role="tabpanel" aria-labelledby={tabId('Overview')} hidden={active !== 'Overview'} className="cl-stack">
          <div className="cl-card cl-hero-card">
            <span className="cl-badge">{matter.source}</span>
            <h2>{matter.matterTitle}</h2>
            <p>{matter.caseNumber} · {matter.court} · {matter.venue || 'Venue unknown'}</p>
          </div>
          <div className="cl-card">
            <h3>Detected entities</h3>
            <div className="cl-chip-row">{candidates.map((candidate) => <span className="cl-chip" key={candidate.id}>{candidate.name}</span>)}</div>
          </div>
        </section>

        <section id={panelId('Research')} role="tabpanel" aria-labelledby={tabId('Research')} hidden={active !== 'Research'} className="cl-stack">
          <label className="cl-switch"><input type="checkbox" checked={exact} onChange={(event) => setExact(event.currentTarget.checked)} /> Exact mode</label>
          <div className="cl-grid">
            {(['argus-delta', 'news', 'abn', 'federal-court', 'nsw-caselaw'] as ProviderId[]).map((provider) => (
              <button className="cl-provider" key={provider} onClick={() => runSearch(provider)}>
                Search {provider === 'argus-delta' ? 'Argus Delta' : provider}
              </button>
            ))}
          </div>
          {result && (
            <div className="cl-card">
              <h3>{result.providerId}</h3>
              {result.items.length
                ? result.items.map((item) => {
                  const abn = String((item as { abn?: string }).abn || item.badges.find((badge) => /^\d{11}$/.test(badge)) || '');
                  const details = abn ? abnDetails[abn] : null;
                  return (
                    <article className="cl-result" key={item.id}>
                      <strong>{item.title}</strong>
                      <span>{item.subtitle}</span>
                      {result.providerId === 'abn' && abn && <button className="cl-link-button" onClick={() => showAbnHistory(abn)}>Show ABN history</button>}
                      {details && <div className="cl-abn-details"><span>{details.current.abnStatus}</span><span>{details.current.entityType}</span><span>{details.current.gst}</span><span>Record extracted: {details.current.recordExtracted}</span></div>}
                    </article>
                  );
                })
                : <p>Clear empty state: no matching records.</p>}
            </div>
          )}
        </section>

        <section id={panelId('Documents')} role="tabpanel" aria-labelledby={tabId('Documents')} hidden={active !== 'Documents'} className="cl-card cl-documents">
          <h2>Application payload</h2>
          <button className="cl-provider" onClick={generateDocuments}>Generate PDFs</button>
          <button className="cl-provider" onClick={openGmailDraft}>Open Gmail draft</button>
          {attachments.length > 0 && (
            <div className="cl-attachments" aria-label="Generated attachments">
              {attachments.map((attachment) => <span className="cl-chip" key={attachment.name}>{attachment.name}</span>)}
            </div>
          )}
          <pre>{JSON.stringify(payload, null, 2)}</pre>
        </section>

        <section id={panelId('Settings')} role="tabpanel" aria-labelledby={tabId('Settings')} hidden={active !== 'Settings'} className="cl-card cl-form">
          <h2>Settings</h2>
          <p>Store private values in Chrome local storage. Secrets are masked after save.</p>
          <label>Argus Delta token<input aria-label="Argus Delta token" autoComplete="off" type="password" value={settings.argusDeltaToken || ''} onChange={(event) => setSettings({ ...settings, argusDeltaToken: event.currentTarget.value })} /></label>
          <label>Argus proxy URL<input aria-label="Argus proxy URL" autoComplete="url" value={settings.argusDeltaProxyUrl || ''} onChange={(event) => setSettings({ ...settings, argusDeltaProxyUrl: event.currentTarget.value })} /></label>
          <label>ABN GUID<input aria-label="ABN GUID" autoComplete="off" type="password" value={settings.abnGuid || ''} onChange={(event) => setSettings({ ...settings, abnGuid: event.currentTarget.value })} /></label>
          <label>Applicant email<input aria-label="Applicant email" autoComplete="email" value={settings.applicantEmail || ''} onChange={(event) => setSettings({ ...settings, applicantEmail: event.currentTarget.value })} /></label>
          <button className="cl-provider" onClick={saveSettings}>Save settings</button>
        </section>
      </main>
    </aside>
  );
}
