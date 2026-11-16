import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { sessioneSede } from "@/lib/sessione";
import { data, money, num } from "@/lib/format";
import type { DocumentoElenco } from "@/lib/tipi";
import { Kpi, Paese, Schede, Vuoto } from "@/components/ui";
import { COLONNE_DOCUMENTO, TabellaDocumenti } from "@/components/tabella-documenti";

export const metadata: Metadata = { title: "Fornitore" };

type Fornitore = { id: string; ragione_sociale: string; paese: string | null; partita_iva_o_estera: string | null; codice_identificativo_estero: string | null };
type Acquisto = { master_id: string | null; master_nome: string | null; descrizione: string | null; prezzo_netto: number | null; valuta: string; unita_misura: string | null;
  quantita: number | null; data_documento: string | null; totale_riga_eur: number | null };

/** Il contenitore di un fornitore: tutti i suoi documenti, la spesa per anno e gli articoli acquistati. */
export default async function Fornitore({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ anno?: string; vista?: string }> }) {
  const { id } = await params; const { anno, vista = "documenti" } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, attivo } = await sessioneSede();
  const { data: f } = await supabase.from("fornitori").select("id,ragione_sociale,paese,partita_iva_o_estera,codice_identificativo_estero").eq("id", id).maybeSingle<Fornitore>();
  if (!f) notFound();
  const [{ data: tutti }, { data: righe }] = await Promise.all([
    supabase.from("v_documenti").select(COLONNE_DOCUMENTO + ",fornitore_id").eq("ristorante_id", attivo.id).eq("fornitore_id", id)
      .order("data_documento", { ascending: false, nullsFirst: false }).limit(2000).returns<(DocumentoElenco & { fornitore_id: string })[]>(),
    vista === "articoli" ? supabase.from("v_righe").select("master_id,master_nome,descrizione,prezzo_netto,valuta,unita_misura,quantita,data_documento,totale_riga_eur")
      .eq("ristorante_id", attivo.id).eq("fornitore_id", id).eq("documento_stato", "completato").order("data_rilevazione", { ascending: false }).limit(3000).returns<Acquisto[]>()
      : Promise.resolve({ data: [] as Acquisto[] }),
  ]);
  const docs = tutti ?? [];
  const annoDi = (d: DocumentoElenco) => (d.data_documento ?? d.created_at).slice(0, 4);
  const anni = [...new Set(docs.map(annoDi))].sort().reverse();
  const visibili = anno ? docs.filter((d) => annoDi(d) === anno) : docs;
  const spesa = (lista: DocumentoElenco[]) => lista.filter((d) => d.stato === "completato")
    .reduce((s, d) => s + (d.tipo === "Nota di Credito" ? -1 : d.tipo === "Fattura" ? 1 : 0) * Number(d.totale_eur ?? 0), 0);
  const annoCorrente = new Date().getFullYear().toString();
  const ultimo = docs.find((d) => d.data_documento)?.data_documento;
  // Articoli: ultimo prezzo e quantità totale per articolo.
  const articoli = new Map<string, { nome: string; ultimo: Acquisto; volte: number; quantita: number; spesa: number }>();
  for (const r of righe ?? []) {
    const k = r.master_id ?? `d:${r.descrizione}`;
    const a = articoli.get(k) ?? { nome: r.master_nome ?? r.descrizione ?? "—", ultimo: r, volte: 0, quantita: 0, spesa: 0 };
    a.volte++; a.quantita += Number(r.quantita ?? 0); a.spesa += Number(r.totale_riga_eur ?? 0); articoli.set(k, a);
  }
  const url = (p: Record<string, string | undefined>) => {
    const s = new URLSearchParams(Object.entries({ anno, vista, ...p }).filter(([, v]) => v) as [string, string][]).toString();
    return `/documenti/fornitori/${id}${s ? `?${s}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link href="/documenti/fornitori" className="btn btn-ghost btn-sm px-1.5" aria-label="Torna ai fornitori"><ArrowLeft className="size-4" /></Link>
        <div><h1 className="text-lg font-semibold tracking-tight">{f.ragione_sociale}</h1>
          <p className="text-xs text-muted"><Paese codice={f.paese} />{f.partita_iva_o_estera ? ` · P. IVA ${f.partita_iva_o_estera}` : ""}{f.codice_identificativo_estero ? ` · ${f.codice_identificativo_estero}` : ""}</p></div>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi etichetta="Documenti" valore={docs.length} />
        <Kpi etichetta={`Spesa ${annoCorrente}`} valore={money(spesa(docs.filter((d) => annoDi(d) === annoCorrente)))} nota="Fatture meno note di credito" />
        <Kpi etichetta="Spesa totale" valore={money(spesa(docs))} />
        <Kpi etichetta="Ultimo documento" valore={ultimo ? data(ultimo) : "—"} />
      </div>
      <Schede attiva={vista} voci={[{ chiave: "documenti", etichetta: "Documenti", href: url({ vista: "documenti" }), conteggio: docs.length },
        { chiave: "articoli", etichetta: "Articoli acquistati", href: url({ vista: "articoli" }) }]} />
      {vista === "documenti" ? (
        <>
          {anni.length > 1 && <nav className="mt-3 flex flex-wrap gap-1.5" aria-label="Anno">
            <Link href={url({ anno: undefined })} aria-current={!anno ? "page" : undefined} className={`rounded-full border px-3 py-1 text-xs ${!anno ? "border-fg bg-fg text-bg" : "border-line"}`}>Tutti</Link>
            {anni.map((a) => <Link key={a} href={url({ anno: a })} aria-current={anno === a ? "page" : undefined} className={`rounded-full border px-3 py-1 text-xs ${anno === a ? "border-fg bg-fg text-bg" : "border-line"}`}>{a} · {money(spesa(docs.filter((d) => annoDi(d) === a)))}</Link>)}
          </nav>}
          <div className="card mt-3"><TabellaDocumenti documenti={visibili} vuoto={<Vuoto titolo="Nessun documento" />} /></div>
        </>
      ) : (
        <div className="card mt-3 overflow-x-auto">
          {articoli.size ? <table className="w-full min-w-[680px] text-[13px]">
            <thead><tr><th scope="col" className="th">Articolo</th><th scope="col" className="th text-right">Acquisti</th><th scope="col" className="th text-right">Quantità totale</th>
              <th scope="col" className="th text-right">Ultimo prezzo netto</th><th scope="col" className="th">Ultimo acquisto</th><th scope="col" className="th text-right">Spesa</th></tr></thead>
            <tbody>{[...articoli.values()].sort((a, b) => b.spesa - a.spesa).map((a) => (
              <tr key={a.nome + a.ultimo.data_documento} className="riga">
                <td className="td">{a.ultimo.master_id ? <Link className="hover:underline" href={`/catalogo/${a.ultimo.master_id}`}>{a.nome}</Link> : a.nome}</td>
                <td className="td num text-right">{a.volte}</td>
                <td className="td num text-right">{num(a.quantita, 2)} {a.ultimo.unita_misura}</td>
                <td className="td num text-right">{a.ultimo.prezzo_netto != null ? money(a.ultimo.prezzo_netto, a.ultimo.valuta) : "—"}</td>
                <td className="td text-muted">{data(a.ultimo.data_documento)}</td>
                <td className="td num text-right">{money(a.spesa)}</td>
              </tr>))}</tbody>
          </table> : <Vuoto compatto titolo="Nessun articolo">Gli articoli compaiono quando i documenti di questo fornitore sono elaborati.</Vuoto>}
        </div>
      )}
    </div>
  );
}
