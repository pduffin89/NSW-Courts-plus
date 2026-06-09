import { describe, expect, it, vi } from 'vitest';
import { composeGmailUrl } from '../../extension/src/documents/gmailCompose';
import { createMessageHandler } from '../../extension/src/background/messageHandler';

describe('Gmail compose workflow', () => {
  it('builds a Gmail compose URL with encoded recipient, subject and body', () => {
    const url = composeGmailUrl({
      to: 'sc.enquiries@justice.nsw.gov.au',
      subject: '2025/00490454 Smith v Acme',
      body: 'Please find attached.\nRegards'
    });
    expect(url).toContain('https://mail.google.com/mail/?view=cm&fs=1');
    expect(url).toContain('to=sc.enquiries%40justice.nsw.gov.au');
    expect(url).toContain('su=2025%2F00490454+Smith+v+Acme');
    expect(url).toContain('body=Please+find+attached');
  });

  it('background route opens the Gmail compose URL through injected tab opener', async () => {
    const openTab = vi.fn(async (_url: string) => 42);
    const handler = createMessageHandler({ get: async () => undefined, set: async () => undefined, openTab });

    const result = await handler({
      type: 'COURTLENS_OPEN_GMAIL_DRAFT',
      email: {
        to: 'sc.enquiries@justice.nsw.gov.au',
        subject: '2025/00490454 Smith v Acme',
        body: 'Please find attached.'
      }
    });

    expect(result).toMatchObject({ ok: true, data: { tabId: 42 } });
    expect(openTab).toHaveBeenCalledWith(expect.stringContaining('mail.google.com/mail'));
  });
});
