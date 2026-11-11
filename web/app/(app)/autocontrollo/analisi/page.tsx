import type { Metadata } from "next";
import Link from "next/link";
import { contestoAutocontrollo } from "@/lib/contesto-autocontrollo";
import { data } from "@/lib/format";
import { CATEGORIE_CONTROLLO, ESITI, FREQUENZE } from "@/lib/autocontrollo";
import { Badge, Intestazione, Vuoto } from "@/components/ui";
import { StatoModulo } from "@/components/modulo-stato";
import { Espandi } from "@/components/modulo";
import { NavAutocontrollo } from "../navigazione";
import { Registra } from "../operatore";

export const metadata: Metadata = { title: "Piano analisi" };

type Controllo = { id: string; categoria: string; titolo: string; frequenza: string | null; parametri: string | null; gestione: string; fonte: string; differisce_da_manuale: boolean };
type Esito = { id: string; controllo_id: string; eseguita_il: string; esito: string; nota: string | null; dati: { laboratorio?: string; referto_id?: string; parametri_fuori?: string } };
type Scad = { riferimento_id: string; data_scadenza: string; stato: string };

export default async function Analisi() {
  const c = await contestoAutocontrollo();
  const { supabase, attivo, persone, pinObbligatorio, puoGestire } = c;
  const [{ data: controlli }, { data: esiti }, { data: referti }, { data: scad }] = await Promise.all([
    supabase.from("controlli").select("id,categoria,titolo,frequenza,parametri,gestione,fonte,differisce_da_manuale").eq("ristorante_id", attivo.id)
      .in("categoria", ["analisi_acqua", "analisi_alimenti"]).eq("attivo", true).order("titolo").returns<Controllo[]>(),
    supabase.from("registrazioni").select("id,controllo_id,eseguita_il,esito,nota,dati").eq("ristorante_id", attivo.id).eq("tipo", "analisi").order("eseguita_il", { ascending: false }).returns<Esito[]>(),
    supabase.from("archivio").select("id,titolo").eq("ristorante_id", attivo.id).eq("categoria", "referto_analisi").eq("archiviato", false).order("creato_il", { ascending: false }).returns<{ id: string; titolo: string }[]>(),
    supabase.from("v_scadenzario").select("riferimento_id,data_scadenza,stato").eq("ristorante_id", attivo.id).eq("origine", "controllo").returns<Scad[]>(),
  ]);
  const prossima = new Map((scad ?? []).map((s) => [s.riferimento_id, s]));
  const opReferti = (referti ?? []).map((r) => ({ valore: r.id, etichetta: r.titolo }));

  return (
    <>
      <Intestazione titolo="Piano analisi" sottotitolo={attivo.nome} />
      <StatoModulo piano={c.piano} inclusa={c.inclusa} scrivibile={c.scrivibile} nome="Autocontrollo" />
      <NavAutocontrollo attiva="analisi" />
      <p className="mb-4 max-w-3xl text-[13px] leading-relaxed text-muted">
        Analisi dell&apos;acqua (potabilità, compresi eventuali parametri aggiunti come i PFAS) e degli alimenti, con la cadenza del vostro piano.
        Parametri e frequenze si impostano nel <Link className="underline" href="/autocontrollo/piano">Piano HACCP</Link>, estraendoli dal piano analisi del consulente o a mano: l&apos;app non stabilisce parametri di legge.
        I referti si caricano in Documenti come «Referto di analisi» e si collegano qui all&apos;esito.
      </p>
      {controlli?.length ? <ul className="card divide-y divide-line">{controlli.map((x) => {
        const storico = (esiti ?? []).filter((e) => e.controllo_id === x.id); const p = prossima.get(x.id);
        return (
          <li key={x.id} className="p-4">
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="font-medium">{x.titolo}</span><Badge>{CATEGORIE_CONTROLLO[x.categoria]}</Badge>
              {x.frequenza && <span className="text-xs text-muted">{FREQUENZE[x.frequenza]}</span>}
              {x.fonte === "manuale" ? <Badge tono="ok">Dal piano del consulente</Badge> : <Badge>Impostato a mano</Badge>}
              {x.differisce_da_manuale && <Badge tono="warn">Diverso dal manuale</Badge>}
              {p && <Badge tono={p.stato === "scaduta" ? "danger" : p.stato === "in_scadenza" ? "warn" : "ok"}>prossima entro {data(p.data_scadenza)}</Badge>}
            </div>
            {x.parametri && <p className="mt-1 text-xs text-muted">Parametri: {x.parametri}</p>}
            {storico.length > 0 && <ul className="mt-2 space-y-1 text-xs">{storico.slice(0, 5).map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2"><span className="num">{data(e.eseguita_il)}</span><Badge tono={ESITI[e.esito]?.tono}>{ESITI[e.esito]?.etichetta}</Badge>
                <span className="text-muted">{e.dati.laboratorio}{e.dati.parametri_fuori ? ` · fuori limite: ${e.dati.parametri_fuori}` : ""}{e.nota ? ` · ${e.nota}` : ""}</span>
                {e.dati.referto_id && <span className="text-subtle">referto collegato</span>}</li>
            ))}</ul>}
            {puoGestire && <div className="mt-2"><Espandi titolo="Registra l'esito di un'analisi">
              <Registra sede={attivo.id} persone={persone} obbligatorio={pinObbligatorio} base={{ tipo: "analisi", controllo_id: x.id }} campi={[
                { nome: "eseguita_il", etichetta: "Data del prelievo", tipo: "data", richiesto: true },
                { nome: "laboratorio", etichetta: "Laboratorio", inDati: true },
                { nome: "referto_id", etichetta: "Referto (da Documenti)", tipo: "select", opzioni: opReferti, inDati: true },
                { nome: "esito", etichetta: "Esito", tipo: "select", richiesto: true, opzioni: [{ valore: "conforme", etichetta: "Conforme" }, { valore: "non_conforme", etichetta: "Non conforme" }, { valore: "da_valutare", etichetta: "Da valutare con il consulente" }] },
                { nome: "parametri_fuori", etichetta: "Parametri fuori limite", inDati: true }, { nome: "nota", etichetta: "Nota", tipo: "area" }]} />
            </Espandi></div>}
          </li>
        );
      })}</ul> : <Vuoto titolo="Nessuna analisi pianificata">Aggiungi nel Piano HACCP i controlli di tipo «Analisi dell&apos;acqua» o «Analisi degli alimenti», oppure fai leggere il piano analisi del consulente.</Vuoto>}
    </>
  );
}
