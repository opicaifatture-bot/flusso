import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase";
import { money, num, data, BANDIERE } from "@/lib/format";
import { BadgeAnomalia, BadgeTipo, Variazione } from "../../components";

export const dynamic = "force-dynamic";

type Riga = {
  id: string; quantita: number | null; unita_misura: string | null; prezzo_unitario: number;
  sconto_percentuale: number | null; totale_riga: number | null; aliquota_iva: number | null; valuta: string;
  prezzo_precedente: number | null; variazione_pct: number | null; anomalia_prezzo: boolean;
  articoli: { codice_articolo: string | null; descrizione_originale: string | null; descrizione_normalizzata: string } | null;
};

export default async function Dettaglio({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: doc } = await supabase
    .from("documenti")
    .select("*, fornitori(*)")
    .eq("id", id)
    .maybeSingle();
  if (!doc) notFound();

  const { data: righe } = await supabase
    .from("storico_prezzi")
    .select("id,quantita,unita_misura,prezzo_unitario,sconto_percentuale,totale_riga,aliquota_iva,valuta,prezzo_precedente,variazione_pct,anomalia_prezzo,articoli(codice_articolo,descrizione_originale,descrizione_normalizzata)")
    .eq("documento_id", id)
    .order("anomalia_prezzo", { ascending: false })
    .returns<Riga[]>();

  let fileLink: string | null = null;
  if (doc.file_url) {
    const path = String(doc.file_url).replace(/^documenti\//, "");
    const { data: s } = await supabase.storage.from("documenti").createSignedUrl(path, 600);
    fileLink = s?.signedUrl ?? null;
  }
  const f = doc.fornitori;

  return (
    <div className="space-y-8">
      <Link href="/" className="text-sm text-stone-500 hover:text-stone-900">← Documenti</Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <BadgeTipo tipo={doc.tipo} />
            <BadgeAnomalia n={doc.n_anomalie} />
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{doc.tipo} n. {doc.numero ?? "s.n."}</h1>
          <p className="text-sm text-stone-500">del {data(doc.data_documento)} · acquisito il {data(doc.created_at)}</p>
        </div>
        {fileLink && (
          <a href={fileLink} target="_blank" className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm hover:bg-stone-100">Apri originale ↗</a>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-stone-200 bg-white p-5 text-sm">
          <p className="text-xs uppercase tracking-wide text-stone-500">Fornitore</p>
          <p className="mt-2 font-medium">{BANDIERE[f?.paese ?? ""] ?? ""} {f?.ragione_sociale}</p>
          <p className="text-stone-500">P.IVA / ID: {f?.partita_iva_o_estera ?? "—"}</p>
          {f?.codice_identificativo_estero && <p className="text-stone-500">SIRET/ID estero: {f.codice_identificativo_estero}</p>}
          <p className="text-stone-500">Paese: {f?.paese ?? "—"}</p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-5 text-sm">
          <p className="text-xs uppercase tracking-wide text-stone-500">Cliente</p>
          <p className="mt-2 font-medium">{doc.cliente_ragione_sociale ?? "—"}</p>
          <p className="text-stone-500">P.IVA: {doc.cliente_partita_iva ?? "—"}</p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-5 text-sm">
          <p className="text-xs uppercase tracking-wide text-stone-500">Totali ({doc.valuta})</p>
          <dl className="mt-2 space-y-1 tabular-nums">
            <div className="flex justify-between"><dt className="text-stone-500">Imponibile</dt><dd>{money(doc.imponibile, doc.valuta)}</dd></div>
            <div className="flex justify-between"><dt className="text-stone-500">IVA</dt><dd>{money(doc.iva, doc.valuta)}</dd></div>
            <div className="flex justify-between border-t border-stone-100 pt-1 font-semibold"><dt>Totale</dt><dd>{money(doc.totale, doc.valuta)}</dd></div>
          </dl>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-3">Articolo</th><th className="px-4 py-3 text-right">Q.tà</th>
              <th className="px-4 py-3 text-right">Prezzo unit.</th><th className="px-4 py-3 text-right">Precedente</th>
              <th className="px-4 py-3">Variazione</th><th className="px-4 py-3 text-right">Sconto</th>
              <th className="px-4 py-3 text-right">IVA</th><th className="px-4 py-3 text-right">Totale riga</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {(righe ?? []).map((r) => (
              <tr key={r.id} className={r.anomalia_prezzo ? "bg-red-50" : ""}>
                <td className="px-4 py-3">
                  <p className="font-medium">{r.articoli?.descrizione_normalizzata}</p>
                  {r.articoli?.descrizione_originale && r.articoli.descrizione_originale !== r.articoli.descrizione_normalizzata && (
                    <p className="text-xs italic text-stone-400">{r.articoli.descrizione_originale}</p>
                  )}
                  {r.articoli?.codice_articolo && <p className="text-xs text-stone-400">Cod. {r.articoli.codice_articolo}</p>}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{num(r.quantita, 3)} {r.unita_misura}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">{money(r.prezzo_unitario, r.valuta)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-stone-500">{money(r.prezzo_precedente, r.valuta)}</td>
                <td className="px-4 py-3"><Variazione v={r.variazione_pct} anomalia={r.anomalia_prezzo} /></td>
                <td className="px-4 py-3 text-right tabular-nums">{r.sconto_percentuale ? `${num(r.sconto_percentuale)}%` : "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{r.aliquota_iva !== null ? `${num(r.aliquota_iva)}%` : "—"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(r.totale_riga, r.valuta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="rounded-xl border border-stone-200 bg-white p-5 text-sm">
        <summary className="cursor-pointer font-medium">JSON estratto dall&apos;IA</summary>
        <pre className="mt-4 overflow-x-auto rounded-md bg-stone-900 p-4 text-xs text-stone-100">{JSON.stringify(doc.dati_estratti, null, 2)}</pre>
      </details>
    </div>
  );
}
