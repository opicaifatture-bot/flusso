import Link from "next/link";
import { data, money } from "@/lib/format";
import { revisione } from "@/lib/controlli";
import type { DocumentoElenco } from "@/lib/tipi";
import { Paese, RevisioneBadge, StatoBadge, Vuoto } from "./ui";

export const COLONNE_DOCUMENTO =
  "id,ristorante_id,tipo,numero,data_documento,totale,valuta,totale_eur,stato,fase,errore,n_anomalie,nome_file,created_at,ragione_sociale,paese,n_righe,n_da_validare,n_rincari_aperti";

/** Elenco documenti. "Elaborazione" dice a che punto è la lettura automatica, "Controllo" se serve ancora una persona. */
export function TabellaDocumenti({ documenti, vuoto }: { documenti: DocumentoElenco[]; vuoto?: React.ReactNode }) {
  if (!documenti.length) return <>{vuoto ?? <Vuoto titolo="Nessun documento" />}</>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[780px] text-[13px]">
        <caption className="sr-only">Documenti acquisiti, con stato di elaborazione e di controllo</caption>
        <thead>
          <tr>
            <th scope="col" className="th">Documento</th><th scope="col" className="th">Fornitore</th>
            <th scope="col" className="th">Data documento</th><th scope="col" className="th text-right">Totale</th>
            <th scope="col" className="th">Elaborazione</th><th scope="col" className="th">Controllo</th>
          </tr>
        </thead>
        <tbody>
          {documenti.map((d) => {
            const pronto = d.stato === "completato";
            const rev = revisione(d);
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
                  {d.ragione_sociale
                    ? <span className="flex items-center gap-2"><span className="max-w-[220px] truncate">{d.ragione_sociale}</span><Paese codice={d.paese} /></span>
                    : <span className="text-subtle">—</span>}
                </td>
                <td className="td whitespace-nowrap text-muted">
                  {d.data_documento ? data(d.data_documento) : <span className="text-subtle" title="Data di caricamento: il documento non ha ancora una data">{data(d.created_at)} · caricato</span>}
                </td>
                <td className="td num whitespace-nowrap text-right">{pronto ? money(d.totale, d.valuta) : <span className="text-subtle">—</span>}</td>
                <td className="td"><StatoBadge stato={d.stato} fase={d.fase} /></td>
                <td className="td">
                  {rev ? (
                    <span className="flex items-center gap-2">
                      <RevisioneBadge verificato={rev.verificato} dettaglio={rev.dettaglio} />
                      {!rev.verificato && <span className="hidden text-xs text-muted xl:inline">{rev.dettaglio}</span>}
                    </span>
                  ) : <span className="text-subtle">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
