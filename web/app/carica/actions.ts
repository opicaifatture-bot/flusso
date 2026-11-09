"use server";
import { supabaseServer } from "@/lib/supabase";

export type Esito = { ok: boolean; messaggio: string; documento_id?: string; n_anomalie?: number };

export async function caricaDocumento(_: Esito | null, formData: FormData): Promise<Esito> {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, messaggio: "Sessione scaduta: accedi di nuovo." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, messaggio: "Seleziona un file." };
  if (file.size > 15 * 1024 * 1024) return { ok: false, messaggio: "File troppo grande (max 15 MB)." };

  const url = process.env.N8N_WEBHOOK_URL;
  const token = process.env.N8N_WEBHOOK_TOKEN;
  if (!url || !token) return { ok: false, messaggio: "Webhook n8n non configurato (N8N_WEBHOOK_URL / N8N_WEBHOOK_TOKEN)." };

  const fd = new FormData();
  fd.append("data", file, file.name);
  const res = await fetch(url, {
    method: "POST",
    headers: { [process.env.N8N_WEBHOOK_HEADER || "X-Price-Guardian-Token"]: token },
    body: fd,
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, messaggio: `Errore elaborazione (${res.status}): ${text.slice(0, 300)}` };
  try {
    const j = JSON.parse(text);
    return {
      ok: true,
      documento_id: j.documento_id,
      n_anomalie: j.n_anomalie,
      messaggio: j.n_anomalie ? `Documento acquisito: ${j.n_anomalie} rincaro/i anomalo/i rilevato/i.` : "Documento acquisito, nessuna anomalia di prezzo.",
    };
  } catch {
    return { ok: false, messaggio: "Risposta non valida dal webhook." };
  }
}
