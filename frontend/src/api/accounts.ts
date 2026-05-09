import { request } from './client'
import type { Account, AccountPatch, AccountPayload, AccountsResponse, AccountSummary, BalanceHistoryPoint } from '../types/account'

interface AccountResponse {
  account: Account
}

interface SummaryResponse {
  summary: AccountSummary
}

interface BalanceHistoryResponse {
  balance_history: BalanceHistoryPoint[]
}

export const getAccounts = () => request<AccountsResponse>('/accounts')

export const getAccountsSummary = () => request<SummaryResponse>('/accounts/summary')

export const getAccount = (id: string) =>
  request<AccountResponse>(`/accounts/${id}`)

export const getAccountBalanceHistory = (id: string, days = 30) =>
  request<BalanceHistoryResponse>(`/accounts/${id}/balance-history?days=${days}`)

export const createAccount = (payload: AccountPayload) =>
  request<AccountResponse>('/accounts', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const updateAccount = (id: string, payload: AccountPatch) =>
  request<AccountResponse>(`/accounts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })

export const archiveAccount = (id: string) =>
  request<void>(`/accounts/${id}`, { method: 'DELETE' })
