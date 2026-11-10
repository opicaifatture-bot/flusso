import type { Metadata } from "next";
import { sessioneModulo } from "@/lib/sessione";
import { data, dataOra, money, num } from "@/lib/format";
import { Badge, Intestazione, Kpi, Vuoto } from "@/components/ui";
import { StatoModulo } from "@/components/modulo-stato";
import { Espandi, Modulo } from "@/components/modulo";

export const metadata: Metadata = { title: "Manutenzione" };

type Attrezzatura = { id: string; nome: string; codice: string | null; marca_modello: string | null; matricola: string | null; posizione: string | null; garanzia_fino: string | null; documentazione: string | null; stato: string; contatore: number | null; contatore_unita: string | null };
type Scadenza = { id: string; attrezzatura_id: string; attrezzatura: string; titolo: string; obbligo: string; fonte: string | null; ogni_giorni: number | null; ogni_contatore: number | null; prossima_data: string | null; prossimo_contatore: number | null; giorni_mancanti: number | null; stato_scadenza: string; intervento_aperto: boolean; contatore: number | null; contatore_unita: string | null };
type Intervento = { id: string; attrezzatura_id: string; piano_id: string | null; tipo: string; stato: string; descrizione: string; aperto_il: string; indisponibile_dal: string | null; indisponibile_al: string | null; esito: string | null; costo: number | null; valuta: string | null; ricambi: string | null; eseguito_da: string | null; completato_il: string | null };

const OBBLIGHI: Record<string, { testo: string; tono: "danger" | "info" | "neutro" }> = {
  obbligatoria: { testo: "Obbligatoria", tono: "danger" }, raccomandata: { testo: "Raccomandata", tono: "info" }, interna: { testo: "Procedura interna", tono: "neutro" },
};
const STATI_ATT: Record<string, { testo: string; tono: "ok" | "danger" | "warn" | "neutro" }> = {
  operativa: { testo: "Operativa", tono: "ok" }, guasta: { testo: "Guasta", tono: "danger" }, fuori_servizio: { testo: "Fuori servizio", tono: "warn" }, dismessa: { testo: "Dismessa", tono: "neutro" },
};

export default async function Manutenzione() {
  const { supabase, attivo, piano, inclusa, scrivibile, operativo } = await sessioneModulo("manutenzione");
  const [{ data: att }, { data: scad }, { data: inter }] = await Promise.all([
    supabase.from("attrezzature").select("*").eq("ristorante_id", attivo.id).order("nome").returns<Attrezzatura[]>(),
    supabase.from("v_scadenze_manutenzione").select("*").eq("ristorante_id", attivo.id).order("prossima_data", { nullsFirst: false }).returns<Scadenza[]>(),
    supabase.from("interventi").select("*").eq("ristorante_id", attivo.id).order("aperto_il", { ascending: false }).limit(60).returns<Intervento[]>(),
  ]);
  const attrezzature = att ?? []; const scadenze = scad ?? []; const interventi = inter ?? [];
  const aperti = interventi.filter((i) => i.stato === "aperto" || i.stato === "in_corso");
  const nome = (id: string) => attrezzature.find((a) => a.id === id)?.nome ?? "—";
  const urgenti = scadenze.filter((s) => s.stato_scadenza === "scaduta" || s.stato_scadenza === "in_scadenza");
  const ferme = attrezzature.filter((a) => a.stato === "guasta" || a.stato === "fuori_servizio");
  const opzAtt = attrezzature.filter((a) => a.stato !== "dismessa").map((a) => ({ valore: a.id, etichetta: a.nome }));

  return (
    <>
      <Intestazione titolo="Attrezzature e manutenzione" sottotitolo={<>{attivo.nome} · scadenze calcolate a oggi (Europe/Rome)</>} />
      <StatoModulo piano={piano} inclusa={inclusa} scrivibile={scrivibile} nome="Attrezzature e manutenzione" />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi etichetta="Attrezzature" valore={attrezzature.filter((a) => a.stato !== "dismessa").length} nota={`${ferme.length} non disponibili`} tono={ferme.length ? "danger" : undefined} />
        <Kpi etichetta="Manutenzioni scadute" valore={scadenze.filter((s) => s.stato_scadenza === "scaduta").length} tono={scadenze.some((s) => s.stato_scadenza === "scaduta") ? "danger" : undefined} nota="A data o a contatore" />
        <Kpi etichetta="In scadenza entro 14 giorni" valore={scadenze.filter((s) => s.stato_scadenza === "in_scadenza").length} tono={scadenze.some((s) => s.stato_scadenza === "in_scadenza") ? "warn" : undefined} nota="Da pianificare prima del servizio" />
        <Kpi etichetta="Interventi aperti" valore={aperti.length} nota={`${aperti.filter((i) => i.tipo === "guasto").length} guasti`} />
      </div>

      <section className="card overflow-x-auto" aria-labelledby="t-scad">
        <div className="px-4 pt-4"><h2 id="t-scad" className="text-[13px] font-medium">Scadenze</h2></div>
        {scadenze.length ? (
          <table className="mt-2 w-full min-w-[760px] text-[13px]">
            <thead><tr><th scope="col" className="th">Manutenzione</th><th scope="col" className="th">Tipo e fonte</th><th scope="col" className="th">Cadenza</th><th scope="col" className="th">Prossima</th><th scope="col" className="th">Stato</th></tr></thead>
            <tbody>{scadenze.map((s) => (
              <tr key={s.id} className="riga">
                <td className="td"><span className="font-medium">{s.titolo}</span><span className="block text-xs text-subtle">{s.attrezzatura}</span></td>
                <td className="td"><Badge tono={OBBLIGHI[s.obbligo].tono}>{OBBLIGHI[s.obbligo].testo}</Badge><span className="mt-0.5 block text-xs text-subtle">{s.fonte ?? "fonte non indicata"}</span></td>
                <td className="td text-xs text-muted">{[s.ogni_giorni && `ogni ${s.ogni_giorni} giorni`, s.ogni_contatore && `ogni ${num(s.ogni_contatore, 0)} ${s.contatore_unita ?? "ore"}`].filter(Boolean).join(" · ") || "una tantum"}</td>
                <td className="td text-xs">{s.prossima_data ? <>{data(s.prossima_data)}{s.giorni_mancanti != null && <span className="text-subtle"> · {s.giorni_mancanti < 0 ? `${-s.giorni_mancanti} g fa` : `tra ${s.giorni_mancanti} g`}</span>}</> : "—"}
                  {s.prossimo_contatore != null && <span className="num block text-subtle">a {num(s.prossimo_contatore, 0)} {s.contatore_unita ?? "ore"} (ora {s.contatore != null ? num(s.contatore, 0) : "non rilevato"})</span>}</td>
                <td className="td">{s.stato_scadenza === "scaduta" ? <Badge tono="danger">Scaduta</Badge> : s.stato_scadenza === "in_scadenza" ? <Badge tono="warn">In scadenza</Badge> : s.stato_scadenza === "contatore_non_rilevato" ? <Badge tono="warn">Contatore non rilevato</Badge> : <Badge tono="ok">In regola</Badge>}
                  {s.intervento_aperto && <span className="mt-0.5 block text-xs text-subtle">intervento aperto</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Vuoto compatto titolo="Nessuna manutenzione pianificata">Aggiungi un&apos;attrezzatura e il suo piano di manutenzione.</Vuoto>}
        <p className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-subtle">
          «Obbligatoria» indica una scadenza che deriva da una norma o da un contratto, e richiede sempre la fonte: la inserisce chi la conosce, l&apos;app non la deduce e non verifica gli obblighi di legge.
          «Raccomandata» viene dal costruttore; «Procedura interna» è una scelta del ristorante. {urgenti.length > 0 && "Le scadenze urgenti non contattano nessuno: l'assistenza va chiamata da una persona."}
        </p>
      </section>

      <section className="mt-3 space-y-2" aria-labelledby="t-int">
        <h2 id="t-int" className="text-[13px] font-medium">Interventi aperti <span className="num text-subtle">· {aperti.length}</span></h2>
        {aperti.length ? aperti.map((i) => (
          <Espandi key={i.id} titolo={`${i.tipo === "guasto" ? "Guasto" : "Manutenzione"} · ${nome(i.attrezzatura_id)} · ${i.descrizione} · aperto il ${dataOra(i.aperto_il)}${i.indisponibile_dal ? " · attrezzatura ferma" : ""}`}>
            {operativo ? <Modulo rpc="chiudi_intervento" fissi={{ p_intervento_id: i.id }} inDati="p_dati" invio="Chiudi intervento" fatto="Intervento chiuso" campi={[
              { nome: "esito", etichetta: "Esito", tipo: "area", richiesto: true, largo: true }, { nome: "eseguito_da", etichetta: "Eseguito da" }, { nome: "ricambi", etichetta: "Ricambi" },
              { nome: "costo", etichetta: "Costo", tipo: "numero" }, { nome: "valuta", etichetta: "Valuta", tipo: "select", iniziale: "EUR", opzioni: ["EUR", "CHF"].map((v) => ({ valore: v, etichetta: v })) },
              { nome: "contatore", etichetta: "Contatore al termine", tipo: "numero", aiuto: "Ore o cicli, se l'attrezzatura li rileva" }]} />
              : <p className="text-xs text-muted">Solo titolare e chef possono chiudere un intervento.</p>}
          </Espandi>
        )) : <div className="card"><Vuoto compatto titolo="Nessun intervento aperto" /></div>}
      </section>

      <section className="card mt-3 overflow-x-auto" aria-labelledby="t-att">
        <div className="px-4 pt-4"><h2 id="t-att" className="text-[13px] font-medium">Attrezzature</h2></div>
        {attrezzature.length ? (
          <table className="mt-2 w-full min-w-[720px] text-[13px]">
            <thead><tr><th scope="col" className="th">Attrezzatura</th><th scope="col" className="th">Posizione</th><th scope="col" className="th">Garanzia</th><th scope="col" className="th">Contatore</th><th scope="col" className="th">Stato</th></tr></thead>
            <tbody>{attrezzature.map((a) => (
              <tr key={a.id} className="riga">
                <td className="td"><span className="font-medium">{a.nome}</span><span className="block text-xs text-subtle">{[a.codice, a.marca_modello, a.matricola && `matr. ${a.matricola}`].filter(Boolean).join(" · ") || "dati non inseriti"}</span>
                  {a.documentazione && <span className="block text-xs text-subtle">Documentazione: {a.documentazione}</span>}</td>
                <td className="td text-xs text-muted">{a.posizione ?? "—"}</td>
                <td className="td text-xs text-muted">{a.garanzia_fino ? `fino al ${data(a.garanzia_fino)}` : "non indicata"}</td>
                <td className="td num text-xs">{a.contatore != null ? `${num(a.contatore, 0)} ${a.contatore_unita ?? ""}` : "—"}</td>
                <td className="td"><Badge tono={STATI_ATT[a.stato].tono}>{STATI_ATT[a.stato].testo}</Badge></td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Vuoto compatto titolo="Nessuna attrezzatura registrata" />}
      </section>

      {operativo && (
        <div className="mt-4 space-y-2">
          <Espandi titolo="Segnala un guasto o apri un intervento">
            <Modulo rpc="apri_intervento" inDati="p_dati" invio="Apri" fatto="Intervento aperto" campi={[
              { nome: "p_attrezzatura_id", etichetta: "Attrezzatura", tipo: "select", richiesto: true, opzioni: opzAtt },
              { nome: "tipo", etichetta: "Tipo", tipo: "select", richiesto: true, iniziale: "guasto", opzioni: [{ valore: "guasto", etichetta: "Guasto" }, { valore: "manutenzione", etichetta: "Manutenzione" }] },
              { nome: "piano_id", etichetta: "Scadenza a cui si riferisce", tipo: "select", opzioni: scadenze.map((s) => ({ valore: s.id, etichetta: `${s.attrezzatura} · ${s.titolo}` })) },
              { nome: "indisponibile", etichetta: "L'attrezzatura è ferma", tipo: "check" }, { nome: "descrizione", etichetta: "Descrizione", tipo: "area", richiesto: true, largo: true }]} />
          </Espandi>
          <Espandi titolo="Aggiungi un'attrezzatura" aperto={!attrezzature.length}>
            <Modulo rpc="salva_attrezzatura" fissi={{ p_ristorante_id: "@sede" }} inDati="p_dati" invio="Aggiungi" campi={[
              { nome: "nome", etichetta: "Nome", richiesto: true }, { nome: "codice", etichetta: "Codice interno" }, { nome: "marca_modello", etichetta: "Marca e modello" }, { nome: "matricola", etichetta: "Matricola" },
              { nome: "posizione", etichetta: "Posizione" }, { nome: "garanzia_fino", etichetta: "Garanzia fino al", tipo: "data" },
              { nome: "contatore", etichetta: "Contatore attuale", tipo: "numero" }, { nome: "contatore_unita", etichetta: "Unità del contatore", tipo: "select", opzioni: [{ valore: "ore", etichetta: "ore" }, { valore: "cicli", etichetta: "cicli" }] },
              { nome: "documentazione", etichetta: "Dove si trova la documentazione", largo: true }]} />
          </Espandi>
          <Espandi titolo="Pianifica una manutenzione">
            <Modulo rpc="salva_piano_manutenzione" inDati="p_dati" invio="Pianifica" campi={[
              { nome: "p_attrezzatura_id", etichetta: "Attrezzatura", tipo: "select", richiesto: true, opzioni: opzAtt }, { nome: "titolo", etichetta: "Cosa va fatto", richiesto: true },
              { nome: "obbligo", etichetta: "Natura della scadenza", tipo: "select", richiesto: true, opzioni: Object.entries(OBBLIGHI).map(([v, o]) => ({ valore: v, etichetta: o.testo })) },
              { nome: "fonte", etichetta: "Fonte", aiuto: "Norma, contratto, manuale o procedura. Obbligatoria per le scadenze di legge." },
              { nome: "ogni_giorni", etichetta: "Ogni quanti giorni", tipo: "numero" }, { nome: "ogni_contatore", etichetta: "Oppure ogni quante ore o cicli", tipo: "numero" },
              { nome: "prossima_data", etichetta: "Prossima data", tipo: "data", aiuto: "Vuoto = calcolata da oggi" }]} />
          </Espandi>
        </div>
      )}

      {interventi.some((i) => i.stato === "completato") && (
        <div className="mt-4"><Espandi titolo="Storico degli interventi">
          <ul className="space-y-2 text-xs">{interventi.filter((i) => i.stato === "completato").slice(0, 25).map((i) => (
            <li key={i.id} className="text-muted"><span className="text-fg">{nome(i.attrezzatura_id)} · {i.descrizione}</span> · chiuso il {dataOra(i.completato_il)} · {i.esito}
              {i.costo != null && <> · <span className="num">{money(i.costo, i.valuta ?? "EUR")}</span></>}{i.ricambi && ` · ricambi: ${i.ricambi}`}{i.indisponibile_dal && i.indisponibile_al && ` · ferma dal ${dataOra(i.indisponibile_dal)} al ${dataOra(i.indisponibile_al)}`}</li>
          ))}</ul>
        </Espandi></div>
      )}
    </>
  );
}
