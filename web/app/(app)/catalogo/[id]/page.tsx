import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { sessioneSede } from "@/lib/sessione";
import { data, money, num } from "@/lib/format";
import { motivoConfronto } from "@/lib/controlli";
import type { Riga } from "@/lib/tipi";
import { Badge, Kpi, Paese, Variazione, Vuoto } from "@/components/ui";
import { ModuloMaster, RevocaAlias, UnisciIn } from "./scheda";

export const metadata: Metadata = { title: "Articolo" };

type MasterRiga = { id: string; nome: string; unita_base: string; stato: string; gruppo_id: string; categorie_master: { nome: string } | null };
type AliasRiga = {
  id: string; descrizione_normalizzata: string; descrizione_originale: string | null; codice_articolo: string | null; unita_misura: string | null;
  stato_abbinamento: string; metodo: string | null; fattore_conversione: number | null; fornitori: { ragione_sociale: string; paese: string | null } | null;
};
type Simile = { id: string; nome: string; unita_base: string; stato: string; categoria: string | null; somiglianza: number };
const METODI: Record<string, string> = { manuale: "Confermato a mano", ia: "Abbinato dall'IA", ia_nuovo: "Creato dall'IA", similarita: "Descrizione quasi identica" };

export default async function Articolo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, attivo, permessi } = await sessioneSede();
  const { data: m } = await supabase.from("articoli_master").select("id,nome,unita_base,stato,gruppo_id,categorie_master(nome)").eq("id", id).maybeSingle<MasterRiga>();
  if (!m) notFound();

  const [{ data: alias }, { data: acquisti }, { data: simili }, { data: categorie }] = await Promise.all([
    supabase.from("alias_articolo").select("id,descrizione_normalizzata,descrizione_originale,codice_articolo,unita_misura,stato_abbinamento,metodo,fattore_conversione,fornitori(ragione_sociale,paese)")
      .eq("master_id", id).order("descrizione_normalizzata").returns<AliasRiga[]>(),
    supabase.from("v_righe").select("*").eq("master_id", id).eq("ristorante_id", attivo.id).eq("documento_stato", "completato")
      .order("data_rilevazione", { ascending: false }).limit(100).returns<Riga[]>(),
    supabase.rpc("master_simili", { p_master_id: id }),
    supabase.from("categorie_master").select("nome").eq("gruppo_id", m.gruppo_id).order("nome").returns<{ nome: string }[]>(),
  ]);
  const righe = acquisti ?? [];
  const aperti = righe.filter((r) => r.anomalia_prezzo && r.anomalia_stato === "aperta").length;
  const nonConfrontabili = righe.filter((r) => r.confronto_esito === "unita_non_confrontabile").length;
  const ultimo = righe[0];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link href="/catalogo" className="btn btn-ghost btn-sm px-1.5" aria-label="Torna al catalogo"><ArrowLeft className="size-4" /></Link>
        <h1 className="text-lg font-semibold tracking-tight">{m.nome}</h1>
        {m.stato === "bozza" ? <Badge tono="warn">Bozza da approvare</Badge> : <Badge tono="ok">Approvato</Badge>}
        <span className="text-xs text-muted">{m.categorie_master?.nome ?? "Senza categoria"} · prezzi a {m.unita_base}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi etichetta="Ultimo prezzo" valore={ultimo ? money(ultimo.prezzo_base ?? ultimo.prezzo_netto, ultimo.valuta) : "—"}
          nota={ultimo ? <>per {ultimo.prezzo_base != null ? ultimo.unita_base : ultimo.unita_misura} · {data(ultimo.data_documento)}</> : `Mai acquistato in ${attivo.nome}`} />
        <Kpi etichetta="Acquisti in questa sede" valore={righe.length} nota={`${new Set(righe.map((r) => r.ragione_sociale)).size} fornitori`} />
        <Kpi etichetta="Rincari da gestire" valore={aperti} tono={aperti ? "danger" : undefined} href={aperti ? "/anomalie" : undefined} nota={aperti ? "Dipendono da questo articolo" : "Nessuno"} />
        <Kpi etichetta="Non confrontabili" valore={nonConfrontabili} tono={nonConfrontabili ? "warn" : undefined}
          nota={nonConfrontabili ? `Righe in unità diversa da ${m.unita_base}, senza peso o contenuto` : "Tutte le righe sono confrontabili"} />
      </div>

      {permessi.approvareMaster && (
        <section className="card mt-3 p-4" aria-labelledby="t-mod">
          <h2 id="t-mod" className="text-[13px] font-medium">Nome, categoria e unità base</h2>
          <p className="mb-3 text-xs text-muted">Valgono per tutte le sedi del gruppo. Cambiando l&apos;unità base, prezzi e rincari di questo articolo vengono ricalcolati.</p>
          <ModuloMaster master={{ id: m.id, nome: m.nome, categoria: m.categorie_master?.nome ?? null, unita_base: m.unita_base, stato: m.stato }} categorie={(categorie ?? []).map((c) => c.nome)} />
        </section>
      )}

      {(simili as Simile[] | null)?.length ? (
        <section className="card mt-3" aria-labelledby="t-sim">
          <div className="px-4 pt-4"><h2 id="t-sim" className="text-[13px] font-medium">Possibili doppioni</h2>
            <p className="text-xs text-muted">Articoli con un nome simile. Se sono lo stesso prodotto, unendoli lo storico prezzi diventa uno solo.</p></div>
          <ul className="mt-2">
            {(simili as Simile[]).map((s) => (
              <li key={s.id} className="riga flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
                <Link href={`/catalogo/${s.id}`} className="font-medium hover:underline">{s.nome}</Link>
                <span className="text-xs text-subtle">{s.categoria ?? "Senza categoria"} · {s.unita_base} · somiglianza <span className="num">{Math.round(s.somiglianza * 100)}%</span></span>
                {permessi.approvareMaster && <span className="ml-auto"><UnisciIn da={m.id} nomeDa={m.nome} verso={s.id} nomeVerso={s.nome} /></span>}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card mt-3" aria-labelledby="t-alias">
        <div className="px-4 pt-4"><h2 id="t-alias" className="text-[13px] font-medium">Come lo chiamano i fornitori <span className="num text-subtle">· {alias?.length ?? 0}</span></h2>
          <p className="text-xs text-muted">Le descrizioni dei documenti collegate a questo articolo, in tutte le sedi del gruppo.</p></div>
        {alias?.length ? (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead><tr><th scope="col" className="th">Descrizione</th><th scope="col" className="th">Fornitore</th><th scope="col" className="th">Unità di vendita</th><th scope="col" className="th">Abbinamento</th><th className="th"><span className="sr-only">Azioni</span></th></tr></thead>
              <tbody>
                {alias.map((a) => (
                  <tr key={a.id} className="riga">
                    <td className="td">{a.descrizione_normalizzata}
                      {a.descrizione_originale && a.descrizione_originale !== a.descrizione_normalizzata && <span className="block text-xs italic text-subtle">{a.descrizione_originale}</span>}
                      {a.codice_articolo && <span className="num block text-xs text-subtle">cod. {a.codice_articolo}</span>}</td>
                    <td className="td"><span className="flex items-center gap-2"><span className="max-w-[180px] truncate">{a.fornitori?.ragione_sociale}</span><Paese codice={a.fornitori?.paese} /></span></td>
                    <td className="td text-xs text-muted">{a.unita_misura ?? "—"}{a.fattore_conversione ? <span className="num"> · 1 {a.unita_misura} = {num(a.fattore_conversione, 3)} {m.unita_base}</span> : null}</td>
                    <td className="td text-xs text-muted">{METODI[a.metodo ?? ""] ?? a.stato_abbinamento}</td>
                    <td className="td">{permessi.approvareMaster && <RevocaAlias aliasId={a.id} descrizione={a.descrizione_normalizzata} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Vuoto compatto titolo="Nessuna descrizione collegata">Collega una riga da «Da validare».</Vuoto>}
      </section>

      <section className="card mt-3" aria-labelledby="t-acq">
        <div className="px-4 pt-4"><h2 id="t-acq" className="text-[13px] font-medium">Acquisti in {attivo.nome} <span className="num text-subtle">· {righe.length}</span></h2>
          <p className="text-xs text-muted">Prezzo netto di sconto. La variazione è rispetto all&apos;acquisto precedente dallo stesso fornitore, nella stessa valuta.</p></div>
        {righe.length ? (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead><tr><th scope="col" className="th">Data</th><th scope="col" className="th">Documento</th><th scope="col" className="th">Fornitore</th><th scope="col" className="th text-right">Quantità</th>
                <th scope="col" className="th text-right">Prezzo netto</th><th scope="col" className="th text-right">Per {m.unita_base}</th><th scope="col" className="th text-right">Variazione</th></tr></thead>
              <tbody>
                {righe.map((r) => (
                  <tr key={r.id} className="riga">
                    <td className="td whitespace-nowrap text-muted">{data(r.data_documento)}</td>
                    <td className="td"><Link href={`/documenti/${r.documento_id}`} className="hover:underline">{r.tipo} <span className="num">{r.numero ?? "s.n."}</span></Link></td>
                    <td className="td"><span className="block max-w-[180px] truncate">{r.ragione_sociale}</span></td>
                    <td className="td num whitespace-nowrap text-right">{num(r.quantita, 3)} {r.unita_misura}</td>
                    <td className="td num whitespace-nowrap text-right">{money(r.prezzo_netto, r.valuta)}<span className="text-subtle">/{r.unita_misura}</span></td>
                    <td className="td num whitespace-nowrap text-right">{r.prezzo_base != null ? money(r.prezzo_base, r.valuta) : <span className="text-subtle" title={motivoConfronto("unita_non_confrontabile", true) ?? undefined}>non convertibile</span>}</td>
                    <td className="td text-right">{r.variazione_pct != null ? <Variazione v={r.variazione_pct} anomalia={r.anomalia_prezzo} />
                      : <span className="text-xs text-subtle" title={motivoConfronto(r.confronto_esito, true) ?? undefined}>{r.confronto_esito === "primo_acquisto" ? "primo acquisto" : "non confrontato"}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Vuoto compatto titolo="Nessun acquisto in questa sede" />}
      </section>
    </div>
  );
}
