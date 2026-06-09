import type { ApplicantProfile, DocumentApplicationPayload, MatterContext } from '../core/types';
import { cleanText, slug } from '../core/text';

const COURT_RECIPIENTS: Array<[RegExp, string]> = [
  [/supreme/i, 'sc.enquiries@justice.nsw.gov.au'],
  [/district/i, 'dc.enquiries@justice.nsw.gov.au'],
  [/local/i, 'local-court-enquiries@justice.nsw.gov.au'],
  [/children/i, 'childrens_court@justice.nsw.gov.au'],
  [/coroner/i, 'lidcombe.coroners@justice.nsw.gov.au']
];

export function resolveCourtRecipient(courtText: string): string {
  const court = cleanText(courtText);
  return COURT_RECIPIENTS.find(([pattern]) => pattern.test(court))?.[1] || 'courts-enquiries@justice.nsw.gov.au';
}

export function buildDocumentApplicationPayload(input: {
  matter: MatterContext;
  requestedDocuments: string[];
  applicant: ApplicantProfile;
}): DocumentApplicationPayload {
  const matter = input.matter;
  const requestedDocuments = input.requestedDocuments.map(cleanText).filter(Boolean);
  const validationErrors: string[] = [];
  if (!cleanText(matter.caseNumber)) validationErrors.push('Matter case number is required.');
  if (!cleanText(matter.court)) validationErrors.push('Court is required.');
  if (!requestedDocuments.length) validationErrors.push('Select at least one requested document.');
  if (!cleanText(input.applicant.email)) validationErrors.push('Applicant email is required.');

  const to = resolveCourtRecipient(matter.court);
  const subject = cleanText(`${matter.caseNumber} ${matter.matterTitle}`);
  return {
    matter,
    applicant: input.applicant,
    requestedDocuments,
    email: {
      to,
      subject,
      body: `Please find attached an application for access to documents in ${subject}.\n\nRegards,\n${cleanText(input.applicant.name)}`
    },
    fileBaseName: `${slug(matter.caseNumber)}-${slug(matter.matterTitle).slice(0, 72)}`,
    validationErrors
  };
}
