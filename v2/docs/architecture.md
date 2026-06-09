# Architecture

Courtlens is a Vite-built Manifest V3 extension with separate entry points for the service worker and each target site content script.

## Runtime components

| Component | Role |
|---|---|
| `background/index.ts` | Registers the MV3 message listener. |
| `background/messageHandler.ts` | Testable message handler with injected storage/fetch dependencies. |
| `content/courtlist.tsx` | Scans NSW court-list rows, injects Courtlens row buttons, opens sidebar with row context. |
| `content/caselaw.tsx` | Adds a floating launcher and extracts NSW Caselaw page context. |
| `content/mount.tsx` | Creates a Shadow DOM host, injects CSS, and renders the React sidebar. |
| `sidebar/CourtlensSidebar.tsx` | Workflow UI for overview, research, documents, and settings. |
| `core/searchRouter.ts` | Normalizes provider routing behind one interface. |

## Data contracts

Shared contracts live in `extension/src/core/types.ts`:

- `MatterContext`
- `EntityCandidate`
- `ProviderResultItem`
- `ProviderResultPage`
- `DocumentApplicationPayload`

## Security boundaries

- Content scripts never hardcode provider secrets.
- Background service worker reads secrets from `chrome.storage.local`.
- Argus Delta calls use an `Authorization: Bearer <token>` header only when a token exists.
- A proxy URL can be configured for distributable use.

## Build output

`npm run build` emits `dist/` with:

- `manifest.json`
- `background.js`
- `courtlist.js`
- `caselaw.js`
- copied `forms/` PDF templates
- copied `vendor/` runtime libraries
