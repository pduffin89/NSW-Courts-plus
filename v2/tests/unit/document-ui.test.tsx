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

describe('Documents tab generation UI', () => {
  it('generates PDFs through the background callback and renders attachment names', async () => {
    const onGenerateDocuments = vi.fn(async () => ({
      attachments: [
        { name: '2025-00490454-smith-v-acme_media_access_2026.pdf', mime: 'application/pdf', base64: 'JVBERi0=' },
        { name: '2025-00490454-smith-v-acme_non_party_access.pdf', mime: 'application/pdf', base64: 'JVBERi0=' }
      ]
    }));

    render(<CourtlensSidebar initialContext={{ matter }} onGenerateDocuments={onGenerateDocuments} />);
    fireEvent.click(screen.getByRole('tab', { name: /documents/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate pdfs/i }));

    await waitFor(() => expect(onGenerateDocuments).toHaveBeenCalledOnce());
    expect(await screen.findByText(/media_access_2026\.pdf/i)).toBeInTheDocument();
    expect(screen.getByText(/non_party_access\.pdf/i)).toBeInTheDocument();
  });
});
