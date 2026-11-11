import type { Metadata } from "next";
import Link from "next/link";
import { contestoAutocontrollo } from "@/lib/contesto-autocontrollo";
import { data, dataOra } from "@/lib/format";
import { CATEGORIE_CONTROLLO, FREQUENZE, ESITI } from "@/lib/autocontrollo";
import { Badge, Intestazione, Vuoto } from "@/components/ui";
import { StatoModulo } from "@/components/modulo-stato";
import { Espandi } from "@/components/modulo";
import { NavAutocontrollo } from "../navigazione";
import { Registra, type CampoReg } from "../operatore";

export const metadata: Metadata = { title: "Controlli di oggi" };

type Controllo = { controllo_id: string; categoria: string; titolo: string; frequenza: string | null; limite_testo: string | null; limite_min: number | null; limite_max: number | null;
  unita: string | null; azione_correttiva: string | null; ultima_il: string | null; ultimo_esito: string | null; dovuto: boolean; giorni_ritardo: number | null };
type Prep = { id: string; eseguita_il: string; usare_entro: string | null; dati: { prodotto?: string; azione?: string; lotto?: string }; persone: { nome: string } | null };

const ESITO_SEMPLICE: CampoReg = { nome: "esito", etichetta: "Esito", tipo: "select", richiesto: true, iniziale: "conforme", opzioni: [{ valore: "conforme", etichetta: "Conforme" }, { valore: "non_conforme", etichetta: "Non conforme" }] };

export default async function Oggi() {
  const c = await contestoAutocontrollo();
  const { supabase, attivo, persone, pinObbligatorio, puoRegistrare, oggi } = c;
  const [{ data: controlli }, { data: preparazioni }, { data: fornitori }] = await Promise.all([
    supabase.rpc("controlli_oggi", { p_ristorante_id: attivo.id }),
    supabase.from("registrazioni").select("id,eseguita_il,usare_entro,dati,persone(nome)").eq("ristorante_id", attivo.id).eq("tipo", "preparazione")
      .gte("usare_entro", new Date(Date.now() - 86400000).toISOString().slice(0, 10)).order("usare_entro").returns<Prep[]>(),
    supabase.from("fornitori").select("id,ragione_sociale").eq("gruppo_id", attivo.gruppo_id).order("ragione_sociale").returns<{ id: string; ragione_sociale: string }[]>(),
  ]);
  const lista = (controlli ?? []) as Controllo[];
  const daFare = lista.filter((x) => x.dovuto);
  const altri = lista.filter((x) => !x.dovuto);
  const opFornitori = (fornitori ?? []).map((f) => ({ valore: f.ragione_sociale, etichetta: f.ragione_sociale }));
  const props = { sede: attivo.id, persone, obbligatorio: pinObbligatorio };

  const scheda = (x: Controllo) => (
    <li key={x.controllo_id} className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{x.titolo}</span>
        <Badge>{CATEGORIE_CONTROLLO[x.categoria] ?? x.categoria}</Badge>
        {x.frequenza && <span className="text-xs text-subtle">{FREQUENZE[x.frequenza]}</span>}
        {x.giorni_ritardo ? <Badge tono="danger">in ritardo di {x.giorni_ritardo} giorni</Badge> : null}
      </div>
      <p className="mt-1 text-xs text-muted">
        {x.limite_testo ? `Limite: ${x.limite_testo}` : x.limite_min != null || x.limite_max != null ? `Limite: ${x.limite_min ?? "—"} / ${x.limite_max ?? "—"} ${x.unita ?? ""}` : "Nessun limite numerico"}
        {x.ultima_il && <> · ultima registrazione {dataOra(x.ultima_il)} <Badge tono={ESITI[x.ultimo_esito ?? ""]?.tono}>{ESITI[x.ultimo_esito ?? ""]?.etichetta}</Badge></>}
      </p>
      {puoRegistrare && <div className="mt-3"><Registra {...props} compatto suggerimento={x.azione_correttiva}
        base={{ controllo_id: x.controllo_id, tipo: x.categoria === "prp_pulizia" ? "pulizia" : x.categoria === "abbattimento" ? "abbattimento" : "controllo" }}
        campi={x.limite_min != null || x.limite_max != null ? [{ nome: "valore", etichetta: `Valore misurato${x.unita ? ` (${x.unita})` : ""}`, tipo: "numero", richiesto: true }, { nome: "nota", etichetta: "Nota" }]
          : [ESITO_SEMPLICE, { nome: "nota", etichetta: "Nota" }]} /></div>}
    </li>
  );

  return (
    <>
      <Intestazione titolo="Controlli di oggi" sottotitolo={<>{attivo.nome} · {data(oggi)}</>} />
      <StatoModulo piano={c.piano} inclusa={c.inclusa} scrivibile={c.scrivibile} nome="Autocontrollo" />
      <NavAutocontrollo attiva="oggi" />
      {pinObbligatorio && !persone.length && <p className="mb-4 text-sm text-warn">Nessuna persona con PIN: chiedi al titolare di aggiungere il personale in «Persone e PIN».</p>}

      <section aria-labelledby="t-dafare" className="mb-5">
        <h2 id="t-dafare" className="eyebrow mb-2">Da fare ({daFare.length})</h2>
        {daFare.length ? <ul className="card divide-y divide-line">{daFare.map(scheda)}</ul>
          : <Vuoto compatto titolo={lista.length ? "Tutto fatto per oggi" : "Nessun controllo pianificato"}>{lista.length ? null : <>I controlli si creano nel <Link className="underline" href="/autocontrollo/piano">Piano HACCP</Link>, a mano o estraendoli dal manuale.</>}</Vuoto>}
      </section>

      <div className="mb-5 grid gap-3 lg:grid-cols-2">
        {puoRegistrare && <Espandi titolo="Preparazione o apertura di un prodotto" aperto>
          <Registra {...props} base={{ tipo: "preparazione" }} invio="Registra e stampa l'etichetta più tardi" campi={[
            { nome: "prodotto", etichetta: "Prodotto", richiesto: true, inDati: true },
            { nome: "azione", etichetta: "Cosa", tipo: "select", richiesto: true, inDati: true, iniziale: "preparato", opzioni: [{ valore: "preparato", etichetta: "Preparato" }, { valore: "aperto", etichetta: "Confezione aperta" }, { valore: "scongelato", etichetta: "Scongelato" }] },
            { nome: "usare_entro", etichetta: "Da usare entro", tipo: "data", richiesto: true, aiuto: "Secondo il manuale o l'etichetta del produttore" },
            { nome: "lotto", etichetta: "Lotto d'origine", inDati: true }]} />
        </Espandi>}
        {puoRegistrare && <Espandi titolo="Ricevimento merci">
          <Registra {...props} base={{ tipo: "ricevimento" }} campi={[
            { nome: "fornitore", etichetta: "Fornitore", tipo: opFornitori.length ? "select" : "testo", opzioni: opFornitori, richiesto: true, inDati: true },
            { nome: "documento", etichetta: "N. bolla / fattura", inDati: true },
            { nome: "valore", etichetta: "Temperatura al ricevimento (°C)", tipo: "numero" },
            ESITO_SEMPLICE,
            { nome: "trasporto_controllato", etichetta: "Trasporto a temperatura controllata", tipo: "check", inDati: true },
            { nome: "integro", etichetta: "Imballi integri ed etichette leggibili", tipo: "check", inDati: true },
            { nome: "foto_path", etichetta: "Foto della bolla o dell'etichetta", tipo: "foto" },
            { nome: "nota", etichetta: "Nota", tipo: "area" }]} />
        </Espandi>}
        {puoRegistrare && <Espandi titolo="Abbattimento (es. pesce da consumare crudo)">
          <Registra {...props} base={{ tipo: "abbattimento" }} campi={[
            { nome: "prodotto", etichetta: "Prodotto", richiesto: true, inDati: true }, { nome: "lotto", etichetta: "Lotto", inDati: true },
            { nome: "valore", etichetta: "Temperatura raggiunta (°C)", tipo: "numero", richiesto: true },
            { nome: "durata_ore", etichetta: "Durata (ore)", tipo: "numero", inDati: true },
            ESITO_SEMPLICE, { nome: "nota", etichetta: "Nota" }]} />
          <p className="mt-2 text-[11px] text-subtle">Temperatura e durata richieste vanno prese dal manuale: crea un controllo «Abbattimento» nel piano con i limiti del manuale per avere l&apos;esito automatico.</p>
        </Espandi>}
        {puoRegistrare && <Espandi titolo="Pulizia o altro controllo non pianificato">
          <Registra {...props} base={{}} campi={[
            { nome: "tipo", etichetta: "Tipo", tipo: "select", richiesto: true, iniziale: "pulizia", opzioni: [{ valore: "pulizia", etichetta: "Pulizia" }, { valore: "controllo", etichetta: "Controllo" }, { valore: "altro", etichetta: "Altro" }] },
            { nome: "area", etichetta: "Cosa / dove", richiesto: true, inDati: true }, ESITO_SEMPLICE, { nome: "nota", etichetta: "Nota" }]} />
        </Espandi>}
      </div>

      <section className="card mb-5 overflow-x-auto" aria-labelledby="t-prep">
        <div className="px-4 pt-4"><h2 id="t-prep" className="text-[13px] font-medium">Preparazioni e confezioni aperte in uso</h2></div>
        {preparazioni?.length ? (
          <table className="mt-2 w-full min-w-[560px] text-[13px]">
            <thead><tr><th scope="col" className="th">Prodotto</th><th scope="col" className="th">Quando</th><th scope="col" className="th">Usare entro</th><th scope="col" className="th">Chi</th><th scope="col" className="th"><span className="sr-only">Etichetta</span></th></tr></thead>
            <tbody>{preparazioni.map((p) => (
              <tr key={p.id} className="riga">
                <td className="td">{p.dati.prodotto} <span className="text-xs text-subtle">{p.dati.azione}</span></td>
                <td className="td text-xs text-muted">{dataOra(p.eseguita_il)}</td>
                <td className="td">{p.usare_entro && <Badge tono={p.usare_entro < oggi ? "danger" : p.usare_entro === oggi ? "warn" : "neutro"}>{data(p.usare_entro)}</Badge>}</td>
                <td className="td text-xs text-muted">{p.persone?.nome ?? "—"}</td>
                <td className="td text-right"><Link className="btn btn-sm" href={`/autocontrollo/etichetta/${p.id}`}>Etichetta</Link></td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Vuoto compatto titolo="Niente in uso">Le preparazioni registrate compaiono qui fino al giorno dopo la data d&apos;uso.</Vuoto>}
      </section>

      {altri.length > 0 && <section aria-labelledby="t-altri"><h2 id="t-altri" className="eyebrow mb-2">Già fatti o al bisogno</h2><ul className="card divide-y divide-line">{altri.map(scheda)}</ul></section>}
      <p className="mt-3 text-[11px] text-subtle">Per i decimali puoi usare la virgola o il punto. Ogni registrazione è firmata e non si cancella; un errore si corregge con una rettifica dal Registro.</p>
    </>
  );
}
