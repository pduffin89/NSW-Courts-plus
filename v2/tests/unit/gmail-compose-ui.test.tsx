import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CourtlensSidebar } from '../../extension/src/sidebar/CourtlensSidebar';

const matter = {
  caseNumber: '2025/00490454',
  matterTitle: 'Smith v Acme',
  court: 'Supreme Court',
  venue: 'Sydney',
  source: 'courtlist' as const,
  url: 'https://example.test'
};

describe('Gmail compose UI', () => {
  it('opens a Gmail draft from the Documents tab email payload', async () => {
    const onOpenGmailDraft = vi.fn(async () => ({ tabId: 7 }));
    render(<CourtlensSidebar initialContext={{ matter }} onOpenGmailDraft={onOpenGmailDraft} />);

    fireEvent.click(screen.getByRole('tab', { name: /documents/i }));
    fireEvent.click(screen.getByRole('button', { name: /open gmail draft/i }));

    await waitFor(() => expect(onOpenGmailDraft).toHaveBeenCalledWith(expect.objectContaining({
      to: 'sc.enquiries@justice.nsw.gov.au',
      subject: '2025/00490454 Smith v Acme'
    })));
    expect(await screen.findByText(/gmail draft opened/i)).toBeInTheDocument();
  });
});
