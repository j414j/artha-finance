export type AccountType =
  | 'savings'
  | 'current'
  | 'credit_card'
  | 'demat'
  | 'mutual_fund'
  | 'real_estate'
  | 'loan'
  | 'other_asset'
  | 'other_liability'

export type AccountSide = 'asset' | 'liability'

export interface Account {
  id: string
  name: string
  type: AccountType
  currency: string
  opening_balance_paise: number
  opening_date: string
  balance_paise: number
  inr_value_paise: number
  cash_balance_paise?: number
  color_hex: string
  is_active: boolean
  last_updated: string
  notes: string | null
  side: AccountSide
  class_key: string
  class_label: string
}

export interface BalanceHistoryPoint {
  date: string
  balance_paise: number
  cash_paise?: number
  holdings_paise?: number
  total_paise?: number
}

export interface AccountSummary {
  total_assets_paise: number
  total_liabilities_paise: number
  net_worth_paise: number
}

export interface AccountGroup {
  key: string
  label: string
  side: AccountSide
  total_inr_value_paise: number
  accounts: Account[]
}

export interface AccountsResponse {
  summary: AccountSummary
  asset_groups: AccountGroup[]
  liability_groups: AccountGroup[]
}

export interface AccountPayload {
  name: string
  type: AccountType
  currency: string
  opening_balance_paise: number
  opening_date: string
  balance_paise?: number
  inr_value_paise?: number
  color_hex: string
  notes?: string | null
}

export type AccountPatch = Partial<AccountPayload>
