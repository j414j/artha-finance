export interface FxRate {
  id: string;
  from_currency: string;
  to_currency: string;
  rate: number;
  date: string;
  notes: string | null;
  created_at: string;
}

export interface LatestFxRate {
  from_currency: string;
  to_currency: string;
  rate: number;
  date: string;
}

export interface CreateFxRatePayload {
  from_currency: string;
  to_currency: string;
  rate: number;
  date: string;
  notes?: string | null;
}
