export interface BuyLot {
  transaction_id: string;
  date: string;
  description: string;
  quantity: number;
  price_per_unit_paise: number;
  fees_paise: number;
  invested_paise: number;
  current_value_paise: number | null;
  pnl_paise: number | null;
  pnl_pct: number | null;
  days_held: number;
  annualised_return_pct: number | null;
}

export interface ValueHistoryPoint {
  date: string;
  value_paise: number;
}

export interface PriceHistoryPoint {
  date: string;
  price_paise: number;
}

export interface HoldingDrilldown {
  xirr_pct: number | null;
  value_history: ValueHistoryPoint[];
  price_history: PriceHistoryPoint[];
  buy_lots: BuyLot[];
}

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

export interface PortfolioHistoryPoint {
  date: string;
  value_paise: number;
  invested_paise: number;
  unrealised_pnl_paise: number;
  cumulative_realised_pnl_paise: number;
}

export interface HoldingXirr {
  instrument_id: string;
  account_id: string;
  xirr_pct: number | null;
}

export interface XirrSummary {
  portfolio_xirr_pct: number | null;
  holdings: HoldingXirr[];
}

export interface DividendMonthData {
  month: string;
  amount_paise: number;
}
