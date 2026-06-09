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

interface Props {
  initialContext: { matter: MatterContext };
  onSearch?: (input: { providerId: ProviderId; query: string; exact: boolean }) => Promise<ProviderResultPage>;
  onSaveSettings?: (settings: SettingsDraft) => Promise<void>;
}

const tabs = ['Overview', 'Research', 'Documents', 'Settings'] as const;

type Tab = typeof tabs[number];

export function CourtlensSidebar({ initialContext, onSearch, onSaveSettings }: Props) {
  const [active, setActive] = useState<Tab>('Overview');
  const [exact, setExact] = useState(true);
  const [result, setResult] = useState<ProviderResultPage | null>(null);
  const [status, setStatus] = useState('Ready');
  const [settings, setSettings] = useState<SettingsDraft>({});
  const matter = initialContext.matter;
  const candidates = useMemo(() => parseNewsSearchCandidates({ matterTitle: matter.matterTitle, jurisdiction: matter.jurisdiction }), [matter.matterTitle, matter.jurisdiction]);
  const primary = candidates[0]?.name || matter.plaintiff || matter.matterTitle;
  const payload = buildDocumentApplicationPayload({
    matter,
    requestedDocuments: ['Statement of Claim', 'Submissions', 'Orders'],
    applicant: { name: 'Applicant', organisation: 'Argus Delta', email: 'configure@example.invalid' }
  });

  async function runSearch(providerId: ProviderId) {
    setStatus(`Searching ${providerId}…`);
    try {
      const page = await (onSearch ? onSearch({ providerId, query: primary, exact }) : Promise.resolve({ providerId, query: primary, items: [], hasMore: false }));
      setResult(page);
      setStatus(page.items.length ? `${page.items.length} result(s)` : 'No results returned');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveSettings() {
    await onSaveSettings?.(settings);
    setSettings((current) => ({ ...current, argusDeltaToken: current.argusDeltaToken ? '••••••••' : '', abnGuid: current.abnGuid ? '••••••••' : '' }));
    setStatus('Settings saved locally');
  }

  return (
    <aside className="cl-shell" aria-label="Argus Delta Courtlens">
      <header className="cl-header">
        <p className="cl-eyebrow">Argus Delta</p>
        <h1>Courtlens</h1>
        <span className="cl-status">{status}</span>
      </header>
      <nav className="cl-tabs" role="tablist" aria-label="Courtlens sections">
        {tabs.map((tab) => <button key={tab} role="tab" aria-selected={active === tab} onClick={() => setActive(tab)}>{tab}</button>)}
      </nav>
      <main className="cl-panel">
        {active === 'Overview' && (
          <section className="cl-stack">
            <div className="cl-card cl-hero-card"><span className="cl-badge">{matter.source}</span><h2>{matter.matterTitle}</h2><p>{matter.caseNumber} · {matter.court} · {matter.venue || 'Venue unknown'}</p></div>
            <div className="cl-card"><h3>Detected entities</h3><div className="cl-chip-row">{candidates.map((c) => <span className="cl-chip" key={c.id}>{c.name}</span>)}</div></div>
          </section>
        )}
        {active === 'Research' && (
          <section className="cl-stack">
            <label className="cl-switch"><input type="checkbox" checked={exact} onChange={(event) => setExact(event.currentTarget.checked)} /> Exact mode</label>
            <div className="cl-grid">
              {(['argus-delta', 'news', 'abn', 'federal-court', 'nsw-caselaw'] as ProviderId[]).map((provider) => <button className="cl-provider" key={provider} onClick={() => runSearch(provider)}>Search {provider === 'argus-delta' ? 'Argus Delta' : provider}</button>)}
            </div>
            {result && <div className="cl-card"><h3>{result.providerId}</h3>{result.items.length ? result.items.map((item) => <article className="cl-result" key={item.id}><strong>{item.title}</strong><span>{item.subtitle}</span></article>) : <p>Clear empty state: no matching records.</p>}</div>}
          </section>
        )}
        {active === 'Documents' && <section className="cl-card"><h2>Application payload</h2><pre>{JSON.stringify(payload, null, 2)}</pre></section>}
        {active === 'Settings' && <section className="cl-card cl-form"><h2>Settings</h2><p>Store private values in Chrome local storage. Secrets are masked after save.</p><label>Argus Delta token<input aria-label="Argus Delta token" type="password" value={settings.argusDeltaToken || ''} onChange={(event) => setSettings({ ...settings, argusDeltaToken: event.currentTarget.value })} /></label><label>Argus proxy URL<input aria-label="Argus proxy URL" value={settings.argusDeltaProxyUrl || ''} onChange={(event) => setSettings({ ...settings, argusDeltaProxyUrl: event.currentTarget.value })} /></label><label>ABN GUID<input aria-label="ABN GUID" type="password" value={settings.abnGuid || ''} onChange={(event) => setSettings({ ...settings, abnGuid: event.currentTarget.value })} /></label><label>Applicant email<input aria-label="Applicant email" value={settings.applicantEmail || ''} onChange={(event) => setSettings({ ...settings, applicantEmail: event.currentTarget.value })} /></label><button className="cl-provider" onClick={saveSettings}>Save settings</button></section>}
      </main>
    </aside>
  );
}
