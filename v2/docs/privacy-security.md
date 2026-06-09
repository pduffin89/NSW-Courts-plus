# Privacy and Security

- Courtlens runs as a local Chrome extension.
- Private tokens must be stored in `chrome.storage.local` or handled by a backend proxy.
- Tokens and ABR GUIDs must never be committed, printed, or hardcoded.
- The Settings tab masks stored Argus Delta tokens and ABN GUIDs after loading; saving profile edits does not overwrite masked secrets.
- Provider searches are user-triggered from the sidebar.
- PDF templates are bundled locally; document payloads are generated from page metadata and applicant settings.
