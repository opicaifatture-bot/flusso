export function money(v: number | null | undefined, valuta = "EUR") {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: valuta || "EUR" }).format(Number(v));
}
export function num(v: number | null | undefined, digits = 2) {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: digits }).format(Number(v));
}
export function data(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}
export function pct(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  return `${n > 0 ? "+" : ""}${n.toLocaleString("it-IT", { maximumFractionDigits: 2 })}%`;
}
export const BANDIERE: Record<string, string> = { IT: "🇮🇹", FR: "🇫🇷", MC: "🇲🇨", CH: "🇨🇭" };
