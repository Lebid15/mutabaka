import { request } from '../lib/httpClient';

export interface CurrencyDto {
  id: number;
  code: string;
  name: string;
  symbol?: string | null;
}

interface PaginatedCurrencyResponse {
  results?: CurrencyDto[];
}

export async function fetchCurrencies(): Promise<CurrencyDto[]> {
  const data = await request<PaginatedCurrencyResponse | CurrencyDto[]>({
    path: 'currencies/',
    method: 'GET',
  });
  if (Array.isArray(data)) {
    return data;
  }
  if (data && Array.isArray(data.results)) {
    return data.results;
  }
  return [];
}

export async function bootstrapCurrencies(): Promise<void> {
  await request({
    path: 'currencies/bootstrap/',
    method: 'POST',
  });
}
