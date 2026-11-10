"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase";
import { messaggioErrore } from "@/lib/format";
import type { Esito } from "@/lib/tipi";

const valido = (t: string) => /^[0-9a-f]{64}$/.test(t);

async function origine() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

/** Crea l'account dell'invitato. La password la sceglie lui e va solo a Supabase Auth: qui non viene né salvata né registrata. */
export async function registrati(token: string, _: Esito<string> | null, form: FormData): Promise<Esito<string>> {
  if (!valido(token)) return { ok: false, errore: "Invito non valido" };
  const supabase = await supabaseServer();
  const { data: anteprima } = await supabase.rpc("anteprima_invito", { p_token: token });
  if (anteprima?.stato !== "valido") return { ok: false, errore: "Invito non più valido" };
  const password = String(form.get("password") ?? "");
  if (password.length < 10) return { ok: false, errore: "La password deve avere almeno 10 caratteri" };
  if (password !== String(form.get("conferma") ?? "")) return { ok: false, errore: "Le due password non coincidono" };

  const { data, error } = await supabase.auth.signUp({
    email: anteprima.email, password,
    options: { emailRedirectTo: `${await origine()}/auth/conferma?next=/invito/${token}` },
  });
  if (error) return { ok: false, errore: /registered|already/i.test(error.message) ? "Esiste già un account con questa email: accedi qui sotto" : error.message };
  // Con la conferma dell'email attiva Supabase non apre la sessione: l'utente deve prima verificare l'indirizzo.
  if (data.session) return accetta(token);
  if (data.user && data.user.identities?.length === 0) return { ok: false, errore: "Esiste già un account con questa email: accedi qui sotto" };
  return { ok: true, dati: "Ti abbiamo inviato un'email di conferma. Apri il collegamento che contiene: tornerai qui per completare l'accesso." };
}

/** Chi ha già un account accede con la propria password e accetta: nessun account doppio. */
export async function accediEAccetta(token: string, _: Esito<string> | null, form: FormData): Promise<Esito<string>> {
  if (!valido(token)) return { ok: false, errore: "Invito non valido" };
  const supabase = await supabaseServer();
  const { data: anteprima } = await supabase.rpc("anteprima_invito", { p_token: token });
  if (anteprima?.stato !== "valido") return { ok: false, errore: "Invito non più valido" };
  const { error } = await supabase.auth.signInWithPassword({ email: anteprima.email, password: String(form.get("password") ?? "") });
  if (error) return { ok: false, errore: /not confirmed/i.test(error.message) ? "Conferma prima il tuo indirizzo dal messaggio che hai ricevuto" : "Email o password non corretti" };
  return accetta(token);
}

export async function accetta(token: string): Promise<Esito<string>> {
  if (!valido(token)) return { ok: false, errore: "Invito non valido" };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("accetta_invito", { p_token: token });
  if (error) return { ok: false, errore: messaggioErrore(error) };
  if (data?.ristorante_id) (await cookies()).set("pg_sede", data.ristorante_id, { path: "/", maxAge: 31536000, sameSite: "lax", httpOnly: true });
  redirect("/");
}
