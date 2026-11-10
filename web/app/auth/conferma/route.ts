import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase";

// Arrivo dal link di conferma dell'email inviato da Supabase Auth: apre la sessione e
// riporta l'utente dove stava andando (di solito la pagina dell'invito). Solo percorsi interni.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const prossimo = p.get("next") ?? "/";
  const destinazione = req.nextUrl.clone();
  destinazione.search = "";
  destinazione.pathname = prossimo.startsWith("/") && !prossimo.startsWith("//") ? prossimo : "/";

  const supabase = await supabaseServer();
  const codice = p.get("code"); const hash = p.get("token_hash"); const tipo = p.get("type") as EmailOtpType | null;
  const { error } = codice ? await supabase.auth.exchangeCodeForSession(codice)
    : hash && tipo ? await supabase.auth.verifyOtp({ token_hash: hash, type: tipo })
    : { error: new Error("Collegamento non valido") };
  if (error) {
    destinazione.pathname = "/login";
    destinazione.searchParams.set("errore", "Collegamento di conferma non valido o scaduto: accedi e riprova");
  }
  return NextResponse.redirect(destinazione);
}
