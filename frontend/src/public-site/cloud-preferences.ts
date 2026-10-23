export type CloudPreferences = {
  display_name: string;
  theme: "system" | "light" | "dark";
  home_currency: string;
  default_account_id: string | null;
  default_category_id: string | null;
  version: number;
  updated_at: string | null;
};
export const defaultPreferences: CloudPreferences = {
  display_name: "", theme: "system", home_currency: "TWD", default_account_id: null,
  default_category_id: null, version: 0, updated_at: null,
};
