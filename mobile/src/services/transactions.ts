import { request } from '../lib/httpClient';
import type { PublicUser } from './user';

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
  amount_value?: string;
  direction_label?: string;
  from_user?: number | null;
  to_user?: number | null;
  from_user_info?: PublicUser | null;
  to_user_info?: PublicUser | null;
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

export interface PaginatedTransactions {
  count: number;
  next: string | null;
  previous: string | null;
  results: TransactionDto[];
}

export interface FetchTransactionsOptions {
  conversation: number;
  fromDate?: string;
  toDate?: string;
  ordering?: 'created_at' | '-created_at';
  page?: number;
  pageSize?: number;
}

export async function fetchTransactions(options: FetchTransactionsOptions): Promise<PaginatedTransactions> {
  const { conversation, fromDate, toDate, ordering = 'created_at', page, pageSize } = options;
  return request<PaginatedTransactions>({
    path: 'transactions/',
    method: 'GET',
    query: {
      conversation,
      from_date: fromDate,
      to_date: toDate,
      ordering,
      page,
      page_size: pageSize,
    },
  });
}
