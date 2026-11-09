"use server";
import { revalidatePath } from "next/cache";
import { sessioneSede } from "@/lib/sessione";
import { messaggioErrore } from "@/lib/format";
import type { Esito } from "@/lib/tipi";

type NuovoMaster = { nome: string; categoria: string; unita: string };

async function esegui(funzione: string, parametri: Record<string, unknown>): Promise<Esito> {
  const { supabase } = await sessioneSede();
  const { error } = await supabase.rpc(funzione, parametri);
  if (error) return { ok: false, errore: messaggioErrore(error) };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Conferma umana: crea l'alias definitivo, così la prossima volta non serve più l'IA. */
export async function confermaAbbinamento(aliasId: string, masterId: string, fattore: number | null) {
  return esegui("conferma_abbinamento", { p_alias_id: aliasId, p_master_id: masterId, p_fattore: fattore });
}

export async function creaMasterEConferma(aliasId: string, nuovo: NuovoMaster, fattore: number | null): Promise<Esito> {
  const { supabase, attivo } = await sessioneSede();
  const { data: masterId, error } = await supabase.rpc("crea_master", {
    p_gruppo_id: attivo.gruppo_id, p_nome: nuovo.nome, p_categoria: nuovo.categoria, p_unita_base: nuovo.unita,
  });
  if (error) return { ok: false, errore: messaggioErrore(error) };
  return confermaAbbinamento(aliasId, masterId as string, fattore);
}

export async function rifiutaProposta(aliasId: string) {
  return esegui("rifiuta_proposta", { p_alias_id: aliasId });
}
export async function revocaAbbinamento(aliasId: string) {
  return esegui("revoca_abbinamento", { p_alias_id: aliasId });
}
export async function approvaMaster(masterId: string, dati: NuovoMaster) {
  return esegui("approva_master", { p_master_id: masterId, p_nome: dati.nome, p_categoria: dati.categoria, p_unita_base: dati.unita });
}
export async function unisciMaster(da: string, verso: string) {
  return esegui("unisci_master", { p_da: da, p_verso: verso });
}
