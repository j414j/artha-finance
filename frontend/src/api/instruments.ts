import { request } from './client';
import type {
  CorporateAction,
  CreateCorporateActionPayload,
  CreateInstrumentPayload,
  CreatePriceSnapshotPayload,
  Instrument,
  InstrumentWithPrice,
  PriceSnapshot,
} from '../types/instrument';

export const getInstruments = () =>
  request<{ instruments: Instrument[] }>('/instruments');

export const getInstrument = (id: string) =>
  request<{ instrument: InstrumentWithPrice }>(`/instruments/${id}`);

export const createInstrument = (payload: CreateInstrumentPayload) =>
  request<{ instrument: Instrument }>('/instruments', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updateInstrument = (id: string, payload: Partial<CreateInstrumentPayload>) =>
  request<{ instrument: Instrument }>(`/instruments/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

export const archiveInstrument = (id: string) =>
  request<void>(`/instruments/${id}`, { method: 'DELETE' });

export const getPriceSnapshots = (instrumentId: string) =>
  request<{ prices: PriceSnapshot[] }>(`/instruments/${instrumentId}/prices`);

export const createPriceSnapshot = (instrumentId: string, payload: CreatePriceSnapshotPayload) =>
  request<{ price: PriceSnapshot }>(`/instruments/${instrumentId}/prices`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const deletePriceSnapshot = (instrumentId: string, priceId: string) =>
  request<void>(`/instruments/${instrumentId}/prices/${priceId}`, { method: 'DELETE' });

export const getCorporateActions = (instrumentId?: string) =>
  request<{ corporate_actions: CorporateAction[] }>(
    `/investments/corporate-actions${instrumentId ? `?instrument_id=${instrumentId}` : ''}`
  );

export const createCorporateAction = (payload: CreateCorporateActionPayload) =>
  request<{ corporate_action: CorporateAction }>('/investments/corporate-actions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const deleteCorporateAction = (id: string) =>
  request<void>(`/investments/corporate-actions/${id}`, { method: 'DELETE' });
