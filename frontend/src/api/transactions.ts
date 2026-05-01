import { ApiError, request } from "./client";
import type {
  BulkTransactionRequest,
  Transaction,
  TransactionFilters,
  TransactionPatch,
  TransactionPayload,
  TransactionSummaryResponse,
  TransactionsResponse,
} from "../types/transaction";

interface TransactionResponse {
  transaction: Transaction;
}

interface BulkTransactionResponse {
  updated: number;
}

export const getTransactions = (filters: TransactionFilters = {}) =>
  request<TransactionsResponse>(`/transactions${queryString(filters)}`);

export const getTransactionSummary = (filters: TransactionFilters = {}) =>
  request<TransactionSummaryResponse>(`/transactions/summary${queryString(filters)}`);

export const createTransaction = (payload: TransactionPayload) =>
  request<TransactionResponse>("/transactions", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const updateTransaction = (id: string, payload: TransactionPatch) =>
  request<TransactionResponse>(`/transactions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

export const deleteTransaction = (id: string) =>
  request<void>(`/transactions/${id}`, { method: "DELETE" });

export const bulkTransactions = (payload: BulkTransactionRequest) =>
  request<BulkTransactionResponse>("/transactions/bulk", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export async function exportTransactionsCsv(filters: TransactionFilters = {}) {
  const response = await fetch(`/api/v1/transactions/export/csv${queryString(filters)}`);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      body?.error?.code ?? "UNKNOWN",
      body?.error?.message ?? "Unable to export transactions",
    );
  }

  return response.blob();
}

function queryString(filters: TransactionFilters): string {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}
