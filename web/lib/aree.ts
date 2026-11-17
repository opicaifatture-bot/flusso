import type { Ruolo } from "./tipi";

/**
 * Ruoli con accesso limitato: non vedono acquisti, prezzi d'acquisto, magazzino e ricette.
 * È solo l'interfaccia: la vera restrizione è nelle policy del database.
 */
export const RUOLI_LIMITATI: Ruolo[] = ["consulente", "cucina", "sala"];
export const limitato = (r: Ruolo | null) => !!r && RUOLI_LIMITATI.includes(r);

/** Pagina iniziale dei ruoli limitati. */
export const HOME_LIMITATA = "/autocontrollo";
export const homeLimitata = (r: Ruolo | null) => (r === "cucina" ? "/autocontrollo/oggi" : r === "sala" ? "/sala" : HOME_LIMITATA);

/** Percorsi consentiti ai ruoli limitati. */
export function percorsoConsentito(ruolo: Ruolo | null, percorso: string) {
  if (!limitato(ruolo)) return true;
  const ammessi = ruolo === "sala" ? ["/sala", "/menu"]
    : ["/autocontrollo", "/celle", "/menu", ...(ruolo === "consulente" ? ["/manutenzione"] : ["/sala/cucina"])];
  return ammessi.some((p) => percorso === p || percorso.startsWith(p + "/"));
}
