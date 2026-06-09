# Courtlens React Extension Design

## Objective

Build **Argus Delta Courtlens** as a new Manifest V3 Chrome extension in `v2`, using a Vite/React/TypeScript build. It must support NSW Online Registry court lists and NSW Caselaw pages, with a right-side sidebar for matter overview, entity research, document application preparation, and settings.

## Product Approach

Courtlens is a sidebar-first legal research assistant. On court-list rows it adds an action button and opens with parsed matter metadata. On NSW Caselaw judgment pages it extracts metadata and body entities. Users can research detected candidates across Argus Delta, News, ABN, Federal Court, and NSW Caselaw, then prepare court application document payloads from the same matter context.

## Architecture

- **Vite multi-entry MV3 build**: separate entries for background service worker, court-list content script, caselaw content script, and React sidebar modules.
- **React sidebar in Shadow DOM**: avoids CSS collisions with court websites and keeps the visual system consistent.
- **Typed core contracts**: `MatterContext`, `EntityCandidate`, `ProviderResultPage`, and document payload types live in `extension/src/core/types.ts`.
- **Provider router**: all providers expose a common async interface and normalize output into shared result cards.
- **Background fetch boundary**: network calls and token access happen in `background.ts`; content/sidebar code requests provider searches with messages.
- **Deterministic first**: regex/DOM extraction ships first; GLiNER-style extraction is represented by a modular entity extractor seam for later model bundling.

## UI Direction

The interface uses a refined court-record aesthetic: ivory surfaces, charcoal text, muted gold accents, compact cards, tabbed workflow, dense but readable metadata, and strong empty/error states. It borrows interaction patterns from shadcn/Radix—tabs, badges, scroll regions, cards, switches—but implements them in React/CSS without requiring shadcn runtime generation.

## Data Flow

1. Content script detects site type and parses matter/page context.
2. Content script mounts the React sidebar and passes initial context.
3. Sidebar normalizes parties/entities into candidates.
4. User triggers provider searches; sidebar calls the background service worker.
5. Background reads settings/tokens, performs provider calls, normalizes raw responses, and returns a `ProviderResultPage`.
6. Documents tab builds a document application payload and sends generation requests when PDF generation assets are available.

## Error Handling

- Never hardcode or log tokens.
- Argus Delta strips quotes before API calls and validates query length.
- Nullable Argus fields are normalized safely.
- Providers return typed empty/error states for UI rendering.
- Content scripts tolerate missing or changing DOM fields.
- Settings make token/proxy state visible without exposing values.

## Testing Strategy

- Vitest unit tests for parsers, entity extraction, provider normalization, router behavior, and document payloads.
- React Testing Library tests for sidebar rendering and interactions.
- Smoke script verifies `npm run build`, manifest content, dist entries, fixture parsing, and static HTML sidebar mounting assumptions.
- `node --check` is replaced by TypeScript/Vite build checks for source and generated JS sanity checks for built assets.

## Delivery Artifacts

- `extension/manifest.json`
- `extension/src/**` Vite/React/TypeScript source
- copied PDF templates and vendor libraries
- `README.md`, `CHANGELOG.md`, and docs under `docs/`
- fixture-based tests and smoke verification
