import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { DocumentApplicationPayload } from '../core/types';
import { cleanText, slug } from '../core/text';

export interface GeneratedPdfFile {
  name: string;
  bytes: Uint8Array;
}

export interface GeneratePdfOptions {
  mediaTemplate: Uint8Array | ArrayBuffer | Buffer;
  nonPartyTemplate: Uint8Array | ArrayBuffer | Buffer;
  includeMediaAccess?: boolean;
  includeNonPartyAccess?: boolean;
}

function asUint8Array(input: Uint8Array | ArrayBuffer | Buffer): Uint8Array {
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(input);
}

function today(): string {
  return new Intl.DateTimeFormat('en-AU', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date());
}

function baseValues(payload: DocumentApplicationPayload): Record<string, string | boolean> {
  const matter = payload.matter;
  const applicant = payload.applicant;
  return {
    Name: applicant.name,
    Organisation: applicant.organisation,
    Email: applicant.email,
    'Contact number': applicant.phone || '',
    'Case number yearnumber': matter.caseNumber,
    'Plaintiff  Appellant name': matter.plaintiff || matter.matterTitle.split(/\s+v\s+/i)[0] || '',
    'Defendant  Respondent name': matter.defendant || matter.matterTitle.split(/\s+v\s+/i)[1] || '',
    'Applicant Signature': applicant.name,
    Dated: today(),
    Text22: applicant.name,
    Text23: 'Journalist',
    Text24: applicant.organisation,
    Text25: applicant.email,
    Text26: applicant.phone || '',
    Text27: matter.caseNumber,
    Text28: matter.matterTitle,
    Text29: [matter.court, matter.venue].map(cleanText).filter(Boolean).join(' - '),
    Text35: payload.requestedDocuments.join(', '),
    Text48: applicant.name,
    Text49: today(),
    Text50: applicant.name,
    Text51: applicant.name,
    Text52: today(),
    'Check Box50': payload.requestedDocuments.includes('originating_process'),
    'Check Box51': payload.requestedDocuments.includes('transcript'),
    'Check Box52': payload.requestedDocuments.includes('exhibits'),
    Button1: true,
    Button4: true,
    Button37: true,
    Button39: true,
    Button40: true,
    Button41: true,
    Button42: true,
    Button43: true,
    Button44: true,
    Button45: true,
    Button46: true,
    Button47: true
  };
}

async function fillTemplate(template: Uint8Array, values: Record<string, string | boolean>): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(template, { ignoreEncryption: true, updateMetadata: false });
  const fixedDate = new Date('2000-01-01T00:00:00.000Z');
  pdfDoc.setCreationDate(fixedDate);
  pdfDoc.setModificationDate(fixedDate);
  pdfDoc.setProducer('Argus Delta Courtlens');
  pdfDoc.setCreator('Argus Delta Courtlens');
  const form = pdfDoc.getForm();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (const field of form.getFields()) {
    const name = field.getName();
    const value = values[name];
    try {
      const typeName = field.constructor.name;
      if (typeName.includes('TextField')) {
        const textField = form.getTextField(name);
        textField.setText(cleanText(value));
        textField.updateAppearances(font);
      } else if (typeName.includes('CheckBox')) {
        const check = form.getCheckBox(name);
        Boolean(value) ? check.check() : check.uncheck();
      } else if (typeName.includes('RadioGroup')) {
        // Existing templates use radio-like button groups for acknowledgements. Leave
        // unknown option names unchanged instead of risking corrupt selections.
      }
    } catch {
      // Template field names vary by PDF version. Missing/unsupported fields are
      // intentionally ignored; validation happens before generation.
    }
  }

  try {
    form.flatten({ updateFieldAppearances: true });
  } catch {
    // Some NSW legacy templates contain orphan widget references. Prefer a
    // successfully filled PDF over a hard failure; deterministic matrix tests can
    // later target the exact overlay cleanup rules from NSW Courts+.
  }
  return pdfDoc.save({ useObjectStreams: false });
}

export async function generateApplicationPdfs(payload: DocumentApplicationPayload, options: GeneratePdfOptions): Promise<GeneratedPdfFile[]> {
  if (payload.validationErrors.length) {
    throw new Error(`Cannot generate PDFs: ${payload.validationErrors.join(' ')}`);
  }
  const values = baseValues(payload);
  const baseName = `${slug(payload.matter.caseNumber)}-${slug(payload.matter.matterTitle).slice(0, 48)}`;
  const files: GeneratedPdfFile[] = [];
  if (options.includeMediaAccess !== false) {
    files.push({ name: `${baseName}_media_access_2026.pdf`, bytes: await fillTemplate(asUint8Array(options.mediaTemplate), values) });
  }
  if (options.includeNonPartyAccess !== false) {
    files.push({ name: `${baseName}_non_party_access.pdf`, bytes: await fillTemplate(asUint8Array(options.nonPartyTemplate), values) });
  }
  return files;
}
