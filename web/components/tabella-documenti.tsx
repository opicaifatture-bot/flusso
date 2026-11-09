import Link from "next/link";
import { data, money } from "@/lib/format";
import type { Documento } from "@/lib/tipi";
import { Badge, Paese, StatoBadge, TipoBadge, Vuoto } from "./ui";

export const COLONNE_DOCUMENTO =
  "id,ristorante_id,tipo,numero,data_documento,totale,valuta,totale_eur,stato,fase,errore,n_anomalie,nome_file,created_at,corretto_manualmente,fornitori(ragione_sociale,paese)";

export function TabellaDocumenti({ documenti, vuoto }: { documenti: Documento[]; vuoto?: React.ReactNode }) {
  if (!documenti.length) return <>{vuoto ?? <Vuoto titolo="Nessun documento" />}</>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[13px]">
        <thead>
          <tr>
            <th className="th">Documento</th><th className="th">Fornitore</th><th className="th">Data</th>
            <th className="th text-right">Totale</th><th className="th">Prezzi</th><th className="th">Stato</th>
          </tr>
        </thead>
        <tbody>
          {documenti.map((d) => {
            const pronto = d.stato === "completato";
            return (
              <tr key={d.id} className="riga">
                <td className="td">
                  <Link href={`/documenti/${d.id}`} className="group block">
                    <span className="font-medium group-hover:underline">
                      {pronto || d.numero ? <>{d.tipo} <span className="num">{d.numero ?? "s.n."}</span></> : (d.nome_file ?? "Documento")}
                    </span>
                    {!pronto && d.errore && <span className="mt-0.5 block max-w-xs truncate text-xs text-subtle">{d.errore}</span>}
                  </Link>
                </td>
                <td className="td">
                  {d.fornitori
                    ? <span className="flex items-center gap-2"><span className="max-w-[220px] truncate">{d.fornitori.ragione_sociale}</span><Paese codice={d.fornitori.paese} /></span>
                    : <span className="text-subtle">—</span>}
                </td>
                <td className="td whitespace-nowrap text-muted">{data(d.data_documento ?? d.created_at)}</td>
                <td className="td num whitespace-nowrap text-right">{pronto ? money(d.totale, d.valuta) : <span className="text-subtle">—</span>}</td>
                <td className="td">
                  {!pronto ? <span className="text-subtle">—</span>
                    : d.n_anomalie > 0 ? <Badge tono="danger">{d.n_anomalie} {d.n_anomalie === 1 ? "rincaro" : "rincari"}</Badge>
                    : <span className="text-xs text-muted">Nella norma</span>}
                </td>
                <td className="td"><StatoBadge stato={d.stato} fase={d.fase} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
