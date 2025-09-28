import { request, HttpError } from '../lib/httpClient';

export type SubscriptionPeriod = 'monthly' | 'yearly';
export type PlanCode = 'silver' | 'golden' | 'king' | string;

export interface SubscriptionPlan {
  id?: number;
  code: PlanCode;
  name?: string | null;
  description?: string | null;
  monthly_price?: number | null;
  yearly_price?: number | null;
  yearly_discount_percent?: number | null;
}

export interface SubscriptionSummary {
  id?: number;
  status?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  plan?: {
    code?: PlanCode;
    name?: string | null;
  } | null;
}

export interface PendingSubscriptionRequest {
  id?: number;
  status?: string | null;
  created_at?: string | null;
  plan?: {
    code?: PlanCode;
    name?: string | null;
  } | null;
  period?: SubscriptionPeriod;
}

export interface SubscriptionOverviewResponse {
  subscription: SubscriptionSummary | null;
  pending_request: PendingSubscriptionRequest | null;
}

export async function fetchSubscriptionOverview(): Promise<SubscriptionOverviewResponse> {
  return request<SubscriptionOverviewResponse>({
    path: 'subscriptions/me',
    method: 'GET',
  }).catch((error) => {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(500, 'فشل تحميل بيانات الاشتراك', error);
  });
}

export async function fetchSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  return request<unknown>({
    path: 'subscriptions/plans',
    method: 'GET',
  }).then((data) => {
    if (Array.isArray(data)) {
      return data as SubscriptionPlan[];
    }
    return [];
  }).catch((error) => {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(500, 'فشل تحميل خطط الاشتراك', error);
  });
}

export async function renewSubscription(planCode: PlanCode, period: SubscriptionPeriod): Promise<unknown> {
  return request<unknown, { plan_code: PlanCode; period: SubscriptionPeriod }>({
    path: 'subscriptions/renew',
    method: 'POST',
    body: {
      plan_code: planCode,
      period,
    },
  });
}
