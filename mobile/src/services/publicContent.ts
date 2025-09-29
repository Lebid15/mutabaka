import { request } from '../lib/httpClient';

export interface BrandingResponse {
  logo_url: string | null;
}

export interface PolicyDocument {
  id: number;
  title: string;
  content: string;
  document_type: string;
  updated_at: string;
  created_at: string;
}

export type PolicyDocumentType = 'privacy' | 'terms';

export async function getBranding(): Promise<BrandingResponse> {
  return request<BrandingResponse>({
    path: 'branding',
    method: 'GET',
    auth: false,
  });
}

export async function getPolicyDocument(documentType: PolicyDocumentType): Promise<PolicyDocument> {
  const path = documentType === 'terms' ? 'terms-of-use' : 'privacy-policy';
  return request<PolicyDocument>({
    path,
    method: 'GET',
    auth: false,
  });
}
