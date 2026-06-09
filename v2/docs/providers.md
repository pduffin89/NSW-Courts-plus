# Providers

Courtlens providers normalize results to `ProviderResultPage`.

## Argus Delta

- Endpoint: `GET https://be-api.argusdelta.com/public/court-lists/search`
- Query params: `query`, `limit`, `offset`
- Auth: `Authorization: Bearer <token>`
- Exact mode: display quotes are preserved in UI, but quote marks are stripped before the API call.
- Nullable fields are safe: title/case numbers are preferred and metadata is optional.

## Google News

- Uses Google News RSS search.
- Parses RSS into result cards with title, link, pubDate, and description snippets.

## ABN

- Uses `https://abr.business.gov.au/json/MatchingNames.aspx` with configured `abnGuid`.
- Parses ABR JSONP rows into normalized result cards.
- Refuses live lookup without a GUID so secrets are not hardcoded.

## Federal Court

- Uses `https://search.judgments.fedcourt.gov.au/s/search.html` with `query_sand` and `start_rank`.
- HTML anchors are normalized into result cards.

## NSW Caselaw

- Local page metadata is primary on decision pages.
- Search provider uses `https://www.caselaw.nsw.gov.au/search` and normalizes result anchors.

## Provider interface

```ts
routeSearch({ providerId, query, exact, limit, offset, page, token, proxyUrl, fetcher })
```

The injected `fetcher` keeps provider code testable and lets the MV3 background service own network permissions.
