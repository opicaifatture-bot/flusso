import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { firmaTwilioValida } from "@/lib/twilio";

// Richiami di Twilio: tasto premuto durante la chiamata ("tasto") ed esito finale ("stato").
// Accetta solo richieste firmate da Twilio e con il token monouso della chiamata.
const twiml = (corpo: string) => new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${corpo}</Response>`, { headers: { "Content-Type": "text/xml" } });

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const parametri = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const u = new URL(req.url);
  const pubblico = `${process.env.APP_URL ?? `https://${req.headers.get("x-forwarded-host") ?? u.host}`}${u.pathname}${u.search}`;
  if (!firmaTwilioValida(pubblico, parametri, req.headers.get("x-twilio-signature"))) return new NextResponse("Firma non valida", { status: 403 });

  const id = u.searchParams.get("id") ?? "", token = u.searchParams.get("t") ?? "", evento = u.searchParams.get("evento");
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const esito = (p_esito: string) => supabase.rpc("esito_chiamata", { p_id: id, p_token: token, p_esito, p_sid: parametri.CallSid ?? null, p_errore: null });

  if (evento === "tasto") {
    if (parametri.Digits === "1") {
      await esito("confermata");
      return twiml(`<Say language="it-IT">Grazie. Allarme preso in carico a tuo nome. Registra nell'app cosa hai fatto.</Say>`);
    }
    return twiml(`<Say language="it-IT">Tasto non valido. Nessuna conferma registrata.</Say>`);
  }
  if (evento === "stato") {
    // Chiamata finita senza conferma (non risposto, occupato, rifiutato o riagganciato).
    if (["no-answer", "busy", "failed", "canceled", "completed"].includes(parametri.CallStatus ?? "")) await esito("senza_risposta");
    return new NextResponse(null, { status: 204 });
  }
  return new NextResponse("Evento non valido", { status: 400 });
}
