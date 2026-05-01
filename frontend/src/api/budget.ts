import { request } from "./client";
import type {
  BudgetAllocationPayload,
  BudgetBaseAllocation,
  BudgetHistory,
  BudgetMonth,
} from "../types/budget";

interface BudgetResponse {
  budget: BudgetMonth;
}

interface BudgetBaseResponse {
  allocations: BudgetBaseAllocation[];
}

interface BudgetHistoryResponse {
  history: BudgetHistory;
}

export function getBudget(year: number, month: number) {
  return request<BudgetResponse>(`/budget?year=${year}&month=${month}`);
}

export function getBaseBudget() {
  return request<BudgetBaseResponse>("/budget/base");
}

export function updateBaseBudget(allocations: BudgetAllocationPayload[]) {
  return request<BudgetBaseResponse>("/budget/base", {
    method: "PUT",
    body: JSON.stringify({ allocations }),
  });
}

export function updateMonthlyBudget(
  year: number,
  month: number,
  allocations: BudgetAllocationPayload[],
) {
  return request<BudgetResponse>("/budget/monthly", {
    method: "PUT",
    body: JSON.stringify({ year, month, allocations }),
  });
}

export function getBudgetHistory(year: number, month: number, months = 6) {
  return request<BudgetHistoryResponse>(
    `/budget/history?year=${year}&month=${month}&months=${months}`,
  );
}
