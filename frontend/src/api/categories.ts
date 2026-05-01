import { request } from "./client";
import type { CategoryNode, CategoryPatch, CategoryPayload } from "../types/category";

interface CategoriesResponse {
  categories: CategoryNode[];
}

interface CategoryResponse {
  category: CategoryNode;
}

export const getCategories = () => request<CategoriesResponse>("/categories");

export const createCategory = (payload: CategoryPayload) =>
  request<CategoryResponse>("/categories", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const updateCategory = (id: string, payload: CategoryPatch) =>
  request<CategoryResponse>(`/categories/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

export const archiveCategory = (id: string) =>
  request<void>(`/categories/${id}`, { method: "DELETE" });
