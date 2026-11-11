"use server";
import { revalidatePath } from "next/cache";
import { sessioneSede } from "@/lib/sessione";
import { messaggioErrore } from "@/lib/format";
import type { Esito } from "@/lib/tipi";

/** Endpoint n8n dell'estrazione: per convenzione accanto a quello dei documenti, salvo N8N_ESTRAZIONE_URL. */
function urlEstrazione() {
  if (process.env.N8N_ESTRAZIONE_URL) return process.env.N8N_ESTRAZIONE_URL;
  const base = process.env.N8N_WEBHOOK_URL;
  return base ? base.replace(/\/documento\/?$/, "/estrazione") : null;
}

/** Avvia la lettura automatica di un documento (manuale, piano analisi…). Le proposte arrivano in pochi minuti. */
export async function avviaEstrazione(versioneId: string): Promise<Esito> {
  const url = urlEstrazione(); const token = process.env.N8N_WEBHOOK_TOKEN;
  if (!url || !token) return { ok: false, errore: "Servizio di estrazione non configurato" };
  const { supabase } = await sessioneSede();
  const { data, error } = await supabase.rpc("avvia_estrazione", { p_versione_id: versioneId });
  if (error) return { ok: false, errore: messaggioErrore(error) };
  const info = data as { file_path: string; mime: string; categoria: string; titolo: string };
  // Link temporaneo al file, valido un'ora: n8n lo scarica senza ricevere credenziali.
  const { data: firmato, error: e2 } = await supabase.storage.from("archivio").createSignedUrl(info.file_path, 3600);
  if (e2 || !firmato) return { ok: false, errore: "Impossibile preparare il file per la lettura" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", [process.env.N8N_WEBHOOK_HEADER || "X-Price-Guardian-Token"]: token },
      body: JSON.stringify({ versione_id: versioneId, url: firmato.signedUrl, mime: info.mime, categoria: info.categoria, titolo: info.titolo }),
      signal: AbortSignal.timeout(15000), cache: "no-store",
    });
    if (!res.ok) return { ok: false, errore: `Il servizio di estrazione ha risposto con un errore (${res.status}). Riprova tra 15 minuti.` };
  } catch {
    return { ok: false, errore: "Il servizio di estrazione non risponde. Riprova tra 15 minuti." };
  }
  revalidatePath("/autocontrollo/piano");
  return { ok: true };
}
