import type { Metadata } from "next";
import Link from "next/link";
import { sessioneModulo } from "@/lib/sessione";
import { data, dataOra, num, periodo } from "@/lib/format";
import { Badge, Intestazione, Kpi, Vuoto } from "@/components/ui";
import { StatoModulo } from "@/components/modulo-stato";
import { Azione, Espandi, Modulo } from "@/components/modulo";
import { ConfigScorecard, ConfrontoFornitori, ProponiOrdine } from "./moduli";

export const metadata: Metadata = { title: "Fornitori" };

type Riga = { fornitore_id: string; ragione_sociale: string; paese: string | null; n_consegne: number | null; n_puntualita: number | null; n_completezza: number | null; n_non_conformita: number; n_confronti: number; n_rincari: number; puntualita: number | null; completezza: number | null; conformita: number | null; prezzi: number | null; campione_sufficiente: boolean | null; punteggio: number | null };
type Scorecard = { config: { campione_minimo: number; pesi: Record<string, number> }; fornitori: Riga[] };
type Nc = { id: string; tipo: string; gravita: string; descrizione: string; stato: string; esito: string | null; aperta_il: string; fornitori: { ragione_sociale: string } | null };
type Ordine = { id: string; stato: string; righe: { articolo: string; quantita: number; unita: string; nota: string | null }[]; nota: string | null; creato_il: string; deciso_il: string | null; fornitori: { ragione_sociale: string } | null };
type Consegna = { id: string; giorno: string; puntuale: boolean | null; completa: boolean | null; temperatura_ricevimento: number | null; nota: string | null; fornitori: { ragione_sociale: string } | null };

const SI_NO = [{ valore: "true", etichetta: "Sì" }, { valore: "false", etichetta: "No" }];
const TIPI_NC = [["qualita", "Qualità"], ["quantita", "Quantità"], ["ritardo", "Ritardo"], ["temperatura", "Temperatura"], ["documenti", "Documenti"], ["reclamo", "Reclamo"], ["altro", "Altro"]].map(([valore, etichetta]) => ({ valore, etichetta }));

export default async function Fornitori() {
  const { supabase, attivo, piano, inclusa, scrivibile, operativo, titolare, ruolo } = await sessioneModulo("fornitori");
  const giorno = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date(ms));
  const oggi = giorno(Date.now()); const dal = giorno(Date.now() - 179 * 86400000);
  const [{ data: sc }, { data: nc }, { data: ordini }, { data: consegne }, { data: master }] = await Promise.all([
    supabase.rpc("scorecard_fornitori", { p_ristorante_id: attivo.id, p_dal: dal, p_al: oggi }),
    supabase.from("non_conformita").select("id,tipo,gravita,descrizione,stato,esito,aperta_il,fornitori(ragione_sociale)").eq("ristorante_id", attivo.id).order("aperta_il", { ascending: false }).limit(30).returns<Nc[]>(),
    supabase.from("ordini_proposti").select("id,stato,righe,nota,creato_il,deciso_il,fornitori(ragione_sociale)").eq("ristorante_id", attivo.id).order("creato_il", { ascending: false }).limit(20).returns<Ordine[]>(),
    supabase.from("consegne").select("id,giorno,puntuale,completa,temperatura_ricevimento,nota,fornitori(ragione_sociale)").eq("ristorante_id", attivo.id).order("giorno", { ascending: false }).limit(15).returns<Consegna[]>(),
    supabase.from("articoli_master").select("id,nome").eq("gruppo_id", attivo.gruppo_id).order("nome").returns<{ id: string; nome: string }[]>(),
  ]);
  const scorecard = sc as Scorecard | null;
  const righe = scorecard?.fornitori ?? [];
  const elenco = righe.map((r) => ({ id: r.fornitore_id, nome: r.ragione_sociale })).sort((a, b) => a.nome.localeCompare(b.nome, "it"));
  const opzFornitori = elenco.map((f) => ({ valore: f.id, etichetta: f.nome }));
  const aperte = (nc ?? []).filter((x) => x.stato === "aperta");
  const bozze = (ordini ?? []).filter((o) => o.stato === "bozza");
  const puoRegistrare = scrivibile && ruolo !== "sola_lettura";
  const ind = (v: number | null, n: string) => v != null ? <>{num(v, 1)}%<span className="block text-xs text-subtle">{n}</span></> : <span className="text-subtle">non rilevato</span>;
  const esitoBool = (v: boolean | null) => v == null ? <span className="text-subtle">non rilevato</span> : v ? "Sì" : <span className="text-warn">No</span>;

  return (
    <>
      <Intestazione titolo="Fornitori" sottotitolo={<>{attivo.nome} · valutazione sul periodo {periodo(dal, oggi)}</>} />
      <StatoModulo piano={piano} inclusa={inclusa} scrivibile={scrivibile} nome="Fornitori" />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi etichetta="Fornitori della sede" valore={righe.length} />
        <Kpi etichetta="Con punteggio" valore={righe.filter((r) => r.punteggio != null).length} nota={`Servono almeno ${scorecard?.config.campione_minimo ?? "—"} consegne registrate`} />
        <Kpi etichetta="Non conformità aperte" valore={aperte.length} tono={aperte.length ? "warn" : undefined} />
        <Kpi etichetta="Ordini da approvare" valore={bozze.length} tono={bozze.length ? "warn" : undefined} nota="Proposte interne, mai inviate" />
      </div>

      <section className="card overflow-x-auto" aria-labelledby="t-sc">
        <div className="px-4 pt-4"><h2 id="t-sc" className="text-[13px] font-medium">Valutazione dei fornitori</h2></div>
        {righe.length ? (
          <table className="mt-2 w-full min-w-[860px] text-[13px]">
            <thead><tr><th scope="col" className="th">Fornitore</th><th scope="col" className="th text-right">Punteggio</th><th scope="col" className="th text-right">Puntualità</th><th scope="col" className="th text-right">Completezza</th><th scope="col" className="th text-right">Conformità</th><th scope="col" className="th text-right">Stabilità prezzi</th></tr></thead>
            <tbody>{righe.map((r) => (
              <tr key={r.fornitore_id} className="riga align-top">
                <td className="td font-medium">{r.ragione_sociale}{r.paese && <span className="font-normal text-xs text-subtle"> · {r.paese}</span>}</td>
                <td className="td num text-right">{r.punteggio != null ? num(r.punteggio, 1) : <Badge>Dati insufficienti</Badge>}<span className="block text-xs text-subtle">{r.n_consegne ?? 0} consegne</span></td>
                <td className="td num text-right">{ind(r.puntualita, `su ${r.n_puntualita ?? 0} rilevate`)}</td>
                <td className="td num text-right">{ind(r.completezza, `su ${r.n_completezza ?? 0} rilevate`)}</td>
                <td className="td num text-right">{ind(r.conformita, `${r.n_non_conformita} non conformità`)}</td>
                <td className="td num text-right">{ind(r.prezzi, `${r.n_rincari} rincari su ${r.n_confronti} confronti`)}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Vuoto compatto titolo="Nessun fornitore">I fornitori compaiono dopo il primo documento approvato.</Vuoto>}
        <p className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-subtle">
          Puntualità e completezza = consegne segnate «sì» ÷ consegne in cui il dato è stato rilevato. Conformità = 100 − non conformità ÷ consegne. Stabilità prezzi = 100 − rincari ÷ confronti di prezzo. Punteggio = media pesata degli indicatori disponibili, con i pesi scelti dal titolare; non è un giudizio esterno né una certificazione.
        </p>
      </section>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <section className="card p-4" aria-labelledby="t-nc">
          <h2 id="t-nc" className="text-[13px] font-medium">Non conformità</h2>
          {(nc ?? []).length ? <ul className="mt-2 divide-y divide-line text-[13px]">{(nc ?? []).map((x) => (
            <li key={x.id} className="py-2">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{x.fornitori?.ragione_sociale ?? "Fornitore non indicato"}</span><Badge tono={x.gravita === "critica" ? "danger" : x.gravita === "maggiore" ? "warn" : "neutro"}>{x.gravita}</Badge><Badge>{TIPI_NC.find((t) => t.valore === x.tipo)?.etichetta}</Badge>{x.stato === "chiusa" && <Badge tono="ok">Chiusa</Badge>}<span className="text-xs text-subtle">{dataOra(x.aperta_il)}</span></div>
              <p className="mt-1 text-muted">{x.descrizione}</p>
              {x.esito && <p className="mt-1 text-xs text-subtle">Esito: {x.esito}</p>}
              {x.stato === "aperta" && operativo && <div className="mt-1.5"><Azione rpc="chiudi_non_conformita" parametri={{ p_id: x.id }} etichetta="Chiudi" motivo={{ parametro: "p_esito", domanda: "Come si è conclusa? (l'esito resta nel registro)" }} /></div>}
            </li>
          ))}</ul> : <p className="mt-2 text-xs text-muted">Nessuna non conformità registrata.</p>}
        </section>

        <section className="card p-4" aria-labelledby="t-ord">
          <h2 id="t-ord" className="text-[13px] font-medium">Ordini proposti</h2>
          {(ordini ?? []).length ? <ul className="mt-2 divide-y divide-line text-[13px]">{(ordini ?? []).map((o) => (
            <li key={o.id} className="py-2">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{o.fornitori?.ragione_sociale}</span><Badge tono={o.stato === "approvato" ? "ok" : o.stato === "bozza" ? "warn" : "neutro"}>{o.stato === "bozza" ? "Da approvare" : o.stato === "approvato" ? "Approvato · da inviare a mano" : "Annullato"}</Badge><span className="text-xs text-subtle">{dataOra(o.creato_il)}</span></div>
              <ul className="mt-1 text-muted">{o.righe.map((r, i) => <li key={i}><span className="num">{num(r.quantita, 3)} {r.unita}</span> · {r.articolo}{r.nota && <span className="text-xs text-subtle"> — {r.nota}</span>}</li>)}</ul>
              {o.nota && <p className="mt-1 text-xs text-subtle">{o.nota}</p>}
              {o.stato === "bozza" && scrivibile && <div className="mt-1.5 flex flex-wrap gap-2">
                {titolare && <Azione rpc="decidi_ordine" parametri={{ p_ordine_id: o.id, p_stato: "approvato" }} etichetta="Approva" stile="btn btn-sm btn-primary" conferma="Approvi la proposta? L'ordine non viene inviato: andrà comunicato al fornitore da te." />}
                {operativo && <Azione rpc="decidi_ordine" parametri={{ p_ordine_id: o.id, p_stato: "annullato" }} etichetta="Annulla" conferma="Annullare la proposta? Resta nel registro come annullata." />}
              </div>}
            </li>
          ))}</ul> : <p className="mt-2 text-xs text-muted">Nessuna proposta.</p>}
        </section>
      </div>

      <section className="card mt-3 p-4" aria-labelledby="t-cons">
        <h2 id="t-cons" className="text-[13px] font-medium">Ultime consegne registrate</h2>
        {(consegne ?? []).length ? (
          <div className="overflow-x-auto"><table className="mt-2 w-full min-w-[640px] text-[13px]">
            <thead><tr><th scope="col" className="th">Giorno</th><th scope="col" className="th">Fornitore</th><th scope="col" className="th">Puntuale</th><th scope="col" className="th">Completa</th><th scope="col" className="th text-right">Temperatura</th><th scope="col" className="th">Nota</th></tr></thead>
            <tbody>{(consegne ?? []).map((c) => (
              <tr key={c.id} className="riga"><td className="td num">{data(c.giorno)}</td><td className="td">{c.fornitori?.ragione_sociale}</td><td className="td">{esitoBool(c.puntuale)}</td><td className="td">{esitoBool(c.completa)}</td><td className="td num text-right">{c.temperatura_ricevimento != null ? `${num(c.temperatura_ricevimento, 1)} °C` : "—"}</td><td className="td text-xs text-muted">{c.nota}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <p className="mt-2 text-xs text-muted">Nessuna consegna registrata: senza consegne la valutazione non può essere calcolata.</p>}
      </section>

      <div className="mt-4 space-y-2">
        {puoRegistrare && opzFornitori.length > 0 && (
          <>
            <Espandi titolo="Registra una consegna">
              <Modulo rpc="registra_consegna" fissi={{ p_ristorante_id: "@sede" }} inDati="p_dati" compatto invio="Registra" fatto="Consegna registrata" campi={[
                { nome: "fornitore_id", etichetta: "Fornitore", tipo: "select", richiesto: true, opzioni: opzFornitori },
                { nome: "giorno", etichetta: "Giorno", tipo: "data", richiesto: true, iniziale: oggi },
                { nome: "puntuale", etichetta: "Puntuale", tipo: "select", opzioni: SI_NO, aiuto: "Vuoto = non rilevato" },
                { nome: "completa", etichetta: "Completa", tipo: "select", opzioni: SI_NO },
                { nome: "temperatura_ricevimento", etichetta: "Temperatura al ricevimento (°C)", tipo: "numero" },
                { nome: "nota", etichetta: "Nota", largo: true }]} />
            </Espandi>
            <Espandi titolo="Apri una non conformità">
              <Modulo rpc="apri_non_conformita" fissi={{ p_ristorante_id: "@sede" }} inDati="p_dati" invio="Apri" fatto="Non conformità aperta" campi={[
                { nome: "fornitore_id", etichetta: "Fornitore", tipo: "select", richiesto: true, opzioni: opzFornitori },
                { nome: "tipo", etichetta: "Tipo", tipo: "select", richiesto: true, opzioni: TIPI_NC },
                { nome: "gravita", etichetta: "Gravità", tipo: "select", richiesto: true, iniziale: "minore", opzioni: [{ valore: "minore", etichetta: "Minore" }, { valore: "maggiore", etichetta: "Maggiore" }, { valore: "critica", etichetta: "Critica" }] },
                { nome: "descrizione", etichetta: "Cosa è successo", tipo: "area", richiesto: true, largo: true }]} />
            </Espandi>
          </>
        )}
        {(master ?? []).length > 0 && <Espandi titolo="Confronta i fornitori su un articolo"><ConfrontoFornitori articoli={master ?? []} /></Espandi>}
        {operativo && elenco.length > 0 && <Espandi titolo="Proponi un ordine"><ProponiOrdine fornitori={elenco} articoli={master ?? []} /></Espandi>}
        {titolare && scorecard && <Espandi titolo="Criteri della valutazione"><ConfigScorecard config={scorecard.config} /></Espandi>}
        <p className="text-[11px] text-subtle">Vedi anche l&apos;andamento dei prezzi in <Link href="/anomalie" className="underline">Rincari</Link>.</p>
      </div>
    </>
  );
}
