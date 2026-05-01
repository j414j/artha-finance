export type TransactionType =
  | "income"
  | "expense"
  | "transfer"
  | "investment_buy"
  | "investment_sell"
  | "dividend"
  | "loan_repayment"
  | "credit_card_payment"
  | "valuation_update";

export type RecurrenceFrequency =
  | "daily"
  | "weekly"
  | "fortnightly"
  | "monthly"
  | "quarterly"
  | "annually";

export interface TransactionSplit {
  id: string;
  category_id: string;
  category_name: string | null;
  amount_paise: number;
  notes: string | null;
}

export interface Transaction {
  id: string;
  account_id: string;
  account_name: string;
  transfer_account_id: string | null;
  transfer_account_name: string | null;
  type: TransactionType;
  date: string;
  description: string;
  amount_paise: number;
  category_id: string | null;
  category_name: string | null;
  notes: string | null;
  tags: string[];
  splits: TransactionSplit[];
  is_recurring: boolean;
  recurrence_frequency: RecurrenceFrequency | null;
  created_at: string;
  updated_at: string;
}

export interface TransactionSummary {
  count: number;
  total_income_paise: number;
  total_expense_paise: number;
  net_paise: number;
}

export interface TransactionSplitPayload {
  category_id: string;
  amount_paise: number;
  notes?: string | null;
}

export interface TransactionPayload {
  account_id: string;
  transfer_account_id?: string | null;
  type: TransactionType;
  date: string;
  description: string;
  amount_paise: number;
  category_id?: string | null;
  notes?: string | null;
  tags?: string[];
  splits?: TransactionSplitPayload[];
  is_recurring?: boolean;
  recurrence_frequency?: RecurrenceFrequency | null;
}

export type TransactionPatch = Partial<TransactionPayload>;

export interface TransactionFilters {
  cursor?: string;
  limit?: number;
  date_from?: string;
  date_to?: string;
  account_id?: string;
  category_id?: string;
  type?: TransactionType;
  tag?: string;
  search?: string;
  amount_min?: number;
  amount_max?: number;
  sort?: "date_desc";
}

export interface TransactionsResponse {
  transactions: Transaction[];
  next_cursor: string | null;
}

export interface TransactionSummaryResponse {
  summary: TransactionSummary;
}

export interface BulkTransactionRequest {
  ids: string[];
  action: "soft_delete" | "add_tag" | "remove_tag" | "categorize";
  category_id?: string;
  tag?: string;
}
