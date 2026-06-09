import { extractCaselawMetadata } from '../parsers/nswCaselawParser';
import { extractJudgmentEntities } from '../parsers/judgmentEntityParser';
import { openCourtlensSidebar } from './mount';

export function readCaselawPageContext(documentRef: Document = document) {
  const matter = extractCaselawMetadata(documentRef);
  const entities = extractJudgmentEntities(documentRef.body?.textContent || '');
  return { matter, entities, documentText: documentRef.body?.textContent || '' };
}

export function injectCaselawLauncher(): void {
  if (document.querySelector('[data-courtlens-caselaw-launcher]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Open Courtlens';
  button.setAttribute('data-courtlens-caselaw-launcher', 'true');
  button.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;border:0;border-radius:999px;padding:12px 16px;background:#2b251c;color:#fff7e8;font:800 13px system-ui;box-shadow:0 12px 32px rgba(0,0,0,.25);cursor:pointer;';
  button.addEventListener('click', () => {
    const context = readCaselawPageContext();
    openCourtlensSidebar(context.matter, context.entities, context.documentText);
  });
  document.documentElement.appendChild(button);
}

if (typeof chrome !== 'undefined' && chrome.runtime?.id) injectCaselawLauncher();
