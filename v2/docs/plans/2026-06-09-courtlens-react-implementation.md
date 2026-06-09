# Courtlens React Extension Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a production-quality Vite/React Manifest V3 extension for Argus Delta Courtlens.

**Architecture:** Vite builds separate MV3 background and content-script entries. React mounts the sidebar inside a Shadow DOM from each content script. Parsers, providers, storage, and document payload generation are typed modules with test-first coverage.

**Tech Stack:** Vite, React 18, TypeScript, Vitest, Testing Library, jsdom, Manifest V3.

---

### Task 1: Project scaffold and test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `extension/manifest.json`
- Create tests first under `tests/unit/`

**Steps:**
1. Write failing tests for parser/provider/document APIs.
2. Run `npm test` and confirm failures are missing modules, not syntax errors.
3. Add TypeScript/Vite/Vitest config and minimal source exports.
4. Run `npm test` and `npm run build`.

### Task 2: Core typed domain and parsers

**Files:**
- Create: `extension/src/core/types.ts`
- Create: `extension/src/core/text.ts`
- Create: `extension/src/parsers/partyParser.ts`
- Create: `extension/src/parsers/nswCourtlistParser.ts`
- Create: `extension/src/parsers/nswCaselawParser.ts`
- Create: `extension/src/parsers/judgmentEntityParser.ts`

**Steps:**
1. Write tests for court-list row parsing, party splitting, caselaw metadata extraction, and body entity grouping.
2. Run tests to verify red.
3. Implement minimal deterministic parsers.
4. Run tests to verify green.

### Task 3: Providers and router

**Files:**
- Create: `extension/src/providers/*.ts`
- Create: `extension/src/core/searchRouter.ts`

**Steps:**
1. Write tests for Argus nullable normalization, quote stripping, minimum length validation, exact post-filtering, RSS parsing, and HTML result parsing.
2. Run tests to verify red.
3. Implement provider modules and router.
4. Run tests to verify green.

### Task 4: Background service worker and settings storage

**Files:**
- Create: `extension/src/background/index.ts`
- Create: `extension/src/core/storage.ts`

**Steps:**
1. Write message-handler tests with injected fetch/storage seams.
2. Run tests to verify red.
3. Implement MV3 message handlers for provider searches, settings, and document payloads.
4. Run tests and build.

### Task 5: React sidebar UI

**Files:**
- Create: `extension/src/sidebar/*`
- Create: `extension/src/styles/sidebar.css`

**Steps:**
1. Write React tests for rendering tabs, matter overview, candidate research actions, document payload preview, and settings save state.
2. Run tests to verify red.
3. Implement sidebar shell, tabs, cards, badges, provider panels, documents and settings UI.
4. Run tests to verify green.

### Task 6: Content scripts and Shadow DOM mount

**Files:**
- Create: `extension/src/content/courtlist.tsx`
- Create: `extension/src/content/caselaw.tsx`
- Create: `fixtures/*.html`

**Steps:**
1. Write fixture tests for row detection and page context extraction.
2. Run tests to verify red.
3. Implement content script mount and action buttons.
4. Run tests and build.

### Task 7: Documents workflow and assets

**Files:**
- Create: `extension/src/documents/*`
- Copy: `extension/public/forms/*.pdf`, `extension/public/vendor/*.js`

**Steps:**
1. Write tests for recipient routing, request payload building, and missing-case validation.
2. Run tests to verify red.
3. Implement document payload generation and background generation seam.
4. Run tests and build.

### Task 8: Docs, smoke tests, and final audit

**Files:**
- Create: `README.md`, `CHANGELOG.md`, `docs/*.md`, `scripts/smoke.mjs`

**Steps:**
1. Write smoke script checks.
2. Run smoke and verify failure before final build artifacts exist.
3. Implement docs and smoke coverage.
4. Run `npm test`, `npm run build`, `npm run smoke`.
5. Complete prompt-to-artifact audit before marking the goal complete.
