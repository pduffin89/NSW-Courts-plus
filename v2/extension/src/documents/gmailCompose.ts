import { cleanText } from '../core/text';

export interface GmailComposeInput {
  to: string;
  subject: string;
  body: string;
}

export function composeGmailUrl(input: GmailComposeInput): string {
  const params = new URLSearchParams({
    view: 'cm',
    fs: '1',
    to: cleanText(input.to),
    su: cleanText(input.subject),
    body: cleanText(input.body)
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}
