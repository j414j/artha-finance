import { ApiError, request } from "./client";
import type {
  BatchCreateRequest,
  BatchCreateResponse,
  BatchRowError,
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

export class BatchCreateError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly rowErrors: BatchRowError[],
  ) {
    super(message);
    this.name = "BatchCreateError";
  }
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

export async function batchCreateTransactions(
  payload: BatchCreateRequest,
): Promise<BatchCreateResponse> {
  const res = await fetch("/api/v1/transactions/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => null) as {
    error?: { code: string; message: string; row_errors?: BatchRowError[] };
    created?: number;
  } | null;

  if (!res.ok) {
    const err = body?.error;
    throw new BatchCreateError(
      res.status,
      err?.code ?? "UNKNOWN",
      err?.message ?? "An unexpected error occurred",
      err?.row_errors ?? [],
    );
  }

  return body as BatchCreateResponse;
}

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
