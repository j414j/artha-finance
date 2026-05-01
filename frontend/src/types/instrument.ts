export type InstrumentType = 'equity' | 'mf' | 'etf' | 'bond' | 'gold' | 'crypto' | 'other';

export interface Instrument {
  id: string;
  name: string;
  ticker: string | null;
  type: InstrumentType;
  currency: string;
  sector: string | null;
  geography: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LatestPrice {
  price_paise: number;
  date: string;
}

export interface InstrumentWithPrice extends Instrument {
  latest_price: LatestPrice | null;
}

export interface PriceSnapshot {
  id: string;
  instrument_id: string;
  price_paise: number;
  date: string;
  notes: string | null;
  created_at: string;
}

export interface CorporateAction {
  id: string;
  instrument_id: string;
  account_id: string;
  type: 'split' | 'bonus' | 'dividend_reinvested';
  date: string;
  quantity_delta: number;
  split_ratio: string | null;
  price_per_unit_paise: number | null;
  notes: string | null;
  created_at: string;
}

export interface CreateInstrumentPayload {
  name: string;
  type: InstrumentType;
  ticker?: string | null;
  currency?: string;
  sector?: string | null;
  geography?: string | null;
  notes?: string | null;
}

export interface CreatePriceSnapshotPayload {
  price_paise: number;
  date: string;
  notes?: string | null;
}

export interface CreateCorporateActionPayload {
  instrument_id: string;
  account_id: string;
  type: 'split' | 'bonus' | 'dividend_reinvested';
  date: string;
  quantity_delta: number;
  split_ratio?: string | null;
  price_per_unit_paise?: number | null;
  notes?: string | null;
}
