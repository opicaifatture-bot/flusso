import type { Ruolo } from "./tipi";

/**
 * Ruoli con accesso limitato all'autocontrollo: non vedono acquisti, prezzi, magazzino e ricette.
 * È solo l'interfaccia: la vera restrizione è nelle policy del database.
 */
export const RUOLI_AUTOCONTROLLO: Ruolo[] = ["consulente", "cucina"];
export const limitato = (r: Ruolo | null) => !!r && RUOLI_AUTOCONTROLLO.includes(r);

/** Pagina iniziale di un ruolo limitato: il tablet apre i controlli del giorno. */
export const HOME_LIMITATA = "/autocontrollo";
export const homeLimitata = (r: Ruolo | null) => (r === "cucina" ? "/autocontrollo/oggi" : HOME_LIMITATA);

/** Percorsi consentiti ai ruoli limitati. */
export function percorsoConsentito(ruolo: Ruolo | null, percorso: string) {
  if (!limitato(ruolo)) return true;
  const ammessi = ["/autocontrollo", "/celle", "/menu", ...(ruolo === "consulente" ? ["/manutenzione"] : [])];
  return ammessi.some((p) => percorso === p || percorso.startsWith(p + "/"));
}
