export interface Holding {
  instrument_id: string;
  instrument_name: string;
  instrument_ticker: string | null;
  instrument_type: string;
  instrument_currency: string;
  instrument_sector: string | null;
  instrument_geography: string | null;
  account_id: string;
  account_name: string;
  quantity_held: number;
  avg_cost_per_unit_paise: number;
  invested_value_paise: number;
  invested_value_inr_paise: number | null;
  latest_price_paise: number | null;
  latest_price_date: string | null;
  current_value_paise: number | null;
  current_value_inr_paise: number | null;
  unrealised_pnl_paise: number | null;
  unrealised_pnl_inr_paise: number | null;
  unrealised_pnl_pct: number | null;
  realised_pnl_paise: number;
  realised_pnl_inr_paise: number | null;
}

export interface HoldingsSummary {
  total_invested_paise: number;
  total_current_value_paise: number | null;
  total_unrealised_pnl_paise: number | null;
  total_unrealised_pnl_pct: number | null;
  total_realised_pnl_paise: number;
  holdings_count: number;
}
