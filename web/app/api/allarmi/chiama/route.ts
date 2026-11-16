import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { twilioConfigurato, twilioPost, xml } from "@/lib/twilio";

// Chiamato dal database (pg_net) quando un allarme deve far partire una telefonata o un SMS.
// Corpo: { id, token } — il token è monouso e vale solo per quella chiamata.
type Dati = { telefono: string; canale: "voce" | "sms"; nome: string; ristorante: string; ubicazione: string; dettaglio: string | null; valore: number | null; tipo: string };

const descrivi = (d: Dati) => {
  const dett = (d.dettaglio ?? (d.tipo === "dati_mancanti" ? "nessuna lettura recente" : "temperatura fuori intervallo")).replace(/°C/g, "gradi").replace(/\./g, ",");
  const val = d.valore != null && d.tipo.startsWith("temperatura") ? ` Valore registrato ${String(d.valore).replace(".", ",")} gradi.` : "";
  return `${d.ristorante}, ${d.ubicazione}: ${dett}.${val}`;
};

export async function POST(req: NextRequest) {
  let corpo: { id?: unknown; token?: unknown };
  try { corpo = await req.json(); } catch { return NextResponse.json({ errore: "Corpo non valido" }, { status: 400 }); }
  const id = typeof corpo.id === "string" ? corpo.id : "", token = typeof corpo.token === "string" ? corpo.token : "";
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data } = await supabase.rpc("dati_chiamata", { p_id: id, p_token: token });
  const d = data as Dati | null;
  if (!d) return NextResponse.json({ errore: "Chiamata non trovata o già gestita" }, { status: 404 });
  const esito = (p_esito: string, p_sid: string | null, p_errore: string | null) =>
    supabase.rpc("esito_chiamata", { p_id: id, p_token: token, p_esito, p_sid, p_errore });

  if (!twilioConfigurato()) {
    await esito("non_configurato", null, "Chiavi Twilio non impostate su Vercel");
    return NextResponse.json({ stato: "non_configurato" });
  }
  const base = process.env.APP_URL ?? `https://${req.headers.get("x-forwarded-host") ?? req.headers.get("host")}`;
  const ritorno = (evento: string) => `${base}/api/allarmi/risposta?${new URLSearchParams({ id, t: token, evento })}`;
  const testo = descrivi(d);
  const r = d.canale === "sms"
    ? await twilioPost("Messages", { To: d.telefono, Body: `ALLARME Kitchen OS - ${testo} Nessuno ha confermato al telefono: verifica subito.` })
    : await twilioPost("Calls", {
        To: d.telefono, Timeout: "30", StatusCallback: ritorno("stato"), StatusCallbackEvent: "completed",
        Twiml: `<Response><Gather numDigits="1" timeout="8" action="${xml(ritorno("tasto"))}">`
          + `<Say language="it-IT">Attenzione, allarme temperatura. ${xml(testo)} Premi 1 per confermare che te ne occupi.</Say>`
          + `<Pause length="1"/><Say language="it-IT">Ripeto. ${xml(testo)} Premi 1 per confermare.</Say></Gather>`
          + `<Say language="it-IT">Nessuna conferma ricevuta. Chiamerò il prossimo responsabile.</Say></Response>`,
      });
  await esito(r.ok ? "inviata" : "errore", r.ok ? r.sid : null, r.ok ? null : r.errore);
  return NextResponse.json({ stato: r.ok ? "inviata" : "errore" }, { status: r.ok ? 200 : 502 });
}
