"use server";
import { revalidatePath } from "next/cache";
import { sessioneSede } from "./sessione";
import { messaggioErrore } from "./format";
import type { Esito } from "./tipi";

// Le sole RPC che l'interfaccia può invocare tramite i moduli generici.
// Ruolo, sede e piano sono verificati dal database a ogni chiamata.
const SCRITTURE = new Set([
  "salva_ubicazione", "registra_lettura", "crea_sensore", "imposta_stato_sensore", "gestisci_allarme",
  "ricevi_lotto", "registra_movimento", "storna_movimento", "conta_lotto", "imposta_stato_lotto", "trasferisci_lotto",
  "imposta_conversione", "salva_ricetta", "registra_vendita", "storna_vendita",
  "registra_consegna", "apri_non_conformita", "chiudi_non_conformita", "imposta_scorecard", "proponi_ordine", "decidi_ordine",
  "salva_attrezzatura", "salva_piano_manutenzione", "apri_intervento", "chiudi_intervento", "revoca_invito",
]);
const LETTURE = new Set(["suggerisci_prelievo", "confronta_fornitori", "costo_ricetta"]);

type Parametri = Record<string, unknown>;

/** Sostituisce i segnaposto con la sede e il gruppo attivi: il client non li decide. */
function completa(parametri: Parametri, sede: string, gruppo: string): Parametri {
  return Object.fromEntries(Object.entries(parametri).map(([k, v]) => [k, v === "@sede" ? sede : v === "@gruppo" ? gruppo : v]));
}

export async function esegui<T = unknown>(rpc: string, parametri: Parametri): Promise<Esito<T>> {
  if (!SCRITTURE.has(rpc)) return { ok: false, errore: "Operazione non consentita" };
  const { supabase, attivo } = await sessioneSede();
  const { data, error } = await supabase.rpc(rpc, completa(parametri, attivo.id, attivo.gruppo_id));
  if (error) return { ok: false, errore: messaggioErrore(error) };
  revalidatePath("/", "layout");
  return { ok: true, dati: data as T };
}

export async function leggi<T = unknown>(rpc: string, parametri: Parametri): Promise<Esito<T>> {
  if (!LETTURE.has(rpc)) return { ok: false, errore: "Operazione non consentita" };
  const { supabase, attivo } = await sessioneSede();
  const { data, error } = await supabase.rpc(rpc, completa(parametri, attivo.id, attivo.gruppo_id));
  if (error) return { ok: false, errore: messaggioErrore(error) };
  return { ok: true, dati: data as T };
}
