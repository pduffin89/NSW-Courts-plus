# Argus Delta API

## Base URL

```text
https://be-api.argusdelta.com
```

## Court-list search

```http
GET /public/court-lists/search?query=<query>&limit=<n>&offset=<n>
Authorization: Bearer <token>
Accept: application/json
```

## Implementation rules

- Do not hardcode or print tokens.
- Store private local tokens in `chrome.storage.local` under Courtlens settings.
- Prefer proxy mode for distribution.
- Validate query length before calling the API.
- Strip wrapping quotes from exact searches before sending the API request.
- Preserve the quoted display query in the UI when exact mode is active.
- Treat `rowId`, `feedId`, `court`, `location`, `date`, `time`, and `listingType` as nullable.
- Use composite UI IDs from title, case numbers, timestamps, and IDs when available.

## Tested behavior encoded in unit tests

- `prepareArgusDeltaQuery()` strips quotes for API calls.
- `normalizeArgusDeltaResponse()` renders title/case numbers when metadata fields are null.
- `routeSearch()` sends bearer auth without quote marks in the URL.
