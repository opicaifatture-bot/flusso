// Price Guardian — calcolo degli embedding (modello gte-small, 384 dimensioni)
// per alias e articoli master che ne sono privi.
//
// Sicurezza: la funzione non usa privilegi propri. Lavora con la chiave del
// chiamante e le due RPC che invoca sono eseguibili solo dal service role:
// con qualsiasi altra chiave la chiamata viene respinta dal database.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
const sessione = new (globalThis as any).Supabase.ai.Session("gte-small");

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ errore: "Metodo non consentito" }, 405);

  const chiave = req.headers.get("apikey") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!chiave) return json({ errore: "Chiave mancante" }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, chiave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: mancanti, error } = await db.rpc("embedding_mancanti", { p_limite: 64 });
  if (error) return json({ errore: error.message }, error.code === "42501" ? 403 : 500);

  const calcolati: { tipo: string; id: string; embedding: number[] }[] = [];
  for (const m of mancanti ?? []) {
    const testo = String(m.testo ?? "").trim();
    if (!testo) continue;
    const vettore = await sessione.run(testo, { mean_pool: true, normalize: true });
    calcolati.push({ tipo: m.tipo, id: m.id, embedding: Array.from(vettore as number[]) });
  }
  if (!calcolati.length) return json({ ok: true, calcolati: 0 });

  const { data: salvati, error: e2 } = await db.rpc("salva_embedding", { p_embedding: calcolati });
  if (e2) return json({ errore: e2.message }, 500);
  return json({ ok: true, calcolati: calcolati.length, salvati });
});
