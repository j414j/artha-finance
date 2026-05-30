import { request } from "./client";
import type { InsightsResponse } from "../types/insights";

export function getInsights(year: number, month: number) {
  return request<InsightsResponse>(`/insights?year=${year}&month=${month}`);
}
