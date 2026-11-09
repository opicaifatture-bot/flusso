import Link from "next/link";
import { supabaseServer } from "@/lib/supabase";
import { money, data, BANDIERE } from "@/lib/format";
import { BadgeAnomalia, BadgeTipo, Kpi } from "./components";

export const dynamic = "force-dynamic";

type Riga = {
  id: string; tipo: string; numero: string | null; data_documento: string | null;
  totale: number | null; valuta: string; n_anomalie: number; created_at: string;
  fornitori: { ragione_sociale: string; paese: string | null } | null;
};

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ filtro?: string; q?: string }> }) {
  const { filtro, q } = await searchParams;
  const supabase = await supabaseServer();
  let query = supabase
    .from("documenti")
    .select("id,tipo,numero,data_documento,totale,valuta,n_anomalie,created_at,fornitori(ragione_sociale,paese)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (filtro === "anomalie") query = query.gt("n_anomalie", 0);
  if (q) query = query.ilike("numero", `%${q}%`);
  const { data: docs, error } = await query.returns<Riga[]>();

  const [{ count: nDoc }, { count: nAnom }, { count: nForn }] = await Promise.all([
    supabase.from("documenti").select("*", { count: "exact", head: true }),
    supabase.from("storico_prezzi").select("*", { count: "exact", head: true }).eq("anomalia_prezzo", true),
    supabase.from("fornitori").select("*", { count: "exact", head: true }),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documenti acquisiti</h1>
          <p className="text-sm text-stone-500">Fatture, DDT e note di credito elaborate dall&apos;IA</p>
        </div>
        <Link href="/carica" className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800">+ Carica documento</Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Documenti" value={nDoc ?? 0} />
        <Kpi label="Rincari anomali (> +5%)" value={nAnom ?? 0} tone={nAnom ? "red" : undefined} />
        <Kpi label="Fornitori" value={nForn ?? 0} />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link href="/" className={`rounded-full px-3 py-1 ${filtro !== "anomalie" ? "bg-stone-900 text-white" : "bg-white ring-1 ring-stone-300"}`}>Tutti</Link>
        <Link href="/?filtro=anomalie" className={`rounded-full px-3 py-1 ${filtro === "anomalie" ? "bg-red-600 text-white" : "bg-white ring-1 ring-stone-300"}`}>Solo con anomalie</Link>
        <form className="ml-auto">
          {filtro && <input type="hidden" name="filtro" value={filtro} />}
          <input name="q" defaultValue={q} placeholder="Cerca numero documento…" className="rounded-md border border-stone-300 bg-white px-3 py-1.5" />
        </form>
      </div>

      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error.message}</p>}

      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-3">Data</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Numero</th>
              <th className="px-4 py-3">Fornitore</th><th className="px-4 py-3 text-right">Totale</th><th className="px-4 py-3">Prezzi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {(docs ?? []).map((d) => (
              <tr key={d.id} className={`hover:bg-stone-50 ${d.n_anomalie ? "bg-red-50/40" : ""}`}>
                <td className="whitespace-nowrap px-4 py-3 text-stone-600">{data(d.data_documento)}</td>
                <td className="px-4 py-3"><BadgeTipo tipo={d.tipo} /></td>
                <td className="px-4 py-3 font-medium"><Link href={`/documenti/${d.id}`} className="hover:underline">{d.numero ?? "s.n."}</Link></td>
                <td className="px-4 py-3">{BANDIERE[d.fornitori?.paese ?? ""] ?? ""} {d.fornitori?.ragione_sociale}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(d.totale, d.valuta)}</td>
                <td className="px-4 py-3"><BadgeAnomalia n={d.n_anomalie} /></td>
              </tr>
            ))}
            {!docs?.length && (
              <tr><td colSpan={6} className="px-4 py-16 text-center text-stone-400">Nessun documento. Caricane uno o invialo al webhook n8n.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
