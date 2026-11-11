import type { Metadata } from "next";
import { sessioneModulo } from "@/lib/sessione";
import { data, dataOra } from "@/lib/format";
import { CATEGORIE_ARCHIVIO } from "@/lib/autocontrollo";
import { Badge, Intestazione, Vuoto } from "@/components/ui";
import { StatoModulo } from "@/components/modulo-stato";
import { Azione, Espandi } from "@/components/modulo";
import { NavAutocontrollo } from "../navigazione";
import { CaricaDocumento } from "./caricatore";

export const metadata: Metadata = { title: "Documenti di autocontrollo" };

type Versione = { id: string; versione: number; revisione: string | null; data_documento: string | null; file_path: string; nome_file: string; dimensione: number; caricato_il: string };
type Doc = { id: string; categoria: string; titolo: string; scadenza: string | null; note: string | null; archiviato: boolean; archiviato_motivo: string | null;
  fornitori: { ragione_sociale: string } | null; articoli_master: { nome: string } | null; persone: { nome: string } | null; attrezzature: { nome: string } | null; archivio_versioni: Versione[] };

export default async function Documenti({ searchParams }: { searchParams: Promise<{ archiviati?: string }> }) {
  const { archiviati } = await searchParams;
  const { supabase, attivo, ruolo, piano, inclusa, scrivibile } = await sessioneModulo("autocontrollo");
  const [{ data: docs }, { data: fornitori }, { data: articoli }, { data: persone }, { data: attrezzature }] = await Promise.all([
    supabase.from("archivio").select("id,categoria,titolo,scadenza,note,archiviato,archiviato_motivo,fornitori(ragione_sociale),articoli_master(nome),persone(nome),attrezzature(nome),archivio_versioni(id,versione,revisione,data_documento,file_path,nome_file,dimensione,caricato_il)")
      .eq("ristorante_id", attivo.id).eq("archiviato", archiviati === "1").order("categoria").order("titolo").returns<Doc[]>(),
    supabase.from("fornitori").select("id,ragione_sociale").eq("gruppo_id", attivo.gruppo_id).order("ragione_sociale").returns<{ id: string; ragione_sociale: string }[]>(),
    supabase.from("articoli_master").select("id,nome").eq("gruppo_id", attivo.gruppo_id).order("nome").returns<{ id: string; nome: string }[]>(),
    supabase.from("persone").select("id,nome").eq("ristorante_id", attivo.id).eq("attiva", true).order("nome").returns<{ id: string; nome: string }[]>(),
    supabase.from("attrezzature").select("id,nome").eq("ristorante_id", attivo.id).order("nome").returns<{ id: string; nome: string }[]>(),
  ]);
  const puoCaricare = scrivibile && (ruolo === "titolare" || ruolo === "chef" || ruolo === "consulente");
  const collegamenti = { fornitori: (fornitori ?? []).map((f) => ({ id: f.id, nome: f.ragione_sociale })), articoli: articoli ?? [], persone: persone ?? [], attrezzature: attrezzature ?? [] };
  const perCategoria = Object.entries(CATEGORIE_ARCHIVIO).map(([k, nome]) => ({ k, nome, docs: (docs ?? []).filter((d) => d.categoria === k) })).filter((g) => g.docs.length);
  const oggi = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());

  return (
    <>
      <Intestazione titolo="Autocontrollo" sottotitolo={attivo.nome} />
      <StatoModulo piano={piano} inclusa={inclusa} scrivibile={scrivibile} nome="Autocontrollo" />
      <NavAutocontrollo attiva="documenti" />
      {puoCaricare && !archiviati && <div className="mb-4"><Espandi titolo="Archivia un documento" aperto={!docs?.length}><CaricaDocumento sede={attivo.id} collegamenti={collegamenti} /></Espandi></div>}
      {perCategoria.length ? perCategoria.map((g) => (
        <section key={g.k} className="mb-4" aria-labelledby={`c-${g.k}`}>
          <h2 id={`c-${g.k}`} className="eyebrow mb-2">{g.nome}</h2>
          <ul className="card divide-y divide-line">{g.docs.map((d) => {
            const versioni = [...d.archivio_versioni].sort((a, b) => b.versione - a.versione);
            const ultima = versioni[0];
            const legami = [d.fornitori?.ragione_sociale, d.articoli_master?.nome, d.persone?.nome, d.attrezzature?.nome].filter(Boolean);
            return (
              <li key={d.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium">{d.titolo}</span>
                  {ultima && <span className="text-xs text-subtle">v{ultima.versione}{ultima.revisione ? ` · ${ultima.revisione}` : ""}{ultima.data_documento ? ` · del ${data(ultima.data_documento)}` : ""}</span>}
                  {d.scadenza && <Badge tono={d.scadenza < oggi ? "danger" : "neutro"}>scade il {data(d.scadenza)}</Badge>}
                  {d.archiviato && <Badge>Archiviato{d.archiviato_motivo ? `: ${d.archiviato_motivo}` : ""}</Badge>}
                </div>
                {legami.length > 0 && <p className="mt-1 text-xs text-muted">{legami.join(" · ")}</p>}
                {d.note && <p className="mt-1 text-xs text-muted">{d.note}</p>}
                <ul className="mt-2 space-y-1 text-xs">{versioni.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-2 text-muted">
                    <a className="underline" href={`/autocontrollo/documenti/file?p=${encodeURIComponent(v.file_path)}`} target="_blank" rel="noopener">v{v.versione} · {v.nome_file}</a>
                    <span>caricato il {dataOra(v.caricato_il)}</span>
                  </li>
                ))}</ul>
                {puoCaricare && !d.archiviato && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Espandi titolo="Carica una nuova revisione"><CaricaDocumento sede={attivo.id} documento={{ id: d.id, titolo: d.titolo }} collegamenti={collegamenti} /></Espandi>
                    <Azione rpc="aggiorna_archivio" parametri={{ p_archivio_id: d.id, p_dati: { archiviato: true } }} etichetta="Archivia"
                      motivo={{ parametro: "p_dati.archiviato_motivo", domanda: "Perché il documento non è più in uso? (resta consultabile tra gli archiviati)" }} />
                  </div>
                )}
              </li>
            );
          })}</ul>
        </section>
      )) : <Vuoto titolo={archiviati ? "Nessun documento archiviato" : "Archivio vuoto"}>{archiviati ? null : "Inizia dal manuale di autocontrollo, poi schede tecniche, dichiarazioni MOCA e schede dei prodotti chimici."}</Vuoto>}
      <p className="mt-2 text-xs"><a className="text-muted underline" href={archiviati ? "/autocontrollo/documenti" : "/autocontrollo/documenti?archiviati=1"}>{archiviati ? "Torna ai documenti in uso" : "Vedi i documenti archiviati"}</a></p>
    </>
  );
}
