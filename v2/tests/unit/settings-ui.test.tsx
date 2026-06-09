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

describe('Settings UI', () => {
  it('loads stored settings, masks secrets, and saves applicant profile fields', async () => {
    const onLoadSettings = vi.fn(async () => ({
      argusDeltaToken: 'stored-token',
      abnGuid: 'stored-guid',
      argusDeltaProxyUrl: 'https://proxy.example.test',
      applicantName: 'Reporter One',
      applicantOrganisation: 'Argus Delta',
      applicantEmail: 'r@example.test'
    }));
    const onSaveSettings = vi.fn(async (_settings: any) => undefined);

    render(<CourtlensSidebar initialContext={{ matter }} onLoadSettings={onLoadSettings} onSaveSettings={onSaveSettings} />);
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }));

    await waitFor(() => expect(onLoadSettings).toHaveBeenCalledOnce());
    expect(screen.getByLabelText(/argus delta token/i)).toHaveValue('••••••••');
    expect(screen.getByLabelText(/abn guid/i)).toHaveValue('••••••••');
    expect(screen.getByLabelText(/applicant name/i)).toHaveValue('Reporter One');
    expect(screen.getByLabelText(/applicant organisation/i)).toHaveValue('Argus Delta');

    fireEvent.change(screen.getByLabelText(/applicant name/i), { target: { value: 'Reporter Two' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => expect(onSaveSettings).toHaveBeenCalledWith(expect.objectContaining({ applicantName: 'Reporter Two', applicantOrganisation: 'Argus Delta' })));
    const savedSettings = (onSaveSettings.mock.calls[0] as any[])[0];
    expect(savedSettings).not.toHaveProperty('argusDeltaToken', '••••••••');
  });
});
