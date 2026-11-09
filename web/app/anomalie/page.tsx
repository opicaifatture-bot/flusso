import Link from "next/link";
import { supabaseServer } from "@/lib/supabase";
import { money, data } from "@/lib/format";
import { Variazione } from "../components";

export const dynamic = "force-dynamic";

type A = {
  id: string; documento_id: string; prezzo_unitario: number; prezzo_precedente: number | null; variazione_pct: number | null;
  valuta: string; unita_misura: string | null; descrizione_normalizzata: string; ragione_sociale: string;
  numero: string | null; data_documento: string | null;
};

export default async function Anomalie() {
  const supabase = await supabaseServer();
  const { data: righe, error } = await supabase
    .from("v_anomalie")
    .select("id,documento_id,prezzo_unitario,prezzo_precedente,variazione_pct,valuta,unita_misura,descrizione_normalizzata,ragione_sociale,numero,data_documento")
    .order("variazione_pct", { ascending: false })
    .limit(300)
    .returns<A[]>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rincari anomali</h1>
        <p className="text-sm text-stone-500">Articoli con prezzo unitario aumentato oltre il 5% rispetto all&apos;ultimo acquisto dallo stesso fornitore</p>
      </div>
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error.message}</p>}
      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-3">Articolo</th><th className="px-4 py-3">Fornitore</th>
              <th className="px-4 py-3 text-right">Prima</th><th className="px-4 py-3 text-right">Ora</th>
              <th className="px-4 py-3">Variazione</th><th className="px-4 py-3">Documento</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {(righe ?? []).map((r) => (
              <tr key={r.id} className="hover:bg-stone-50">
                <td className="px-4 py-3 font-medium">{r.descrizione_normalizzata} <span className="text-xs text-stone-400">/{r.unita_misura}</span></td>
                <td className="px-4 py-3">{r.ragione_sociale}</td>
                <td className="px-4 py-3 text-right tabular-nums text-stone-500">{money(r.prezzo_precedente, r.valuta)}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(r.prezzo_unitario, r.valuta)}</td>
                <td className="px-4 py-3"><Variazione v={r.variazione_pct} anomalia /></td>
                <td className="px-4 py-3"><Link className="hover:underline" href={`/documenti/${r.documento_id}`}>{r.numero ?? "s.n."} · {data(r.data_documento)}</Link></td>
              </tr>
            ))}
            {!righe?.length && <tr><td colSpan={6} className="px-4 py-16 text-center text-stone-400">Nessun rincaro anomalo rilevato.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
