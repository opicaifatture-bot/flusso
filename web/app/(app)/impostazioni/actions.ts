"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { emailConfigurata, inviaEmail, modelloInvito } from "@/lib/email";
import { data as fmtData } from "@/lib/format";
import { RUOLI } from "@/lib/tipi";
import { sessioneSede } from "@/lib/sessione";
import { messaggioErrore } from "@/lib/format";
import type { Esito, Ruolo } from "@/lib/tipi";

export type EsitoAudit = { righe: number; valida: boolean; dettaglio: string | null; prima_anomalia_seq: number | null; ultimo_hash: string | null };

export async function salvaSede(_: Esito | null, form: FormData): Promise<Esito> {
  const { supabase, attivo } = await sessioneSede();
  const soglia = Number(String(form.get("soglia") ?? "").replace(",", "."));
  if (!Number.isFinite(soglia) || soglia <= 0 || soglia > 100) return { ok: false, errore: "La soglia deve essere un numero tra 0 e 100" };
  const minimo = Number(String(form.get("soglia_min") || "0").replace(",", "."));
  if (!Number.isFinite(minimo) || minimo < 0) return { ok: false, errore: "La soglia minima deve essere un importo in euro, anche zero" };
  const paese = String(form.get("paese") ?? "");
  if (!paese) return { ok: false, errore: "Scegli il paese della sede" };
  const { error } = await supabase.rpc("aggiorna_ristorante", {
    p_ristorante_id: attivo.id, p_nome: String(form.get("nome") ?? ""), p_soglia_anomalia_pct: soglia,
    p_soglia_anomalia_min_eur: minimo, p_paese: paese, p_valuta: String(form.get("valuta") ?? ""), p_partita_iva: String(form.get("partita_iva") ?? ""),
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

export type VoceAudit = {
  seq: number; creato_il: string; tabella: string; riga_id: string | null; operazione: string; origine: string;
  dopo: Record<string, unknown> | null; utente_id: string | null; autore: string | null; ip: string | null;
};

/** Pagina del registro: filtri per origine e tipo di dato, 50 righe per volta a ritroso. */
export async function leggiAudit(filtri: { origine?: string; tabella?: string; primaDi?: number }): Promise<Esito<VoceAudit[]>> {
  const { supabase, attivo } = await sessioneSede();
  const { data, error } = await supabase.rpc("registro_audit", {
    p_gruppo_id: attivo.gruppo_id, p_limite: 50, p_prima_di: filtri.primaDi ?? null,
    p_tabella: filtri.tabella || null, p_origine: filtri.origine || null,
  });
  if (error) return { ok: false, errore: messaggioErrore(error) };
  return { ok: true, dati: (data ?? []) as VoceAudit[] };
}

export type EsitoInvito = { inviata: boolean; link: string | null; nota: string };

/**
 * Crea (o rinnova) un invito e prova a inviarlo. Il token esiste solo qui e nel link:
 * non viene salvato né scritto nei log. Se l'email non parte, il link viene restituito
 * al titolare perché lo consegni di persona, e l'invito resta marcato come non inviato.
 */
export async function invita(_: Esito<EsitoInvito> | null, form: FormData): Promise<Esito<EsitoInvito>> {
  const { supabase, attivo, user } = await sessioneSede();
  const ruolo = String(form.get("ruolo")) as Ruolo;
  const { data, error } = await supabase.rpc("crea_invito", {
    p_ristorante_id: attivo.id, p_email: String(form.get("email") ?? ""), p_ruolo: ruolo,
    p_intero_gruppo: form.get("ambito") === "gruppo", p_giorni_validita: Number(form.get("giorni") || 7),
  });
  if (error) return { ok: false, errore: messaggioErrore(error) };
  const h = await headers();
  const link = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}/invito/${data.token}`;
  const esito = await inviaEmail(String(form.get("email")).trim().toLowerCase(), modelloInvito({
    sede: form.get("ambito") === "gruppo" ? (attivo.gruppi?.nome ?? attivo.nome) : attivo.nome,
    ruolo: RUOLI[ruolo], link, scadenza: fmtData(data.scade_il), invitante: user.email ?? "Il titolare",
  }));
  await supabase.rpc("segna_invio_invito", { p_invito_id: data.invito_id, p_riuscito: esito.inviata, p_errore: esito.inviata ? null : esito.dettaglio });
  revalidatePath("/impostazioni");
  return { ok: true, dati: esito.inviata
    ? { inviata: true, link: null, nota: data.rinnovato ? "Invito rinnovato e inviato di nuovo: il collegamento precedente non vale più." : "Invito inviato." }
    : { inviata: false, link, nota: esito.motivo === "non_configurata"
        ? "L'invio automatico delle email non è configurato: copia il collegamento e consegnalo alla persona. Non verrà più mostrato."
        : `Invio non riuscito (${esito.dettaglio}): copia il collegamento e consegnalo tu. Non verrà più mostrato.` } };
}

export async function emailAttiva() { return emailConfigurata(); }
