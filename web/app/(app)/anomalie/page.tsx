import type { Metadata } from "next";
import Link from "next/link";
import { sessioneSede } from "@/lib/sessione";
import { data, dataOra, money, num } from "@/lib/format";
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
  // Il maggior costo si somma solo in EUR; gli importi senza cambio restano nella loro valuta.
  const impatto = (s: string) => {
    const gruppo = righe.filter((r) => (r.anomalia_stato ?? "aperta") === s);
    const eur = gruppo.filter((r) => r.impatto_eur != null).reduce((t, r) => t + Number(r.impatto_eur), 0);
    const altri = new Map<string, number>();
    for (const r of gruppo.filter((x) => x.impatto_eur == null && x.impatto != null)) altri.set(r.valuta, (altri.get(r.valuta) ?? 0) + Number(r.impatto));
    return <>{money(eur)}{[...altri.entries()].map(([v, t]) => <span key={v}> + {money(t, v)}</span>)}</>;
  };

  return (
    <>
      <Intestazione titolo="Rincari"
        sottotitolo={<>Prezzi netti saliti oltre il <span className="num">{Number(attivo.soglia_anomalia_pct)}%</span>{Number(attivo.soglia_anomalia_min_eur) > 0 && <> e di almeno <span className="num">{money(attivo.soglia_anomalia_min_eur)}</span> sulla riga</>} rispetto all&apos;acquisto precedente dallo stesso fornitore, a parità di unità e valuta.</>} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi etichetta="Da gestire" valore={conta("aperta")} tono={conta("aperta") ? "danger" : undefined} nota={<>Maggior costo <span className="num">{impatto("aperta")}</span></>} />
        <Kpi etichetta="Contestati al fornitore" valore={conta("contestata")} tono={conta("contestata") ? "warn" : undefined} nota={<>In discussione <span className="num">{impatto("contestata")}</span></>} />
        <Kpi etichetta="Approvati" valore={conta("accettata")} nota={<>Accettati <span className="num">{impatto("accettata")}</span></>} />
      </div>

      <Schede attiva={stato} voci={VISTE.map((v) => ({ ...v, conteggio: conta(v.chiave), href: v.chiave === "aperta" ? "/anomalie" : `/anomalie?stato=${v.chiave}` }))} />
      {error && <div className="mt-4"><Avviso>{error.message}</Avviso></div>}

      <div className="card mt-4 overflow-x-auto">
        {viste.length ? (
          <table className="w-full min-w-[860px] text-[13px]">
            <thead>
              <tr>
                <th scope="col" className="th">Articolo e documento</th><th scope="col" className="th">Fornitore</th><th scope="col" className="th text-right">Prezzo precedente → nuovo</th>
                <th scope="col" className="th text-right">Variazione</th><th scope="col" className="th text-right">Maggior costo</th><th scope="col" className="th">Stato</th><th className="th"><span className="sr-only">Azioni</span></th>
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
                  <td className="td whitespace-nowrap text-right">
                    <span className="num text-muted">{money(r.prezzo_precedente, r.valuta)} → <span className="text-fg">{money(r.prezzo_confronto, r.valuta)}</span><span className="text-subtle">/{r.unita_confronto}</span></span>
                    <span className="mt-0.5 block text-xs text-subtle">
                      {r.prec_documento_id
                        ? <>prima: <Link href={`/documenti/${r.prec_documento_id}`} className="underline hover:text-fg">{r.prec_numero ?? "s.n."} del {data(r.prec_data)}</Link>, <span className="num">{num(r.prec_quantita, 3)} {r.prec_unita_misura}</span></>
                        : "acquisto precedente"}
                      {" · "}ora <span className="num">{num(r.quantita, 3)} {r.unita_misura}</span>
                    </span>
                  </td>
                  <td className="td text-right">
                    <Variazione v={r.variazione_pct} anomalia />
                    {r.variazione_assoluta != null && <span className="num mt-0.5 block text-xs text-subtle">+{money(r.variazione_assoluta, r.valuta)}/{r.unita_confronto}</span>}
                  </td>
                  <td className="td num text-right text-danger">
                    {r.impatto != null ? `+${money(r.impatto, r.valuta)}` : "—"}
                    {r.valuta !== "EUR" && <span className="mt-0.5 block text-xs text-subtle">{r.impatto_eur != null ? `≈ ${money(r.impatto_eur)}` : "cambio non disponibile"}</span>}
                  </td>
                  <td className="td">
                    <AnomaliaBadge stato={r.anomalia_stato} />
                    {r.anomalia_stato !== "aperta" && r.anomalia_gestita_il && <span className="mt-0.5 block whitespace-nowrap text-xs text-subtle">il {dataOra(r.anomalia_gestita_il)}</span>}
                  </td>
                  <td className="td"><AzioniAnomalia rigaId={r.id} stato={r.anomalia_stato} puoApprovare={permessi.approvareRincari} puoContestare={permessi.contestare} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Vuoto titolo={stato === "aperta" ? "Nessun rincaro da gestire" : "Nessun rincaro in questa vista"}>Un rincaro compare dal secondo acquisto dello stesso articolo dallo stesso fornitore, se il prezzo supera la soglia.</Vuoto>}
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-2 text-xs text-muted sm:grid-cols-3">
        <div><dt className="font-medium text-fg">Da gestire</dt><dd>Rincaro rilevato, nessuna decisione. Il titolare lo approva; chef e contabile possono contestarlo.</dd></div>
        <div><dt className="font-medium text-fg">Contestato</dt><dd>Segnalato al fornitore, con il motivo. Resta nel conteggio del maggior costo finché non viene chiuso.</dd></div>
        <div><dt className="font-medium text-fg">Approvato</dt><dd>Il titolare accetta il nuovo prezzo: diventa il riferimento per i confronti successivi, come ogni acquisto.</dd></div>
      </dl>
      <p className="mt-3 text-xs text-subtle">
        Non generano avvisi: il primo acquisto di un articolo, le righe in unità non convertibile (manca peso o contenuto), gli acquisti in valuta diversa dal precedente e le note di credito. Il motivo è indicato riga per riga nel dettaglio del documento. Ogni decisione è registrata nell&apos;audit e compare nella cronologia del documento.
      </p>
    </>
  );
}
