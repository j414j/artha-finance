export type CategoryType = "income" | "expense";

export interface CategoryNode {
  id: string;
  parent_id: string | null;
  name: string;
  type: CategoryType;
  color_hex: string;
  icon_emoji: string | null;
  is_default: boolean;
  children: CategoryNode[];
}

export interface CategoryPayload {
  parent_id?: string | null;
  name: string;
  type: CategoryType;
  color_hex: string;
  icon_emoji?: string | null;
}

export type CategoryPatch = Partial<Omit<CategoryPayload, "type">>;
