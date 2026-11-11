import type { Metadata } from "next";
import Link from "next/link";
import { contestoAutocontrollo } from "@/lib/contesto-autocontrollo";
import { data, dataOra } from "@/lib/format";
import { Badge, Intestazione, Vuoto } from "@/components/ui";
import { StatoModulo } from "@/components/modulo-stato";
import { Espandi, Modulo } from "@/components/modulo";
import { NavAutocontrollo } from "../navigazione";
import { Registra } from "../operatore";

export const metadata: Metadata = { title: "Monitoraggio infestanti" };

type Trappola = { id: string; codice: string; tipo: string; posizione: string | null; x: number | null; y: number | null; gestita_da: string; attiva: boolean; planimetria_id: string | null };
type Doc = { id: string; titolo: string; categoria: string; scadenza: string | null; archivio_versioni: { file_path: string; versione: number; mime: string }[] };
const TIPI = { roditori: "Roditori", insetti_striscianti: "Insetti striscianti", insetti_volanti: "Insetti volanti", altro: "Altro" } as Record<string, string>;

export default async function Infestanti() {
  const c = await contestoAutocontrollo();
  const { supabase, attivo, persone, pinObbligatorio, puoRegistrare, puoGestire, puoPianificare } = c;
  const [{ data: sede }, { data: trappole }, { data: docs }, { data: controlli }] = await Promise.all([
    supabase.from("ristoranti").select("gestione_infestanti").eq("id", attivo.id).single<{ gestione_infestanti: string | null }>(),
    supabase.from("trappole").select("id,codice,tipo,posizione,x,y,gestita_da,attiva,planimetria_id").eq("ristorante_id", attivo.id).order("codice").returns<Trappola[]>(),
    supabase.from("archivio").select("id,titolo,categoria,scadenza,archivio_versioni(file_path,versione,mime)").eq("ristorante_id", attivo.id).eq("archiviato", false)
      .in("categoria", ["planimetria", "contratto_infestanti", "rapporto_infestanti", "scheda_tecnica_trappole"]).returns<Doc[]>(),
    supabase.from("registrazioni").select("eseguita_il,esito,dati").eq("ristorante_id", attivo.id).eq("tipo", "infestanti").order("eseguita_il", { ascending: false }).limit(500)
      .returns<{ eseguita_il: string; esito: string; dati: { trappola_id?: string } }[]>(),
  ]);
  const ultimo = new Map<string, { eseguita_il: string; esito: string }>();
  for (const r of controlli ?? []) if (r.dati.trappola_id && !ultimo.has(r.dati.trappola_id)) ultimo.set(r.dati.trappola_id, r);
  const planimetrie = (docs ?? []).filter((d) => d.categoria === "planimetria");
  const ultimaVersione = (d: Doc) => [...d.archivio_versioni].sort((a, b) => b.versione - a.versione)[0];
  const pianta = planimetrie.find((p) => ultimaVersione(p)?.mime.startsWith("image/"));
  const fileDi = (d: Doc) => `/autocontrollo/documenti/file?p=${encodeURIComponent(ultimaVersione(d)?.file_path ?? "")}`;

  return (
    <>
      <Intestazione titolo="Monitoraggio infestanti" sottotitolo={attivo.nome} />
      <StatoModulo piano={c.piano} inclusa={c.inclusa} scrivibile={c.scrivibile} nome="Autocontrollo" />
      <NavAutocontrollo attiva="infestanti" />
      <section className="card mb-4 p-4">
        <p className="text-[13px]">Gestione: <strong>{{ interna: "interna (registro proprio)", esterna: "ditta esterna", mista: "ditta esterna e controlli interni" }[sede?.gestione_infestanti ?? ""] ?? "non indicata"}</strong></p>
        {puoPianificare && <div className="mt-2 max-w-md"><Modulo rpc="imposta_sede_autocontrollo" fissi={{ p_ristorante_id: "@sede" }} inDati="p_dati" compatto invio="Salva" campi={[
          { nome: "gestione_infestanti", etichetta: "Chi si occupa del monitoraggio", tipo: "select", richiesto: true, iniziale: sede?.gestione_infestanti ?? "", opzioni: [{ valore: "interna", etichetta: "Noi (interna)" }, { valore: "esterna", etichetta: "Ditta esterna" }, { valore: "mista", etichetta: "Entrambi" }] }]} /></div>}
        <ul className="mt-3 space-y-1 text-xs">{(docs ?? []).filter((d) => d.categoria !== "planimetria").map((d) => (
          <li key={d.id}><a className="underline" target="_blank" rel="noopener" href={fileDi(d)}>{d.titolo}</a>{d.scadenza && <span className="text-subtle"> · scade il {data(d.scadenza)}</span>}</li>
        ))}</ul>
        <p className="mt-2 text-[11px] text-subtle">Contratto, rapporti della ditta, schede delle trappole e planimetria si caricano in <Link className="underline" href="/autocontrollo/documenti">Documenti</Link>. I passaggi della ditta si pianificano nel Piano HACCP come controllo «Monitoraggio infestanti» con gestione esterna, così compaiono nello scadenzario.</p>
      </section>

      {pianta && (trappole ?? []).some((t) => t.x != null) && (
        <section className="card mb-4 p-4" aria-labelledby="t-pianta">
          <h2 id="t-pianta" className="text-[13px] font-medium">Planimetria: {pianta.titolo}</h2>
          <div className="relative mt-2 inline-block max-w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileDi(pianta)} alt={`Planimetria ${pianta.titolo}`} className="max-h-[480px] max-w-full rounded border border-line" />
            {(trappole ?? []).filter((t) => t.x != null && t.y != null && t.attiva).map((t) => (
              <span key={t.id} title={`${t.codice} · ${TIPI[t.tipo]}`} style={{ left: `${t.x}%`, top: `${t.y}%` }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white px-1 text-[10px] font-semibold text-white ${ultimo.get(t.id)?.esito === "non_conforme" ? "bg-danger" : "bg-ok"}`}>{t.codice}</span>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="t-trap">
        <h2 id="t-trap" className="eyebrow mb-2">Trappole e punti di monitoraggio</h2>
        {trappole?.length ? <ul className="card divide-y divide-line">{trappole.map((t) => (
          <li key={t.id} className={t.attiva ? "p-4" : "p-4 opacity-60"}>
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="font-medium">{t.codice}</span><Badge>{TIPI[t.tipo]}</Badge><span className="text-xs text-muted">{t.posizione}</span>
              <Badge>{t.gestita_da === "esterna" ? "Ditta" : "Interna"}</Badge>
              {ultimo.get(t.id) ? <span className="text-xs text-subtle">ultimo controllo {dataOra(ultimo.get(t.id)!.eseguita_il)} · {ultimo.get(t.id)!.esito === "conforme" ? "nessuna presenza" : "presenza o anomalia"}</span> : <span className="text-xs text-warn">mai controllata</span>}
            </div>
            {puoRegistrare && t.attiva && <div className="mt-2"><Espandi titolo="Registra il controllo">
              <Registra sede={attivo.id} persone={persone} obbligatorio={pinObbligatorio} compatto base={{ tipo: "infestanti", dati: { trappola_id: t.id, trappola: t.codice } }} campi={[
                { nome: "presenza", etichetta: "Esito", tipo: "select", richiesto: true, opzioni: [{ valore: "assenza", etichetta: "Nessuna presenza" }, { valore: "presenza", etichetta: "Presenza / catture" }, { valore: "danneggiata", etichetta: "Trappola danneggiata o spostata" }] },
                { nome: "specie", etichetta: "Specie o segni osservati", inDati: true }, { nome: "foto_path", etichetta: "Foto", tipo: "foto" }, { nome: "nota", etichetta: "Nota" }]} />
            </Espandi></div>}
            {puoGestire && <div className="mt-2"><Espandi titolo="Modifica posizione">
              <Modulo rpc="salva_trappola" fissi={{ p_ristorante_id: "@sede", p_trappola_id: t.id }} inDati="p_dati" compatto invio="Salva" campi={[
                { nome: "posizione", etichetta: "Posizione", iniziale: t.posizione ?? "" }, { nome: "x", etichetta: "X sulla planimetria (0–100)", tipo: "numero", iniziale: t.x?.toString() ?? "" },
                { nome: "y", etichetta: "Y sulla planimetria (0–100)", tipo: "numero", iniziale: t.y?.toString() ?? "" },
                { nome: "attiva", etichetta: "Attiva", tipo: "check", iniziale: t.attiva }]} />
            </Espandi></div>}
          </li>
        ))}</ul> : <Vuoto compatto titolo="Nessuna trappola censita" />}
        {puoGestire && <div className="mt-3"><Espandi titolo="Aggiungi una trappola">
          <Modulo rpc="salva_trappola" fissi={{ p_ristorante_id: "@sede" }} inDati="p_dati" invio="Aggiungi" campi={[
            { nome: "codice", etichetta: "Codice (come sulla planimetria)", richiesto: true }, { nome: "tipo", etichetta: "Tipo", tipo: "select", richiesto: true, opzioni: Object.entries(TIPI).map(([valore, etichetta]) => ({ valore, etichetta })) },
            { nome: "posizione", etichetta: "Posizione" }, { nome: "gestita_da", etichetta: "Controllata da", tipo: "select", richiesto: true, iniziale: "interna", opzioni: [{ valore: "interna", etichetta: "Noi" }, { valore: "esterna", etichetta: "Ditta esterna" }] },
            { nome: "planimetria_id", etichetta: "Planimetria", tipo: "select", opzioni: planimetrie.map((p) => ({ valore: p.id, etichetta: p.titolo })) },
            { nome: "x", etichetta: "X (0–100, da sinistra)", tipo: "numero" }, { nome: "y", etichetta: "Y (0–100, dall'alto)", tipo: "numero" }]} />
        </Espandi></div>}
      </section>
    </>
  );
}
