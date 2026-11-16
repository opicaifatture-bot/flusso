import { createHmac, timingSafeEqual } from "node:crypto";

// Adapter Twilio per le chiamate d'allarme. Le chiavi stanno solo nelle variabili d'ambiente
// di Vercel (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_NUMERO): mai nel database o nel client.
export function twilioConfigurato() {
  return !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN && !!process.env.TWILIO_NUMERO;
}

export async function twilioPost(risorsa: "Calls" | "Messages", campi: Record<string, string>) {
  const sid = process.env.TWILIO_ACCOUNT_SID!, token = process.env.TWILIO_AUTH_TOKEN!;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/${risorsa}.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: process.env.TWILIO_NUMERO!, ...campi }),
  });
  const dati = (await r.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
  return r.ok ? { ok: true as const, sid: dati.sid ?? null } : { ok: false as const, errore: `Twilio ${r.status}${dati.code ? ` (${dati.code})` : ""}: ${dati.message ?? "errore"}` };
}

/** Verifica la firma X-Twilio-Signature (HMAC-SHA1 di URL + parametri ordinati). */
export function firmaTwilioValida(url: string, parametri: Record<string, string>, firma: string | null) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !firma) return false;
  const dati = url + Object.keys(parametri).sort().map((k) => k + parametri[k]).join("");
  const attesa = createHmac("sha1", token).update(dati, "utf8").digest();
  const ricevuta = Buffer.from(firma, "base64");
  return attesa.length === ricevuta.length && timingSafeEqual(attesa, ricevuta);
}

export const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
