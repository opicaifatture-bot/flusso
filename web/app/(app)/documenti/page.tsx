import type { Metadata } from "next";
import Link from "next/link";
import { Search, Upload } from "lucide-react";
import { sessioneSede } from "@/lib/sessione";
import type { DocumentoElenco } from "@/lib/tipi";
import { Avviso, Intestazione, Schede, Vuoto } from "@/components/ui";
import { COLONNE_DOCUMENTO, TabellaDocumenti } from "@/components/tabella-documenti";
import { InDiretta } from "@/components/in-diretta";

export const metadata: Metadata = { title: "Documenti" };

const FILTRI = [
  { chiave: "tutti", etichetta: "Tutti", vuoto: "Non ci sono ancora documenti: caricane uno per iniziare." },
  { chiave: "rivedere", etichetta: "Da rivedere", vuoto: "Nessun documento attende un controllo: articoli validati e rincari gestiti." },
  { chiave: "rincari", etichetta: "Con rincari", vuoto: "Nessun documento contiene prezzi saliti oltre la soglia." },
  { chiave: "lavorazione", etichetta: "In lavorazione", vuoto: "Nessun documento in elaborazione in questo momento." },
  { chiave: "problemi", etichetta: "Errori e duplicati", vuoto: "Nessun errore e nessun duplicato." },
] as const;

export default async function Documenti({ searchParams }: { searchParams: Promise<{ filtro?: string; q?: string }> }) {
  const { filtro = "tutti", q } = await searchParams;
  const { supabase, attivo, permessi } = await sessioneSede();
  const cerca = q?.trim().replace(/[%,()]/g, " ");

  // Stessa definizione per elenco e conteggi, così i numeri sulle schede corrispondono alle righe.
  const base = (f: string, colonne: string, conta = false) => {
    let x = supabase.from("v_documenti").select(colonne, conta ? { count: "exact", head: true } : undefined).eq("ristorante_id", attivo.id);
    if (f === "rivedere") x = x.eq("stato", "completato").or("n_da_validare.gt.0,n_rincari_aperti.gt.0");
    if (f === "rincari") x = x.eq("stato", "completato").gt("n_anomalie", 0);
    if (f === "lavorazione") x = x.in("stato", ["in_coda", "elaborazione"]);
    if (f === "problemi") x = x.in("stato", ["errore", "duplicato"]);
    if (cerca) x = x.or(`numero.ilike.%${cerca}%,nome_file.ilike.%${cerca}%,ragione_sociale.ilike.%${cerca}%`);
    return x;
  };
  const [{ data: documenti, error }, ...conteggi] = await Promise.all([
    base(filtro, COLONNE_DOCUMENTO).order("created_at", { ascending: false }).limit(200).returns<DocumentoElenco[]>(),
    ...FILTRI.map((f) => base(f.chiave, "id", true)),
  ]);
  const inLavorazione = (documenti ?? []).some((d) => d.stato === "in_coda" || d.stato === "elaborazione");
  const corrente = FILTRI.find((f) => f.chiave === filtro) ?? FILTRI[0];

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
      <Intestazione titolo="Documenti" sottotitolo="Fatture, DDT e note di credito. Un documento elaborato resta «da rivedere» finché ha articoli da validare o rincari da gestire.">
        <form className="relative" role="search">
          {filtro !== "tutti" && <input type="hidden" name="filtro" value={filtro} />}
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
          <input name="q" defaultValue={q} placeholder="Numero, file o fornitore…" aria-label="Cerca documento" className="input w-60 pl-8" />
        </form>
        {permessi.caricare && <Link href="/carica" className="btn btn-primary"><Upload className="size-3.5" />Carica</Link>}
      </Intestazione>

      <Schede attiva={corrente.chiave} voci={FILTRI.map((f, i) => ({ chiave: f.chiave, etichetta: f.etichetta, href: parametri(f.chiave), conteggio: conteggi[i].count ?? 0 }))} />
      {error && <div className="mt-4"><Avviso>{error.message}</Avviso></div>}
      {(documenti?.length ?? 0) >= 200 && <p className="mt-3 text-xs text-subtle">Sono mostrati i 200 documenti più recenti: usa la ricerca per trovare i precedenti.</p>}
      <div className="card mt-4">
        <TabellaDocumenti documenti={documenti ?? []}
          vuoto={<Vuoto titolo={q ? "Nessun documento trovato" : "Niente in questa vista"}>{q ? <>Nessun risultato per «{q}» in «{corrente.etichetta}».</> : corrente.vuoto}</Vuoto>} />
      </div>
    </>
  );
}
