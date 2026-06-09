import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CourtlensSidebar } from '../../extension/src/sidebar/CourtlensSidebar';

const matter = {
  caseNumber: '2025/00490454',
  matterTitle: 'Smith v Acme',
  court: 'Supreme Court',
  venue: 'Sydney',
  source: 'courtlist' as const,
  url: 'https://example.test'
};

describe('Courtlens sidebar accessibility', () => {
  it('exposes status updates through a polite live region', () => {
    render(<CourtlensSidebar initialContext={{ matter }} />);
    expect(screen.getByText('Ready')).toHaveAttribute('aria-live', 'polite');
  });

  it('connects every tab to a labelled tabpanel', () => {
    render(<CourtlensSidebar initialContext={{ matter }} />);
    const tabs = screen.getAllByRole('tab');
    for (const tab of tabs) {
      const controls = tab.getAttribute('aria-controls');
      expect(controls).toBeTruthy();
      const panel = document.getElementById(controls!);
      expect(panel).toHaveAttribute('role', 'tabpanel');
      expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    }
  });

  it('settings fields are labelled and inputs meet autocomplete expectations', () => {
    render(<CourtlensSidebar initialContext={{ matter }} />);
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }));
    expect(screen.getByLabelText(/argus delta token/i)).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByLabelText(/applicant email/i)).toHaveAttribute('autocomplete', 'email');
  });
});
