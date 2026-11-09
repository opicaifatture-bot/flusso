import type { Metadata } from "next";
import Link from "next/link";
import { Search, Upload } from "lucide-react";
import { sessioneSede } from "@/lib/sessione";
import type { Documento } from "@/lib/tipi";
import { Avviso, Intestazione, Schede, Vuoto } from "@/components/ui";
import { COLONNE_DOCUMENTO, TabellaDocumenti } from "@/components/tabella-documenti";
import { InDiretta } from "@/components/in-diretta";

export const metadata: Metadata = { title: "Documenti" };

const FILTRI = [
  { chiave: "tutti", etichetta: "Tutti" },
  { chiave: "rincari", etichetta: "Con rincari" },
  { chiave: "lavorazione", etichetta: "In lavorazione" },
  { chiave: "problemi", etichetta: "Errori e duplicati" },
];

export default async function Documenti({ searchParams }: { searchParams: Promise<{ filtro?: string; q?: string }> }) {
  const { filtro = "tutti", q } = await searchParams;
  const { supabase, attivo, permessi } = await sessioneSede();

  let query = supabase.from("documenti").select(COLONNE_DOCUMENTO).eq("ristorante_id", attivo.id)
    .order("created_at", { ascending: false }).limit(200);
  if (filtro === "rincari") query = query.gt("n_anomalie", 0).eq("stato", "completato");
  if (filtro === "lavorazione") query = query.in("stato", ["in_coda", "elaborazione"]);
  if (filtro === "problemi") query = query.in("stato", ["errore", "duplicato"]);
  const cerca = q?.trim().replace(/[%,()]/g, " ");
  if (cerca) query = query.or(`numero.ilike.%${cerca}%,nome_file.ilike.%${cerca}%`);
  const { data: documenti, error } = await query.returns<Documento[]>();
  const inLavorazione = (documenti ?? []).some((d) => d.stato === "in_coda" || d.stato === "elaborazione");

  const parametri = (f: string) => {
    const p = new URLSearchParams();
    if (f !== "tutti") p.set("filtro", f);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `/documenti?${s}` : "/documenti";
  };

  return (
    <>
      <InDiretta ristoranteId={attivo.id} inLavorazione={inLavorazione} />
      <Intestazione titolo="Documenti" sottotitolo="Fatture, DDT e note di credito acquisiti">
        <form className="relative">
          {filtro !== "tutti" && <input type="hidden" name="filtro" value={filtro} />}
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <input name="q" defaultValue={q} placeholder="Cerca numero o file…" aria-label="Cerca documento" className="input w-56 pl-8" />
        </form>
        {permessi.caricare && <Link href="/carica" className="btn btn-primary"><Upload className="size-3.5" />Carica</Link>}
      </Intestazione>

      <Schede attiva={filtro} voci={FILTRI.map((f) => ({ ...f, href: parametri(f.chiave) }))} />
      {error && <div className="mt-4"><Avviso>{error.message}</Avviso></div>}
      <div className="card mt-4">
        <TabellaDocumenti documenti={documenti ?? []}
          vuoto={<Vuoto titolo="Nessun documento trovato">{q ? "Prova con un altro termine di ricerca." : "Non ci sono documenti in questa vista."}</Vuoto>} />
      </div>
    </>
  );
}
