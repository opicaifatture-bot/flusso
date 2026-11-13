"use server";
import { supabaseServer } from "@/lib/supabase";
import { messaggioErrore } from "@/lib/format";
import type { Esito } from "@/lib/tipi";

// Il cliente non ha account: ogni chiamata usa solo il token del QR, verificato dal database
// (funziona solo mentre il tavolo è aperto dal personale).
const valido = (t: string) => /^[0-9a-f]{64}$/.test(t);

async function rpc<T>(nome: string, parametri: Record<string, unknown>): Promise<Esito<T>> {
  if (!valido(String(parametri.p_token ?? ""))) return { ok: false, errore: "Codice del tavolo non valido" };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc(nome, parametri);
  if (error) return { ok: false, errore: messaggioErrore(error) };
  return { ok: true, dati: data as T };
}

export async function statoTavolo(token: string) { return rpc<Record<string, unknown>>("tavolo_cliente", { p_token: token }); }
export async function ordina(token: string, righe: { voce_id: string; quantita: number; note?: string }[], lingua: string) {
  return rpc<{ ordine: number }>("ordina_dal_tavolo", { p_token: token, p_righe: righe, p_lingua: lingua });
}
export async function chiama(token: string, tipo: "cameriere" | "conto" | "acqua" | "pane") { return rpc("chiama_dal_tavolo", { p_token: token, p_tipo: tipo }); }
export async function paga(token: string, importo: number, mancia: number, quota: Record<string, unknown>) {
  return rpc<{ prova: boolean }>("paga_dal_tavolo", { p_token: token, p_importo: importo, p_mancia: mancia, p_quota: quota });
}
