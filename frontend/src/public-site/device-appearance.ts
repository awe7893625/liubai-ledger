export type DeviceAppearance = { nickname: string; theme: "system" | "light" | "dark"; currency: "TWD" | "USD" | "JPY" };
export const defaultAppearance: DeviceAppearance = { nickname: "", theme: "system", currency: "TWD" };
export function readDeviceAppearance(uid: string): DeviceAppearance {
  try {
    const get = (key: string) => localStorage.getItem(`ledger-settings:${uid}:${key}`);
    const theme = get("theme"); const currency = get("currency");
    return { nickname: (get("nickname") || "").trim().slice(0, 40), theme: theme === "light" || theme === "dark" ? theme : "system", currency: currency === "USD" || currency === "JPY" ? currency : "TWD" };
  } catch { return { ...defaultAppearance }; }
}
