export type SiteSource = 'courtlist' | 'caselaw' | 'manual';

export type EntityType =
  | 'person'
  | 'company'
  | 'government'
  | 'council'
  | 'legal_representative'
  | 'law_firm'
  | 'judge'
  | 'party'
  | 'unknown';

export interface MatterContext {
  caseNumber: string;
  matterTitle: string;
  court: string;
  venue: string;
  source: SiteSource;
  url: string;
  jurisdiction?: string;
  listingType?: string;
  listingDate?: string;
  plaintiff?: string;
  defendant?: string;
  decisionDate?: string;
  judges?: string[];
  citations?: string[];
}

export interface EntityCandidate {
  id: string;
  name: string;
  originalText: string;
  type: EntityType;
  group: string;
  confidence: number;
  source: 'courtlist' | 'caselaw-title' | 'judgment-body' | 'metadata' | 'local-ner';
  context?: Partial<MatterContext>;
}

export interface ProviderResultItem {
  id: string;
  title: string;
  subtitle: string;
  url?: string;
  source: string;
  date?: string;
  snippets: string[];
  badges: string[];
  raw?: unknown;
}

export interface ProviderResultPage {
  providerId: string;
  query: string;
  items: ProviderResultItem[];
  hasMore: boolean;
  nextOffset?: number;
  error?: string;
  raw?: unknown;
}

export interface ApplicantProfile {
  name: string;
  organisation: string;
  email: string;
  phone?: string;
}

export interface DocumentApplicationPayload {
  matter: MatterContext;
  applicant: ApplicantProfile;
  requestedDocuments: string[];
  email: {
    to: string;
    subject: string;
    body: string;
  };
  fileBaseName: string;
  validationErrors: string[];
}
