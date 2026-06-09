import { createMessageHandler } from './messageHandler';

const handler = createMessageHandler({
  get: (key) => new Promise((resolve) => chrome.storage.local.get(key, (items) => resolve(items[key]))),
  set: (items) => new Promise((resolve) => chrome.storage.local.set(items, () => resolve())),
  fetcher: fetch.bind(globalThis),
  loadAsset: async (path) => {
    const response = await fetch(chrome.runtime.getURL(path), { method: 'GET', cache: 'no-store' });
    if (!response.ok) throw new Error(`Missing extension asset: ${path}`);
    return new Uint8Array(await response.arrayBuffer());
  },
  openTab: (url) => new Promise((resolve) => chrome.tabs.create({ url }, (tab) => resolve(tab.id)))
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handler(message).then(sendResponse);
  return true;
});
