import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase";
import type { Cruscotto, Ristorante, Ruolo } from "./tipi";

const puo = (ruolo: Ruolo | null, ...ammessi: Ruolo[]) => !!ruolo && ammessi.includes(ruolo);

/** Utente, sedi accessibili, sede attiva e permessi. Una sola lettura per richiesta. */
export const sessione = cache(async () => {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: ristoranti }, { data: mr }, { data: mg }] = await Promise.all([
    supabase.from("ristoranti")
      .select("id,nome,paese,valuta,partita_iva,soglia_anomalia_pct,soglia_anomalia_min_eur,gruppo_id,gruppi(id,nome)")
      .order("nome").returns<Ristorante[]>(),
    supabase.from("membri_ristorante").select("ristorante_id,ruolo").eq("user_id", user.id)
      .returns<{ ristorante_id: string; ruolo: Ruolo }[]>(),
    supabase.from("membri_gruppo").select("gruppo_id,ruolo").eq("user_id", user.id)
      .returns<{ gruppo_id: string; ruolo: Ruolo }[]>(),
  ]);

  const sedi = ristoranti ?? [];
  const scelta = (await cookies()).get("pg_sede")?.value;
  const attivo = sedi.find((r) => r.id === scelta) ?? sedi[0] ?? null;
  const ruolo: Ruolo | null = attivo
    ? mr?.find((m) => m.ristorante_id === attivo.id)?.ruolo
      ?? mg?.find((m) => m.gruppo_id === attivo.gruppo_id)?.ruolo
      ?? "sola_lettura"
    : null;

  return {
    supabase, user, sedi, attivo, ruolo,
    permessi: {
      caricare: puo(ruolo, "titolare", "chef", "contabile"),
      correggereRighe: puo(ruolo, "titolare", "chef", "contabile"),
      correggereDocumento: puo(ruolo, "titolare", "contabile"),
      validare: puo(ruolo, "titolare", "chef"),
      approvareMaster: puo(ruolo, "titolare"),
      approvareRincari: puo(ruolo, "titolare"),
      contestare: puo(ruolo, "titolare", "chef", "contabile"),
      impostazioni: puo(ruolo, "titolare"),
      audit: puo(ruolo, "titolare", "contabile"),
    },
  };
});

/** Come sessione(), ma garantisce che esista una sede attiva. */
export async function sessioneSede() {
  const s = await sessione();
  if (!s.attivo || !s.ruolo) redirect("/");
  return { ...s, attivo: s.attivo, ruolo: s.ruolo };
}

export type Piano = {
  piano: string; nome: string; stato: "prova" | "attivo" | "scaduto" | "sospeso" | "annullato";
  prova_fino_al: string | null; periodo_fine: string | null; provider: string; funzioni: string[];
  limiti: Record<string, number | null>; utenti: number; sedi: number;
};

/** Piano del gruppo attivo. Serve solo a mostrare o nascondere: i controlli veri sono nel database. */
export const pianoCorrente = cache(async (gruppoId: string): Promise<Piano | null> => {
  const { supabase } = await sessione();
  const { data } = await supabase.rpc("piano_corrente", { p_gruppo_id: gruppoId });
  return (data as Piano) ?? null;
});

/** Sede attiva più verifica che il piano includa la funzione e consenta di scrivere. */
export async function sessioneModulo(funzione: string) {
  const s = await sessioneSede();
  const piano = await pianoCorrente(s.attivo.gruppo_id);
  const inclusa = !!piano?.funzioni.includes(funzione);
  const scrivibile = inclusa && (piano?.stato === "prova" || piano?.stato === "attivo");
  const operativo = s.ruolo === "titolare" || s.ruolo === "chef";
  return { ...s, piano, inclusa, scrivibile, operativo: operativo && scrivibile, titolare: s.ruolo === "titolare" && scrivibile };
}

export const PERIODI = [30, 90, 365] as const;

/** Indicatori della sede per un periodo (giorni fino a oggi, per data documento). */
export const cruscotto = cache(async (ristoranteId: string, giorni: number = 90): Promise<Cruscotto | null> => {
  const { supabase } = await sessione();
  const { data } = await supabase.rpc("cruscotto", { p_ristorante_id: ristoranteId, p_giorni: giorni });
  return (data as Cruscotto) ?? null;
});
