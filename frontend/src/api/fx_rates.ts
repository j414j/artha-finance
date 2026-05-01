import { request } from './client';
import type { CreateFxRatePayload, FxRate, LatestFxRate } from '../types/fx_rate';

export const getFxRates = (from?: string, to?: string) => {
  const params = new URLSearchParams();
  if (from) params.set('from_currency', from);
  if (to) params.set('to_currency', to);
  const qs = params.toString();
  return request<{ fx_rates: FxRate[] }>(`/fx-rates${qs ? `?${qs}` : ''}`);
};

export const getLatestFxRates = () =>
  request<{ latest: LatestFxRate[] }>('/fx-rates/latest');

export const createFxRate = (payload: CreateFxRatePayload) =>
  request<{ fx_rate: FxRate }>('/fx-rates', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const deleteFxRate = (id: string) =>
  request<void>(`/fx-rates/${id}`, { method: 'DELETE' });
