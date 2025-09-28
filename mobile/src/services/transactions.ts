import { request } from '../lib/httpClient';

export type TransactionDirection = 'lna' | 'lkm';

export interface TransactionDto {
  id: number;
  conversation: number;
  direction: TransactionDirection;
  amount: string;
  note?: string | null;
  created_at: string;
  currency?: {
    id: number;
    code: string;
    name: string;
    symbol?: string | null;
  } | null;
}

interface CreateTransactionPayload {
  conversation: number;
  currency_id: number;
  amount: string;
  direction: TransactionDirection;
  note?: string;
}

export async function createTransaction(payload: CreateTransactionPayload): Promise<TransactionDto> {
  return request<TransactionDto, CreateTransactionPayload>({
    path: 'transactions/',
    method: 'POST',
    body: payload,
  });
}
