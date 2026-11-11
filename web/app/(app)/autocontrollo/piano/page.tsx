import type { Metadata } from "next";
import { contestoAutocontrollo } from "@/lib/contesto-autocontrollo";
import { dataOra } from "@/lib/format";
import { CATEGORIE_ARCHIVIO, CATEGORIE_CONTROLLO, FREQUENZE } from "@/lib/autocontrollo";
import { Badge, Intestazione, Vuoto } from "@/components/ui";
import { StatoModulo } from "@/components/modulo-stato";
import { Azione, Espandi } from "@/components/modulo";
import { NavAutocontrollo } from "../navigazione";
import { AlberoDecisioni, ESITI_ALBERO, ETICHETTE_CAMPI, ModuloControllo, Proposta, PulsanteEstrazione } from "./moduli";

export const metadata: Metadata = { title: "Piano HACCP" };

type Versione = { id: string; versione: number; revisione: string | null; caricato_il: string; archivio: { titolo: string; categoria: string } | null;
  estrazioni: { stato: string; errore: string | null; n_proposte: number | null; avviata_il: string } | null };
type PropostaR = { id: string; categoria: string; titolo: string; dati: Record<string, unknown>; citazione: string | null; pagina: number | null; versione_id: string };
type Controllo = Record<string, unknown> & { id: string; categoria: string; titolo: string; fonte: string; differisce_da_manuale: boolean; nota_differenza: string | null;
  esito_albero: string | null; albero_deciso_il: string | null; attivo: boolean; frequenza: string | null; limite_testo: string | null; limite_min: number | null; limite_max: number | null; unita: string | null;
  proposte_estrazione: { citazione: string | null; pagina: number | null } | null };

const ESTRAIBILI = ["manuale_autocontrollo", "piano_analisi", "referto_analisi", "contratto_infestanti", "policy_igiene", "normativa"];

export default async function Piano() {
  const c = await contestoAutocontrollo();
  const { supabase, attivo, puoPianificare, puoGestire } = c;
  const [{ data: versioni }, { data: proposte }, { data: controlli }] = await Promise.all([
    supabase.from("archivio_versioni").select("id,versione,revisione,caricato_il,archivio!inner(titolo,categoria,archiviato),estrazioni(stato,errore,n_proposte,avviata_il)")
      .eq("ristorante_id", attivo.id).in("archivio.categoria", ESTRAIBILI).eq("archivio.archiviato", false).order("caricato_il", { ascending: false }).returns<Versione[]>(),
    supabase.from("proposte_estrazione").select("id,categoria,titolo,dati,citazione,pagina,versione_id").eq("ristorante_id", attivo.id).eq("stato", "in_attesa").order("creato_il").returns<PropostaR[]>(),
    supabase.from("controlli").select("*,proposte_estrazione!controlli_proposta_fk(citazione,pagina)").eq("ristorante_id", attivo.id).order("categoria").order("titolo").returns<Controllo[]>(),
  ]);
  const gruppi = Object.entries(CATEGORIE_CONTROLLO).map(([k, n]) => ({ k, n, voci: (controlli ?? []).filter((x) => x.categoria === k) })).filter((g) => g.voci.length);
  const titoloVersione = new Map((versioni ?? []).map((v) => [v.id, `${v.archivio?.titolo} v${v.versione}`]));

  return (
    <>
      <Intestazione titolo="Piano HACCP" sottotitolo={attivo.nome} />
      <StatoModulo piano={c.piano} inclusa={c.inclusa} scrivibile={c.scrivibile} nome="Autocontrollo" />
      <NavAutocontrollo attiva="piano" />

      <section className="card mb-4 p-4" aria-labelledby="t-estr">
        <h2 id="t-estr" className="text-[13px] font-medium">Lettura automatica dei documenti</h2>
        <p className="mt-1 text-xs text-muted">Il manuale, il piano analisi e gli altri documenti caricati in Documenti vengono letti e trasformati in proposte: CCP, pulizie, infestanti, analisi, abbattimento, conservazione. Ogni proposta mostra pagina e frase del documento; nulla viene applicato senza la tua scelta.</p>
        {versioni?.length ? (
          <ul className="mt-3 divide-y divide-line text-[13px]">{versioni.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="min-w-0 flex-1">{v.archivio?.titolo} <span className="text-xs text-subtle">v{v.versione}{v.revisione ? ` · ${v.revisione}` : ""} · {CATEGORIE_ARCHIVIO[v.archivio?.categoria ?? ""]}</span></span>
              {v.estrazioni?.stato === "completata" && <Badge tono="ok">Letto: {v.estrazioni.n_proposte} proposte</Badge>}
              {v.estrazioni?.stato === "in_corso" && <Badge tono="info" pulsa>Lettura in corso dal {dataOra(v.estrazioni.avviata_il)}</Badge>}
              {v.estrazioni?.stato === "errore" && <Badge tono="danger">Lettura non riuscita: {v.estrazioni.errore}</Badge>}
              {puoGestire && v.estrazioni?.stato !== "in_corso" && <PulsanteEstrazione versione={v.id} etichetta={v.estrazioni ? "Rileggi" : "Leggi e proponi"} />}
            </li>
          ))}</ul>
        ) : <p className="mt-3 text-xs text-warn">Carica il manuale di autocontrollo in Documenti per iniziare.</p>}
      </section>

      {proposte?.length ? (
        <section className="mb-4" aria-labelledby="t-prop">
          <h2 id="t-prop" className="eyebrow mb-2">Proposte da decidere ({proposte.length})</h2>
          <ul className="space-y-2">{proposte.map((p) => (
            <li key={p.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2"><span className="text-[13px] font-medium">{p.titolo}</span><Badge>{CATEGORIE_CONTROLLO[p.categoria]}</Badge>
                <span className="text-xs text-subtle">{titoloVersione.get(p.versione_id)}{p.pagina ? `, pagina ${p.pagina}` : ""}</span></div>
              {p.citazione && <blockquote className="mt-2 border-l-2 border-line pl-3 text-xs italic text-muted">«{p.citazione}»</blockquote>}
              <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">{Object.entries(p.dati).filter(([, v]) => v !== null && v !== "").map(([k, v]) => (
                <div key={k} className="flex gap-2"><dt className="text-subtle">{ETICHETTE_CAMPI[k] ?? k}:</dt><dd>{k === "frequenza" ? FREQUENZE[String(v)] ?? String(v) : String(v)}</dd></div>
              ))}</dl>
              {puoPianificare ? <Proposta id={p.id} categoria={p.categoria} dati={p.dati} /> : <p className="mt-2 text-xs text-subtle">La decisione spetta al titolare o al consulente.</p>}
            </li>
          ))}</ul>
        </section>
      ) : null}

      <section aria-labelledby="t-contr">
        <h2 id="t-contr" className="eyebrow mb-2">Controlli del piano</h2>
        {gruppi.length ? gruppi.map((g) => (
          <div key={g.k} className="mb-4">
            <h3 className="mb-1 text-xs font-medium text-muted">{g.n}</h3>
            <ul className="card divide-y divide-line">{g.voci.map((x) => (
              <li key={x.id} className={x.attivo ? "p-4" : "p-4 opacity-60"}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium">{x.titolo}</span>
                  {x.fonte === "manuale" ? <Badge tono="ok">Dal manuale</Badge> : <Badge>Impostato a mano</Badge>}
                  {x.differisce_da_manuale && <Badge tono="warn">Diverso dal manuale</Badge>}
                  {x.esito_albero && <Badge tono={x.esito_albero === "ccp" ? "danger" : "neutro"}>Albero: {ESITI_ALBERO[x.esito_albero]}</Badge>}
                  {!x.attivo && <Badge>Disattivato</Badge>}
                </div>
                <p className="mt-1 text-xs text-muted">
                  {[x.fase && `Fase: ${x.fase}`, x.pericolo && `Pericolo: ${x.pericolo}`, x.limite_testo ? `Limite: ${x.limite_testo}` : (x.limite_min != null || x.limite_max != null) && `Limite: ${x.limite_min ?? "—"}/${x.limite_max ?? "—"} ${x.unita ?? ""}`,
                    x.frequenza && FREQUENZE[x.frequenza], x.azione_correttiva && `Azione correttiva: ${x.azione_correttiva}`].filter(Boolean).join(" · ")}
                </p>
                {x.differisce_da_manuale && x.nota_differenza && <p className="mt-1 text-xs text-warn">Motivo della differenza: {x.nota_differenza}</p>}
                {x.proposte_estrazione?.citazione && <p className="mt-1 text-xs italic text-subtle">Il manuale dice{x.proposte_estrazione.pagina ? ` (p. ${x.proposte_estrazione.pagina})` : ""}: «{x.proposte_estrazione.citazione}»</p>}
                {puoPianificare && (
                  <div className="mt-3 space-y-2">
                    <Espandi titolo={x.esito_albero ? "Rivaluta con l'albero delle decisioni" : "Valuta con l'albero delle decisioni"}><AlberoDecisioni controllo={x.id} /></Espandi>
                    <Espandi titolo="Modifica"><ModuloControllo controllo={x} dalManuale={x.fonte === "manuale"} /></Espandi>
                    <Azione rpc="salva_controllo" parametri={{ p_ristorante_id: "@sede", p_controllo_id: x.id, p_dati: { attivo: !x.attivo } }} etichetta={x.attivo ? "Disattiva" : "Riattiva"} />
                  </div>
                )}
              </li>
            ))}</ul>
          </div>
        )) : <Vuoto titolo="Piano vuoto">Fai leggere il manuale oppure aggiungi i controlli a mano.</Vuoto>}
        {puoPianificare && <Espandi titolo="Aggiungi un controllo a mano"><ModuloControllo /></Espandi>}
      </section>
    </>
  );
}
