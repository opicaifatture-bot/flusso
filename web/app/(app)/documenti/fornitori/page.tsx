import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { sessioneSede } from "@/lib/sessione";
import { data, money } from "@/lib/format";
import { Badge, Intestazione, Paese, Vuoto } from "@/components/ui";

export const metadata: Metadata = { title: "Documenti per fornitore" };

type Doc = { fornitore_id: string | null; tipo: string; stato: string; totale_eur: number | null; data_documento: string | null; created_at: string; n_rincari_aperti: number };
type Fornitore = { id: string; ragione_sociale: string; paese: string | null; partita_iva_o_estera: string | null };

/** Un "contenitore" per ogni fornitore: quanti documenti, quanto speso, ultimo acquisto. */
export default async function FornitoriDocumenti({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const { supabase, attivo } = await sessioneSede();
  const [{ data: fornitori }, { data: documenti }] = await Promise.all([
    supabase.from("fornitori").select("id,ragione_sociale,paese,partita_iva_o_estera,fornitori_ristorante!inner(ristorante_id)")
      .eq("fornitori_ristorante.ristorante_id", attivo.id).order("ragione_sociale").returns<Fornitore[]>(),
    supabase.from("v_documenti").select("fornitore_id,tipo,stato,totale_eur,data_documento,created_at,n_rincari_aperti")
      .eq("ristorante_id", attivo.id).limit(10000).returns<Doc[]>(),
  ]);
  const anno = new Date().getFullYear().toString();
  const riepilogo = new Map<string, { n: number; spesaAnno: number; spesaTot: number; ultimo: string | null; rincari: number; senzaCambio: boolean }>();
  for (const d of documenti ?? []) {
    if (!d.fornitore_id) continue;
    const r = riepilogo.get(d.fornitore_id) ?? { n: 0, spesaAnno: 0, spesaTot: 0, ultimo: null, rincari: 0, senzaCambio: false };
    r.n++;
    if (d.stato === "completato") {
      const segno = d.tipo === "Nota di Credito" ? -1 : d.tipo === "Fattura" ? 1 : 0;
      if (segno && d.totale_eur == null) r.senzaCambio = true;
      const v = segno * Number(d.totale_eur ?? 0);
      r.spesaTot += v; if ((d.data_documento ?? d.created_at).startsWith(anno)) r.spesaAnno += v;
    }
    const giorno = d.data_documento ?? d.created_at.slice(0, 10);
    if (!r.ultimo || giorno > r.ultimo) r.ultimo = giorno;
    r.rincari += d.n_rincari_aperti;
    riepilogo.set(d.fornitore_id, r);
  }
  const cerca = q?.trim().toLowerCase();
  const elenco = (fornitori ?? []).filter((f) => !cerca || f.ragione_sociale.toLowerCase().includes(cerca) || (f.partita_iva_o_estera ?? "").toLowerCase().includes(cerca))
    .map((f) => ({ ...f, r: riepilogo.get(f.id) })).sort((a, b) => (b.r?.spesaAnno ?? 0) - (a.r?.spesaAnno ?? 0));

  return (
    <>
      <Intestazione titolo="Documenti per fornitore" sottotitolo={<>{attivo.nome} · ogni fornitore raccoglie tutte le sue fatture, DDT e note di credito</>}>
        <form className="relative" role="search">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
          <input name="q" defaultValue={q} placeholder="Nome o partita IVA…" aria-label="Cerca fornitore" className="input w-56 pl-8" />
        </form>
        <Link href="/documenti" className="btn">Tutti i documenti</Link>
      </Intestazione>
      {elenco.length ? (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead><tr><th scope="col" className="th">Fornitore</th><th scope="col" className="th text-right">Documenti</th><th scope="col" className="th text-right">Spesa {anno}</th>
              <th scope="col" className="th text-right">Spesa totale</th><th scope="col" className="th">Ultimo documento</th><th scope="col" className="th"><span className="sr-only">Avvisi</span></th></tr></thead>
            <tbody>{elenco.map((f) => (
              <tr key={f.id} className="riga">
                <td className="td"><Link href={`/documenti/fornitori/${f.id}`} className="font-medium hover:underline">{f.ragione_sociale}</Link>
                  <span className="block text-xs text-subtle"><Paese codice={f.paese} />{f.partita_iva_o_estera ? ` · ${f.partita_iva_o_estera}` : ""}</span></td>
                <td className="td num text-right">{f.r?.n ?? 0}</td>
                <td className="td num text-right">{money(f.r?.spesaAnno ?? 0)}</td>
                <td className="td num text-right">{money(f.r?.spesaTot ?? 0)}</td>
                <td className="td text-muted">{f.r?.ultimo ? data(f.r.ultimo) : "—"}</td>
                <td className="td">{f.r?.rincari ? <Badge tono="danger">{f.r.rincari} rincari</Badge> : null}{f.r?.senzaCambio && <Badge tono="warn">importi senza cambio</Badge>}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="border-t border-line px-4 py-3 text-[11px] text-subtle">Spesa = fatture meno note di credito elaborate, in euro al cambio BCE della data del documento. I DDT non entrano nella spesa. Ordinati per spesa dell&apos;anno in corso.</p>
        </div>
      ) : <Vuoto titolo={q ? "Nessun fornitore trovato" : "Nessun fornitore"}>{q ? null : "I fornitori compaiono qui da soli quando l'IA legge il primo documento."}</Vuoto>}
    </>
  );
}
