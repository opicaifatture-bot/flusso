"use server";
import { revalidatePath } from "next/cache";
import { sessioneSede } from "@/lib/sessione";
import { messaggioErrore } from "@/lib/format";
import type { Esito, StatoDocumento } from "@/lib/tipi";

export type Prenotazione =
  | { duplicato: true; documentoId: string; stato: StatoDocumento }
  | { duplicato: false; documentoId: string; percorso: string; token: string; mime: string };

export type StatoRemoto = {
  id: string; stato: StatoDocumento; fase: string | null; errore: string | null; n_anomalie: number;
  tipo: string; numero: string | null; duplicato_di: string | null;
};

/** Passo 1: prenota il documento (verifica ruolo, sede e duplicati) e ottiene l'URL firmato per l'upload diretto. */
export async function prenotaCaricamento(file: { nome: string; dimensione: number; sha256: string }): Promise<Esito<Prenotazione>> {
  const { supabase, attivo } = await sessioneSede();
  const { data, error } = await supabase.rpc("crea_caricamento", {
    p_ristorante_id: attivo.id, p_nome_file: file.nome, p_dimensione: file.dimensione, p_sha256: file.sha256,
  });
  if (error) return { ok: false, errore: messaggioErrore(error) };
  if (data.duplicato) return { ok: true, dati: { duplicato: true, documentoId: data.documento_id, stato: data.stato } };

  const { data: firma, error: e2 } = await supabase.storage.from("documenti").createSignedUploadUrl(data.file_path);
  if (e2 || !firma) return { ok: false, errore: "Impossibile preparare il caricamento: " + (e2?.message ?? "errore sconosciuto") };
  return { ok: true, dati: { duplicato: false, documentoId: data.documento_id, percorso: data.file_path, token: firma.token, mime: data.mime } };
}

/** Passo 2: a file caricato, avvisa n8n con un payload minimo. n8n risponde 202 e lavora in background. */
export async function avviaElaborazione(documentoId: string): Promise<Esito> {
  const { supabase } = await sessioneSede();
  // La RLS garantisce che il documento appartenga a una sede dell'utente.
  const { data: doc } = await supabase.from("documenti").select("id,stato").eq("id", documentoId).maybeSingle();
  if (!doc) return { ok: false, errore: "Documento non trovato" };
  if (doc.stato !== "in_coda") return { ok: true };

  const url = process.env.N8N_WEBHOOK_URL;
  const token = process.env.N8N_WEBHOOK_TOKEN;
  if (!url || !token) return { ok: false, errore: "Servizio di elaborazione non configurato (N8N_WEBHOOK_URL / N8N_WEBHOOK_TOKEN)" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", [process.env.N8N_WEBHOOK_HEADER || "X-Price-Guardian-Token"]: token },
      body: JSON.stringify({ documento_id: documentoId }),
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, errore: `Il servizio di elaborazione ha risposto con un errore (${res.status})` };
  } catch {
    return { ok: false, errore: "Il servizio di elaborazione non risponde. Riprova tra poco." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function riprovaDocumento(documentoId: string): Promise<Esito> {
  const { supabase } = await sessioneSede();
  const { error } = await supabase.rpc("riprova_documento", { p_documento_id: documentoId });
  if (error) return { ok: false, errore: messaggioErrore(error) };
  return avviaElaborazione(documentoId);
}

export async function eliminaDocumento(documentoId: string): Promise<Esito> {
  const { supabase } = await sessioneSede();
  const { error } = await supabase.rpc("elimina_documento", { p_documento_id: documentoId });
  if (error) return { ok: false, errore: messaggioErrore(error) };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function statoDocumenti(ids: string[]): Promise<StatoRemoto[]> {
  if (!ids.length) return [];
  const { supabase } = await sessioneSede();
  const { data } = await supabase.from("documenti")
    .select("id,stato,fase,errore,n_anomalie,tipo,numero,duplicato_di").in("id", ids.slice(0, 50)).returns<StatoRemoto[]>();
  return data ?? [];
}
