# Privacy and Security

- Courtlens runs as a local Chrome extension.
- Private tokens must be stored in `chrome.storage.local` or handled by a backend proxy.
- Tokens and ABR GUIDs must never be committed, printed, or hardcoded.
- Provider searches are user-triggered from the sidebar.
- PDF templates are bundled locally; document payloads are generated from page metadata and applicant settings.
