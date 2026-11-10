/** Italia, Francia, Monaco e Svizzera condividono lo stesso fuso: date e orari sono sempre mostrati così, anche sul server. */
export const FUSO = "Europe/Rome";

export function money(v: number | null | undefined, valuta = "EUR", decimali?: number) {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat("it-IT", {
    style: "currency", currency: valuta || "EUR",
    minimumFractionDigits: decimali, maximumFractionDigits: decimali,
  }).format(Number(v));
}
export function moneyCompatto(v: number | null | undefined, valuta = "EUR") {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  return new Intl.NumberFormat("it-IT", {
    style: "currency", currency: valuta, maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2,
  }).format(n);
}
export function num(v: number | null | undefined, digits = 2) {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: digits }).format(Number(v));
}
export function data(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric", timeZone: FUSO });
}
export function dataOra(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleString("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: FUSO });
}
export function dataBreve(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("it-IT", { day: "numeric", month: "short", timeZone: FUSO });
}
/** "12 ago – 10 nov 2026": i periodi sono sempre mostrati con le date esatte. */
export function periodo(dal: string | null | undefined, al: string | null | undefined) {
  if (!dal || !al) return "—";
  return `${dataBreve(dal)} – ${data(al)}`;
}
export function pct(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  return `${n > 0 ? "+" : ""}${n.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`;
}
export const PAESI: Record<string, string> = { IT: "Italia", FR: "Francia", MC: "Monaco", CH: "Svizzera" };
export function cn(...classi: (string | false | null | undefined)[]) {
  return classi.filter(Boolean).join(" ");
}
/** Traduce gli errori del database in un messaggio leggibile. */
export function messaggioErrore(e: { message?: string; code?: string } | null | undefined) {
  if (!e) return "Operazione non riuscita";
  if (e.code === "42501") return e.message && !/permission denied/i.test(e.message) ? e.message : "Non hai i permessi per questa operazione";
  return e.message || "Operazione non riuscita";
}
