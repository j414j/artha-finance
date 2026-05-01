import { request } from './client'
import type { Account, AccountPatch, AccountPayload, AccountsResponse, AccountSummary } from '../types/account'

interface AccountResponse {
  account: Account
}

interface SummaryResponse {
  summary: AccountSummary
}

export const getAccounts = () => request<AccountsResponse>('/accounts')

export const getAccountsSummary = () => request<SummaryResponse>('/accounts/summary')

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
