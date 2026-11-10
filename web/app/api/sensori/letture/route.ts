import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Adapter IoT: i sensori (o il loro gateway) inviano qui le letture.
//   POST /api/sensori/letture      header  X-Sensore-Chiave: <chiave del sensore>
//   { "valore": 3.4, "rilevata_il": "2026-11-12T10:15:00Z", "id_evento": "abc-123" }
// La chiave identifica il sensore e la sua cella; in database è conservato solo l'hash.
// "id_evento" rende l'invio ripetibile senza doppioni. Nessun sensore è oggi collegato.
export async function POST(req: NextRequest) {
  const chiave = req.headers.get("x-sensore-chiave");
  if (!chiave) return NextResponse.json({ errore: "Chiave del sensore mancante" }, { status: 401 });
  let corpo: { valore?: unknown; rilevata_il?: unknown; id_evento?: unknown };
  try { corpo = await req.json(); } catch { return NextResponse.json({ errore: "Corpo non valido" }, { status: 400 }); }
  const valore = typeof corpo.valore === "number" && Number.isFinite(corpo.valore) ? corpo.valore : null;
  if (valore === null) return NextResponse.json({ errore: "Campo 'valore' mancante o non numerico (°C)" }, { status: 400 });
  const quando = typeof corpo.rilevata_il === "string" && !Number.isNaN(Date.parse(corpo.rilevata_il)) ? corpo.rilevata_il : new Date().toISOString();

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await supabase.rpc("ingest_lettura", {
    p_chiave: chiave, p_valore: valore, p_rilevata_il: quando,
    p_idempotenza: typeof corpo.id_evento === "string" ? corpo.id_evento.slice(0, 100) : null,
  });
  if (error) {
    const stato = error.code === "42501" ? 401 : error.code === "P0403" ? 403 : 400;
    return NextResponse.json({ errore: error.message }, { status: stato });
  }
  return NextResponse.json(data, { status: 201 });
}
