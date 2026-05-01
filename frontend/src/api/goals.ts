import { request } from './client'
import type {
  Goal,
  GoalAccountAvailability,
  GoalCompletePayload,
  GoalCreatePayload,
  GoalEvent,
  GoalFundsPayload,
  GoalUpdatePayload,
} from '../types/goal'

interface GoalsResponse {
  active_goals: Goal[]
  completed_goals: Goal[]
  account_availability: GoalAccountAvailability[]
  total_blocked_paise: number
}

interface GoalResponse {
  goal: Goal
}

interface GoalHistoryResponse {
  events: GoalEvent[]
}

interface GoalAccountAvailabilityResponse {
  accounts: GoalAccountAvailability[]
  total_blocked_paise: number
}

export const getGoals = () => request<GoalsResponse>('/goals')

export const createGoal = (payload: GoalCreatePayload) =>
  request<GoalResponse>('/goals', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const updateGoal = (id: string, payload: GoalUpdatePayload) =>
  request<GoalResponse>(`/goals/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })

export const blockGoalFunds = (id: string, payload: GoalFundsPayload) =>
  request<GoalResponse>(`/goals/${id}/block`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const releaseGoalFunds = (id: string, payload: GoalFundsPayload) =>
  request<GoalResponse>(`/goals/${id}/release`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const completeGoal = (id: string, payload: GoalCompletePayload = {}) =>
  request<GoalResponse>(`/goals/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const getGoalHistory = (id: string) =>
  request<GoalHistoryResponse>(`/goals/${id}/history`)

export const getGoalAccountAvailability = () =>
  request<GoalAccountAvailabilityResponse>('/goals/account-availability')
