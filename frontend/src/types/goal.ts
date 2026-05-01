export interface Goal {
  id: string
  name: string
  color_hex: string
  target_amount_paise: number
  source_account_id: string
  source_account_name: string
  target_date: string | null
  current_blocked_paise: number
  completed_amount_paise: number | null
  display_amount_paise: number
  remaining_paise: number
  progress_pct: number
  projected_completion_date: string | null
  required_monthly_paise: number | null
  status: 'active' | 'completed' | 'cancelled'
  status_label: string
  status_tone: 'green' | 'amber' | 'red' | 'neutral'
  notes: string | null
  created_at: string
  completed_at: string | null
}

export interface GoalEvent {
  id: string
  event_type: 'block' | 'release' | 'complete_release' | 'cancel_release'
  amount_paise: number
  date: string
  notes: string | null
  created_at: string
}

export interface GoalAccountAvailability {
  account_id: string
  account_name: string
  total_balance_paise: number
  blocked_paise: number
  available_balance_paise: number
}

export interface GoalCreatePayload {
  name: string
  target_amount_paise: number
  source_account_id: string
  target_date?: string | null
  notes?: string | null
}

export interface GoalUpdatePayload {
  name?: string
  target_amount_paise?: number
  source_account_id?: string
  target_date?: string | null
  notes?: string | null
}

export interface GoalFundsPayload {
  amount_paise: number
  date: string
  notes?: string | null
}

export interface GoalCompletePayload {
  date?: string
  notes?: string | null
}
