import { parseCourtlistRowElement } from '../parsers/nswCourtlistParser';
import { openCourtlensSidebar } from './mount';

export function injectCourtlensButton(row: Element, onOpen: (row: Element) => void): void {
  if (row.querySelector('[data-courtlens-open]')) return;
  const cell = document.createElement('td');
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Courtlens';
  button.setAttribute('data-courtlens-open', 'true');
  button.style.cssText = 'border:0;border-radius:999px;padding:6px 10px;background:#2b251c;color:#fff7e8;font:700 12px system-ui;cursor:pointer;';
  button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); onOpen(row); });
  cell.appendChild(button);
  row.appendChild(cell);
}

export function scanCourtlistRows(root: ParentNode = document): void {
  root.querySelectorAll('tr').forEach((row) => {
    const matter = parseCourtlistRowElement(row);
    if (!matter) return;
    injectCourtlensButton(row, () => openCourtlensSidebar(matter));
  });
}

if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
  scanCourtlistRows();
  new MutationObserver(() => scanCourtlistRows()).observe(document.documentElement, { childList: true, subtree: true });
}
