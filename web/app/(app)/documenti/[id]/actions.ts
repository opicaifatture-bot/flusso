"use server";
import { revalidatePath } from "next/cache";
import { sessioneSede } from "@/lib/sessione";
import { messaggioErrore } from "@/lib/format";
import type { Esito, StatoAnomalia } from "@/lib/tipi";

type Campi = Record<string, string | number | null>;

async function esegui(funzione: string, parametri: Record<string, unknown>): Promise<Esito> {
  const { supabase } = await sessioneSede();
  const { error } = await supabase.rpc(funzione, parametri);
  if (error) return { ok: false, errore: messaggioErrore(error) };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Ogni correzione passa da una RPC che verifica il ruolo e viene registrata nell'audit. */
export async function correggiRiga(rigaId: string, campi: Campi) {
  return esegui("correggi_riga", { p_riga_id: rigaId, p_campi: campi });
}
export async function correggiDocumento(documentoId: string, campi: Campi) {
  return esegui("correggi_documento", { p_documento_id: documentoId, p_campi: campi });
}
export async function gestisciAnomalia(rigaId: string, stato: StatoAnomalia, nota?: string) {
  return esegui("gestisci_anomalia", { p_riga_id: rigaId, p_stato: stato, p_nota: nota ?? null });
}
