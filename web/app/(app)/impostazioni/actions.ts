"use server";
import { revalidatePath } from "next/cache";
import { sessioneSede } from "@/lib/sessione";
import { messaggioErrore } from "@/lib/format";
import type { Esito, Ruolo } from "@/lib/tipi";

export type EsitoAudit = { righe: number; valida: boolean; dettaglio: string | null; prima_anomalia_seq: number | null; ultimo_hash: string | null };

export async function salvaSede(_: Esito | null, form: FormData): Promise<Esito> {
  const { supabase, attivo } = await sessioneSede();
  const soglia = Number(String(form.get("soglia") ?? "").replace(",", "."));
  if (!Number.isFinite(soglia) || soglia <= 0 || soglia > 100) return { ok: false, errore: "La soglia deve essere un numero tra 0 e 100" };
  const { error } = await supabase.rpc("aggiorna_ristorante", {
    p_ristorante_id: attivo.id, p_nome: String(form.get("nome") ?? ""), p_soglia_anomalia_pct: soglia,
    p_paese: String(form.get("paese") ?? ""), p_valuta: String(form.get("valuta") ?? ""), p_partita_iva: String(form.get("partita_iva") ?? ""),
  });
  if (error) return { ok: false, errore: messaggioErrore(error) };
  const gruppo = String(form.get("gruppo") ?? "").trim();
  if (gruppo && gruppo !== attivo.gruppi?.nome) {
    const { error: e2 } = await supabase.rpc("aggiorna_gruppo", { p_gruppo_id: attivo.gruppo_id, p_nome: gruppo });
    if (e2) return { ok: false, errore: messaggioErrore(e2) };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function aggiungiMembro(_: Esito | null, form: FormData): Promise<Esito> {
  const { supabase, attivo } = await sessioneSede();
  const { error } = await supabase.rpc("imposta_membro", {
    p_ristorante_id: attivo.id, p_email: String(form.get("email") ?? ""), p_ruolo: String(form.get("ruolo")) as Ruolo,
  });
  if (error) return { ok: false, errore: messaggioErrore(error) };
  revalidatePath("/impostazioni");
  return { ok: true };
}

export async function rimuoviMembro(userId: string): Promise<Esito> {
  const { supabase, attivo } = await sessioneSede();
  const { error } = await supabase.rpc("rimuovi_membro", { p_ristorante_id: attivo.id, p_user_id: userId });
  if (error) return { ok: false, errore: messaggioErrore(error) };
  revalidatePath("/impostazioni");
  return { ok: true };
}

export async function verificaAudit(): Promise<Esito<EsitoAudit>> {
  const { supabase, attivo } = await sessioneSede();
  const { data, error } = await supabase.rpc("verifica_audit", { p_gruppo_id: attivo.gruppo_id });
  if (error) return { ok: false, errore: messaggioErrore(error) };
  const r = (data as EsitoAudit[] | null)?.[0];
  return { ok: true, dati: r ?? { righe: 0, valida: true, dettaglio: null, prima_anomalia_seq: null, ultimo_hash: null } };
}
