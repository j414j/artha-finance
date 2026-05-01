import { request } from './client';
import type { Holding, HoldingsSummary } from '../types/investment';

export const getHoldings = (accountId?: string) =>
  request<{ holdings: Holding[] }>(
    `/investments/holdings${accountId ? `?account_id=${accountId}` : ''}`
  );

export const getHoldingsSummary = (accountId?: string) =>
  request<{ summary: HoldingsSummary }>(
    `/investments/holdings/summary${accountId ? `?account_id=${accountId}` : ''}`
  );
