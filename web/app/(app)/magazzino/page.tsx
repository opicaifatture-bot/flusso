import type { Metadata } from "next";
import Link from "next/link";
import { sessioneModulo } from "@/lib/sessione";
import { data, dataOra, num } from "@/lib/format";
import { Badge, Intestazione, Kpi, Schede, Vuoto } from "@/components/ui";
import { StatoModulo } from "@/components/modulo-stato";
import { Azione, Espandi, Modulo } from "@/components/modulo";
import { AzioniLotto, CostoStorico, LinkDocumento, Scadenza, StatoLotto, type Giacenza } from "@/components/lotti";
import { SuggerisciPrelievo } from "@/components/lotti-azioni";

export const metadata: Metadata = { title: "Magazzino" };

type Movimento = { id: string; lotto_id: string; tipo: string; quantita: number; unita: string; motivo: string | null; creato_il: string; storna_movimento_id: string | null; lotti: { codice_lotto: string | null; articoli_master: { nome: string } | null } | null };
type DaRicevere = { id: string; descrizione: string | null; master_id: string; master_nome: string; quantita: number | null; unita_misura: string | null; numero: string | null; data_documento: string | null; ragione_sociale: string; documento_id: string };
const TIPI_MOV: Record<string, string> = { ricevimento: "Ricevimento", consumo: "Consumo", scarto: "Scarto", reso: "Reso", rottura: "Rottura", omaggio: "Omaggio", apertura: "Apertura", vendita: "Vendita", rettifica: "Rettifica", trasferimento_uscita: "Trasferimento (uscita)", trasferimento_entrata: "Trasferimento (entrata)", storno: "Storno" };

export default async function Magazzino({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  const { vista = "giacenze" } = await searchParams;
  const { supabase, attivo, piano, inclusa, scrivibile, operativo } = await sessioneModulo("magazzino");
  const [{ data: tutte }, { data: ubicazioni }, { data: master }, { data: movimenti }, { data: righe }] = await Promise.all([
    supabase.from("v_giacenze").select("*").eq("ristorante_id", attivo.id).eq("tipo", "alimentare").order("scadenza", { nullsFirst: false }).order("ricevuto_il").limit(500).returns<Giacenza[]>(),
    supabase.from("ubicazioni").select("id,nome,tipo").eq("ristorante_id", attivo.id).eq("attiva", true).order("nome").returns<{ id: string; nome: string; tipo: string }[]>(),
    supabase.from("articoli_master").select("id,nome,unita_base").eq("gruppo_id", attivo.gruppo_id).order("nome").returns<{ id: string; nome: string; unita_base: string }[]>(),
    vista === "movimenti" ? supabase.from("movimenti").select("id,lotto_id,tipo,quantita,unita,motivo,creato_il,storna_movimento_id,lotti(codice_lotto,articoli_master(nome))").eq("ristorante_id", attivo.id).order("creato_il", { ascending: false }).limit(80).returns<Movimento[]>() : Promise.resolve({ data: [] as Movimento[] }),
    vista === "ricevere" ? supabase.from("v_righe").select("id,descrizione,master_id,master_nome,quantita,unita_misura,numero,data_documento,ragione_sociale,documento_id").eq("ristorante_id", attivo.id).eq("documento_stato", "completato").not("master_id", "is", null).order("data_rilevazione", { ascending: false }).limit(100).returns<DaRicevere[]>() : Promise.resolve({ data: [] as DaRicevere[] }),
  ]);
  const giacenze = (tutte ?? []).filter((g) => Number(g.quantita_residua) > 0);
  const inScadenza = giacenze.filter((g) => g.giorni_alla_scadenza != null && g.giorni_alla_scadenza <= 3 && g.stato === "attivo");
  const scaduti = giacenze.filter((g) => g.giorni_alla_scadenza != null && g.giorni_alla_scadenza < 0);
  const giaRicevute = new Set((tutte ?? []).map((g) => (g as unknown as { riga_id: string | null }).riga_id).filter(Boolean));
  const daRicevere = (righe ?? []).filter((r) => !giaRicevute.has(r.id));
  const stornati = new Set((movimenti ?? []).map((m) => m.storna_movimento_id).filter(Boolean));
  const opzUb = (ubicazioni ?? []).map((u) => ({ valore: u.id, etichetta: `${u.nome} (${u.tipo})` }));
  const elenco = vista === "scadenza" ? inScadenza : giacenze;

  return (
    <>
      <Intestazione titolo="Magazzino" sottotitolo={<>{attivo.nome} · giacenze calcolate dal registro dei movimenti · date Europe/Rome</>} />
      <StatoModulo piano={piano} inclusa={inclusa} scrivibile={scrivibile} nome="Magazzino e lotti" />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi etichetta="Lotti con giacenza" valore={giacenze.length} nota={`${new Set(giacenze.map((g) => g.master_id)).size} articoli`} />
        <Kpi etichetta="In scadenza entro 3 giorni" valore={inScadenza.length - scaduti.filter((g) => g.stato === "attivo").length} tono={inScadenza.length ? "warn" : undefined} href="/magazzino?vista=scadenza" nota="Da usare per primi (FEFO)" />
        <Kpi etichetta="Scaduti in giacenza" valore={scaduti.length} tono={scaduti.length ? "danger" : undefined} nota={scaduti.length ? "Da scartare con motivo" : "Nessuno"} />
        <Kpi etichetta="Bloccati o richiamati" valore={giacenze.filter((g) => g.stato !== "attivo").length} nota="Non utilizzabili" />
      </div>

      <Schede attiva={vista} voci={[
        { chiave: "giacenze", etichetta: "Giacenze", href: "/magazzino", conteggio: giacenze.length },
        { chiave: "scadenza", etichetta: "In scadenza", href: "/magazzino?vista=scadenza", conteggio: inScadenza.length },
        { chiave: "ricevere", etichetta: "Da ricevere", href: "/magazzino?vista=ricevere" },
        { chiave: "movimenti", etichetta: "Movimenti", href: "/magazzino?vista=movimenti" },
      ]} />

      {(vista === "giacenze" || vista === "scadenza") && (
        <div className="card mt-4 overflow-x-auto">
          {elenco.length ? (
            <table className="w-full min-w-[860px] text-[13px]">
              <caption className="sr-only">Lotti in giacenza, ordinati per scadenza</caption>
              <thead><tr><th scope="col" className="th">Articolo e lotto</th><th scope="col" className="th">Ubicazione</th><th scope="col" className="th">Scadenza</th><th scope="col" className="th text-right">Giacenza</th><th scope="col" className="th text-right">Costo d&apos;acquisto</th><th className="th"><span className="sr-only">Azioni</span></th></tr></thead>
              <tbody>{elenco.map((g) => (
                <tr key={g.id} className="riga">
                  <td className="td"><Link href={`/catalogo/${g.master_id}`} className="font-medium hover:underline">{g.master_nome}</Link><StatoLotto g={g} />
                    <span className="block text-xs text-subtle">lotto {g.codice_lotto ?? "senza codice"} · ricevuto il {data(g.ricevuto_il)}{g.fornitore ? ` · ${g.fornitore}` : ""} · <LinkDocumento g={g} /></span></td>
                  <td className="td text-xs text-muted">{g.ubicazione_nome ?? "non indicata"}</td>
                  <td className="td"><Scadenza g={g} /></td>
                  <td className="td num whitespace-nowrap text-right">{num(g.quantita_residua, 3)} {g.unita}<span className="block text-xs text-subtle">di {num(g.quantita_iniziale, 3)}</span></td>
                  <td className="td text-right"><CostoStorico g={g} /></td>
                  <td className="td">{operativo && <AzioniLotto g={g} />}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <Vuoto titolo={vista === "scadenza" ? "Nessun lotto in scadenza nei prossimi 3 giorni" : "Nessun lotto in giacenza"}>{vista === "giacenze" && <>Ricevi la merce da un documento in <Link href="/magazzino?vista=ricevere" className="text-fg underline">Da ricevere</Link>, oppure aggiungi un lotto a mano qui sotto.</>}</Vuoto>}
        </div>
      )}

      {vista === "ricevere" && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-muted">Righe dei documenti già abbinate al catalogo e non ancora ricevute a magazzino. Ricevendo si crea un lotto con quantità, costo e valuta della riga; la stessa riga non può essere ricevuta due volte.</p>
          {daRicevere.length ? daRicevere.map((r) => (
            <Espandi key={r.id} titolo={`${r.master_nome} · ${num(r.quantita, 3)} ${r.unita_misura ?? ""} · ${r.ragione_sociale} · ${r.numero ?? "s.n."} del ${data(r.data_documento)}`}>
              {operativo ? <Modulo rpc="ricevi_lotto" fissi={{ p_ristorante_id: "@sede" }} inDati="p_dati" compatto invio="Ricevi a magazzino" fatto="Lotto creato"
                datiFissi={{ riga_id: r.id }}
                campi={[{ nome: "ubicazione_id", etichetta: "Ubicazione", tipo: "select", opzioni: opzUb }, { nome: "scadenza", etichetta: "Scadenza", tipo: "data" }, { nome: "codice_lotto", etichetta: "Codice lotto" }]} />
                : <p className="text-xs text-muted">Solo titolare e chef possono ricevere la merce.</p>}
            </Espandi>
          )) : <div className="card"><Vuoto titolo="Niente da ricevere">Compaiono qui le righe dei documenti elaborati i cui articoli sono abbinati al catalogo.</Vuoto></div>}
        </div>
      )}

      {vista === "movimenti" && (
        <div className="card mt-4 overflow-x-auto">
          {movimenti?.length ? (
            <table className="w-full min-w-[720px] text-[13px]">
              <caption className="sr-only">Registro dei movimenti</caption>
              <thead><tr><th scope="col" className="th">Quando</th><th scope="col" className="th">Movimento</th><th scope="col" className="th">Articolo</th><th scope="col" className="th text-right">Quantità</th><th scope="col" className="th">Motivo</th><th className="th"><span className="sr-only">Azioni</span></th></tr></thead>
              <tbody>{movimenti.map((m) => (
                <tr key={m.id} className="riga">
                  <td className="td num whitespace-nowrap text-muted">{dataOra(m.creato_il)}</td>
                  <td className="td">{TIPI_MOV[m.tipo] ?? m.tipo}{stornati.has(m.id) && <Badge className="ml-2">Stornato</Badge>}</td>
                  <td className="td">{m.lotti?.articoli_master?.nome}<span className="text-xs text-subtle"> · lotto {m.lotti?.codice_lotto ?? "s.c."}</span></td>
                  <td className={`td num text-right ${Number(m.quantita) < 0 ? "" : "text-ok"}`}>{Number(m.quantita) > 0 ? "+" : ""}{num(m.quantita, 3)} {m.unita}</td>
                  <td className="td text-xs text-muted">{m.motivo ?? ""}</td>
                  <td className="td">{operativo && !stornati.has(m.id) && !["storno", "trasferimento_uscita", "trasferimento_entrata"].includes(m.tipo) &&
                    <Azione rpc="storna_movimento" parametri={{ p_movimento_id: m.id }} etichetta="Storna" stile="btn btn-ghost btn-sm" motivo={{ parametro: "p_motivo", domanda: "Motivo dello storno (obbligatorio):" }} conferma="Lo storno registra un movimento contrario: l'originale resta nel registro. Confermi?" />}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <Vuoto titolo="Nessun movimento registrato" />}
          <p className="border-t border-line px-4 py-3 text-[11px] text-subtle">Il registro non si modifica né si cancella: un errore si corregge con uno storno motivato, che lascia traccia di entrambi i movimenti.</p>
        </div>
      )}

      <div className="mt-4 space-y-2">
        <Espandi titolo="Quali lotti usare? Suggerimento di prelievo (FEFO / FIFO)">
          {master?.length ? <SuggerisciPrelievo articoli={(master ?? []).map((m) => ({ id: m.id, nome: m.nome, unita: m.unita_base }))} /> : <p className="text-xs text-muted">Il catalogo è vuoto.</p>}
        </Espandi>
        {operativo && (
          <>
            <Espandi titolo="Aggiungi un lotto a mano">
              <Modulo rpc="ricevi_lotto" fissi={{ p_ristorante_id: "@sede" }} inDati="p_dati" invio="Crea lotto" fatto="Lotto creato" campi={[
                { nome: "master_id", etichetta: "Articolo", tipo: "select", richiesto: true, opzioni: (master ?? []).map((m) => ({ valore: m.id, etichetta: m.nome })) },
                { nome: "quantita", etichetta: "Quantità", tipo: "numero", richiesto: true }, { nome: "unita", etichetta: "Unità", tipo: "select", richiesto: true, opzioni: ["kg", "g", "lt", "ml", "pz", "conf"].map((u) => ({ valore: u, etichetta: u })) },
                { nome: "ubicazione_id", etichetta: "Ubicazione", tipo: "select", opzioni: opzUb }, { nome: "scadenza", etichetta: "Scadenza", tipo: "data" }, { nome: "codice_lotto", etichetta: "Codice lotto" },
                { nome: "costo_unitario", etichetta: "Costo d'acquisto per unità", tipo: "numero", aiuto: "Se non lo conosci lascia vuoto: non viene stimato." }, { nome: "valuta", etichetta: "Valuta", tipo: "select", opzioni: ["EUR", "CHF", "USD", "GBP"].map((v) => ({ valore: v, etichetta: v })) },
              ]} />
            </Espandi>
            <Espandi titolo="Inventario: registra la quantità contata di un lotto">
              <Modulo rpc="conta_lotto" compatto invio="Registra conteggio" fatto="Conteggio registrato" conferma="La differenza rispetto al registro verrà scritta come rettifica. Confermi?" campi={[
                { nome: "p_lotto_id", etichetta: "Lotto", tipo: "select", richiesto: true, opzioni: giacenze.map((g) => ({ valore: g.id, etichetta: `${g.master_nome} · ${g.codice_lotto ?? "s.c."} · a registro ${num(g.quantita_residua, 3)} ${g.unita}` })) },
                { nome: "p_quantita_contata", etichetta: "Quantità contata", tipo: "numero", richiesto: true }, { nome: "p_motivo", etichetta: "Nota", iniziale: "Inventario" }]} />
            </Espandi>
            <Espandi titolo="Sposta un lotto in un'altra ubicazione">
              <Modulo rpc="trasferisci_lotto" compatto invio="Sposta" fatto="Spostamento registrato" campi={[
                { nome: "p_lotto_id", etichetta: "Lotto", tipo: "select", richiesto: true, opzioni: giacenze.map((g) => ({ valore: g.id, etichetta: `${g.master_nome} · ${g.codice_lotto ?? "s.c."} · ${num(g.quantita_residua, 3)} ${g.unita} · ${g.ubicazione_nome ?? "senza ubicazione"}` })) },
                { nome: "p_quantita", etichetta: "Quantità", tipo: "numero", richiesto: true }, { nome: "p_ubicazione_id", etichetta: "Destinazione", tipo: "select", richiesto: true, opzioni: opzUb }]} />
            </Espandi>
            <Espandi titolo="Aggiungi una dispensa o un'altra ubicazione non refrigerata">
              <Modulo rpc="salva_ubicazione" fissi={{ p_ristorante_id: "@sede" }} inDati="p_dati" compatto invio="Aggiungi" campi={[
                { nome: "nome", etichetta: "Nome", richiesto: true }, { nome: "tipo", etichetta: "Tipo", tipo: "select", richiesto: true, opzioni: [{ valore: "dispensa", etichetta: "Dispensa" }, { valore: "cantina", etichetta: "Cantina" }, { valore: "altro", etichetta: "Altro" }] }, { nome: "posizione", etichetta: "Posizione" }]} />
            </Espandi>
          </>
        )}
      </div>
    </>
  );
}
