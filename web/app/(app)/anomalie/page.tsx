import type { Metadata } from "next";
import Link from "next/link";
import { sessioneSede } from "@/lib/sessione";
import { data, money } from "@/lib/format";
import type { Riga } from "@/lib/tipi";
import { AnomaliaBadge, Avviso, Intestazione, Kpi, Paese, Schede, Variazione, Vuoto } from "@/components/ui";
import { AzioniAnomalia } from "@/components/azioni-anomalia";

export const metadata: Metadata = { title: "Rincari" };

const VISTE = [
  { chiave: "aperta", etichetta: "Da gestire" },
  { chiave: "contestata", etichetta: "Contestati" },
  { chiave: "accettata", etichetta: "Approvati" },
  { chiave: "tutti", etichetta: "Tutti" },
];

export default async function Anomalie({ searchParams }: { searchParams: Promise<{ stato?: string }> }) {
  const { stato = "aperta" } = await searchParams;
  const { supabase, attivo, permessi } = await sessioneSede();
  const { data: tutte, error } = await supabase.from("v_anomalie").select("*").eq("ristorante_id", attivo.id)
    .order("data_rilevazione", { ascending: false }).limit(400).returns<Riga[]>();

  const righe = tutte ?? [];
  const conta = (s: string) => righe.filter((r) => s === "tutti" || (r.anomalia_stato ?? "aperta") === s).length;
  const viste = righe.filter((r) => stato === "tutti" || (r.anomalia_stato ?? "aperta") === stato);
  const impatto = (s: string) => righe.filter((r) => (r.anomalia_stato ?? "aperta") === s).reduce((t, r) => t + Number(r.impatto_eur ?? 0), 0);

  return (
    <>
      <Intestazione titolo="Rincari"
        sottotitolo={<>Prezzi saliti oltre il <span className="num">{Number(attivo.soglia_anomalia_pct)}%</span> rispetto all&apos;acquisto precedente dallo stesso fornitore, a parità di unità e valuta.</>} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi etichetta="Da gestire" valore={conta("aperta")} tono={conta("aperta") ? "danger" : undefined} nota={<>Maggior costo <span className="num">{money(impatto("aperta"))}</span></>} />
        <Kpi etichetta="Contestati al fornitore" valore={conta("contestata")} tono={conta("contestata") ? "warn" : undefined} nota={<>In discussione <span className="num">{money(impatto("contestata"))}</span></>} />
        <Kpi etichetta="Approvati" valore={conta("accettata")} nota={<>Accettati <span className="num">{money(impatto("accettata"))}</span></>} />
      </div>

      <Schede attiva={stato} voci={VISTE.map((v) => ({ ...v, conteggio: conta(v.chiave), href: v.chiave === "aperta" ? "/anomalie" : `/anomalie?stato=${v.chiave}` }))} />
      {error && <div className="mt-4"><Avviso>{error.message}</Avviso></div>}

      <div className="card mt-4 overflow-x-auto">
        {viste.length ? (
          <table className="w-full min-w-[860px] text-[13px]">
            <thead>
              <tr>
                <th className="th">Articolo</th><th className="th">Fornitore</th><th className="th text-right">Prima → Ora</th>
                <th className="th text-right">Variazione</th><th className="th text-right">Maggior costo</th><th className="th">Stato</th><th className="th" />
              </tr>
            </thead>
            <tbody>
              {viste.map((r) => (
                <tr key={r.id} className="riga">
                  <td className="td">
                    <Link href={`/documenti/${r.documento_id}`} className="group block">
                      <span className="font-medium group-hover:underline">{r.master_nome ?? r.descrizione}</span>
                      <span className="mt-0.5 block text-xs text-subtle">{r.tipo} <span className="num">{r.numero ?? "s.n."}</span> · {data(r.data_documento)}</span>
                    </Link>
                    {r.anomalia_nota && <p className="mt-1 text-xs text-muted">«{r.anomalia_nota}»</p>}
                  </td>
                  <td className="td"><span className="flex items-center gap-2"><span className="max-w-[180px] truncate">{r.ragione_sociale}</span><Paese codice={r.paese} /></span></td>
                  <td className="td num whitespace-nowrap text-right text-muted">
                    {money(r.prezzo_precedente, r.valuta)} → <span className="text-fg">{money(r.prezzo_confronto, r.valuta)}</span><span className="text-subtle">/{r.unita_confronto}</span>
                  </td>
                  <td className="td text-right"><Variazione v={r.variazione_pct} anomalia /></td>
                  <td className="td num text-right text-danger">{r.impatto_eur != null ? `+${money(r.impatto_eur)}` : "—"}</td>
                  <td className="td"><AnomaliaBadge stato={r.anomalia_stato} /></td>
                  <td className="td"><AzioniAnomalia rigaId={r.id} stato={r.anomalia_stato} puoApprovare={permessi.approvareRincari} puoContestare={permessi.contestare} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Vuoto titolo={stato === "aperta" ? "Nessun rincaro da gestire" : "Nessun rincaro in questa vista"}>I prezzi vengono confrontati a ogni nuovo documento.</Vuoto>}
      </div>
    </>
  );
}
