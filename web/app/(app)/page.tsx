import Link from "next/link";
import { ArrowRight, ListChecks, MapPin, TrendingUp, Upload } from "lucide-react";
import { cruscotto, PERIODI, sessioneSede } from "@/lib/sessione";
import { cn, data, dataBreve, money, moneyCompatto, pct, periodo } from "@/lib/format";
import type { DocumentoElenco, Riga } from "@/lib/tipi";
import { Intestazione, Kpi, Paese, Variazione, Vuoto } from "@/components/ui";
import { COLONNE_DOCUMENTO, TabellaDocumenti } from "@/components/tabella-documenti";
import { InDiretta } from "@/components/in-diretta";

const ETICHETTE: Record<number, string> = { 30: "30 giorni", 90: "90 giorni", 365: "12 mesi" };

export default async function Panoramica({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  const { periodo: scelto } = await searchParams;
  const giorni = PERIODI.find((p) => String(p) === scelto) ?? 90;
  const { supabase, attivo, permessi } = await sessioneSede();
  const [k, { data: recenti }, { data: rincari }] = await Promise.all([
    cruscotto(attivo.id, giorni),
    supabase.from("v_documenti").select(COLONNE_DOCUMENTO).eq("ristorante_id", attivo.id)
      .order("created_at", { ascending: false }).limit(8).returns<DocumentoElenco[]>(),
    supabase.from("v_anomalie").select("id,documento_id,descrizione,master_nome,ragione_sociale,variazione_pct,impatto,prezzo_precedente,prezzo_confronto,unita_confronto,valuta,data_documento")
      .eq("ristorante_id", attivo.id).eq("anomalia_stato", "aperta")
      .order("variazione_pct", { ascending: false }).limit(5).returns<Riga[]>(),
  ]);

  const intervallo = k ? periodo(k.dal, k.oggi) : "";
  const haDati = (k?.n_fatture ?? 0) > 0;
  const fuoriPeriodo = !haDati && (k?.totale_documenti ?? 0) > 0;
  const delta = k?.spesa != null && k.spesa_prec != null && k.spesa_prec > 0 ? ((k.spesa - k.spesa_prec) / k.spesa_prec) * 100 : null;
  const serie = k?.serie ?? [];
  const massimo = Math.max(1, ...serie.map((s) => Number(s.spesa)));
  const totCategorie = Math.max(1, ...(k?.categorie ?? []).map((c) => Number(c.spesa)));
  const daValidare = (k?.da_validare ?? 0) + (k?.master_in_bozza ?? 0);
  const nonConvertiti = k?.non_convertiti ?? [];
  // Spiega perché il periodo è vuoto e propone il periodo in cui i dati ci sono.
  const vuotoPeriodo = fuoriPeriodo
    ? <>Nessuna fattura con data tra il {intervallo}. I documenti caricati hanno date dal {data(k!.primo_documento)} al {data(k!.ultimo_documento)}: {giorni < 365 ? <Link href="/?periodo=365" className="text-fg underline">mostra gli ultimi 12 mesi</Link> : "sono precedenti agli ultimi 12 mesi"}.</>
    : <>Non ci sono ancora fatture. {permessi.caricare && <Link href="/carica" className="text-fg underline">Carica il primo documento</Link>}</>;

  return (
    <>
      <InDiretta ristoranteId={attivo.id} inLavorazione={(k?.in_lavorazione ?? 0) > 0} />
      <Intestazione titolo="Panoramica" sottotitolo={<>{attivo.nome} · {intervallo} · per data del documento</>}>
        <nav aria-label="Periodo" className="flex rounded-md border border-line bg-surface p-0.5">
          {PERIODI.map((p) => (
            <Link key={p} href={p === 90 ? "/" : `/?periodo=${p}`} aria-current={p === giorni ? "page" : undefined}
              className={cn("rounded px-2.5 py-1 text-xs transition-colors duration-150", p === giorni ? "bg-hover font-medium text-fg" : "text-muted hover:text-fg")}>
              {ETICHETTE[p]}
            </Link>
          ))}
        </nav>
        {permessi.caricare && <Link href="/carica" className="btn btn-primary"><Upload className="size-3.5" />Carica documento</Link>}
      </Intestazione>

      {/* Attività che richiedono una persona: prima di ogni indicatore. */}
      {(daValidare > 0 || (k?.rincari_aperti ?? 0) > 0 || (k?.errori ?? 0) > 0 || !attivo.paese) && (
        <section aria-label="Da fare" className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(k?.rincari_aperti ?? 0) > 0 && (
            <Link href="/anomalie" className="card flex items-center gap-3 border-danger/30 bg-danger-soft p-3 transition-colors hover:border-danger/60">
              <TrendingUp className="size-4 shrink-0 text-danger" aria-hidden />
              <span className="min-w-0 flex-1 text-[13px]"><span className="font-medium">{k!.rincari_aperti} {k!.rincari_aperti === 1 ? "rincaro" : "rincari"} da gestire</span>
                {k!.impatto_rincari != null && <span className="block text-xs text-muted">Maggior costo {money(k!.impatto_rincari)}</span>}</span>
              <ArrowRight className="size-3.5 text-muted" aria-hidden />
            </Link>
          )}
          {daValidare > 0 && (
            <Link href="/validazione" className="card flex items-center gap-3 border-warn/30 bg-warn-soft p-3 transition-colors hover:border-warn/60">
              <ListChecks className="size-4 shrink-0 text-warn" aria-hidden />
              <span className="min-w-0 flex-1 text-[13px]"><span className="font-medium">{daValidare} {daValidare === 1 ? "articolo" : "articoli"} da validare</span>
                <span className="block text-xs text-muted">{k!.documenti_da_rivedere} {k!.documenti_da_rivedere === 1 ? "documento elaborato attende" : "documenti elaborati attendono"} il controllo</span></span>
              <ArrowRight className="size-3.5 text-muted" aria-hidden />
            </Link>
          )}
          {(k?.errori ?? 0) > 0 && (
            <Link href="/documenti?filtro=problemi" className="card flex items-center gap-3 p-3 transition-colors hover:border-line-strong">
              <span className="size-2 shrink-0 rounded-full bg-danger" aria-hidden />
              <span className="flex-1 text-[13px] font-medium">{k!.errori} {k!.errori === 1 ? "documento non elaborato" : "documenti non elaborati"}</span>
              <ArrowRight className="size-3.5 text-muted" aria-hidden />
            </Link>
          )}
          {!attivo.paese && permessi.impostazioni && (
            <Link href="/impostazioni" className="card flex items-center gap-3 p-3 transition-colors hover:border-line-strong">
              <MapPin className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="flex-1 text-[13px]"><span className="font-medium">Completa i dati della sede</span><span className="block text-xs text-muted">Manca il paese</span></span>
              <ArrowRight className="size-3.5 text-muted" aria-hidden />
            </Link>
          )}
        </section>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi etichetta={`Spesa · ${ETICHETTE[giorni]}`} valore={haDati && k?.spesa != null ? moneyCompatto(k.spesa) : "—"}
          nota={!haDati ? "Nessuna fattura nel periodo"
            : delta === null ? "Fatture − note di credito, imponibile in EUR"
            : <><span className={cn("num", delta > 0 ? "text-warn" : "text-ok")}>{pct(delta)}</span> sul periodo precedente di pari durata</>} />
        <Kpi etichetta="Rincari da gestire" valore={k?.rincari_aperti ?? 0} tono={k?.rincari_aperti ? "danger" : undefined} href="/anomalie"
          nota={k?.rincari_aperti ? <>Oltre il <span className="num">{Number(attivo.soglia_anomalia_pct)}%</span>{k.rincari_contestati ? <> · {k.rincari_contestati} contestati</> : null}</>
            : (k?.n_confronti ?? 0) === 0 ? "Ancora nessun prezzo confrontabile" : "Nessun prezzo oltre la soglia"} />
        <Kpi etichetta={`Risparmi · ${ETICHETTE[giorni]}`} valore={(k?.n_confronti ?? 0) > 0 ? moneyCompatto(k?.risparmi ?? 0) : "—"}
          tono={k?.risparmi ? "ok" : undefined}
          nota={(k?.n_confronti ?? 0) > 0 ? <><span className="num">{k!.n_confronti}</span> prezzi confrontati con l&apos;acquisto precedente</> : "Serve un secondo acquisto dello stesso articolo"} />
        <Kpi etichetta={`Documenti · ${ETICHETTE[giorni]}`} valore={k?.n_documenti ?? 0}
          nota={<><span className="num">{k?.totale_documenti ?? 0}</span> in archivio · <span className="num">{k?.fornitori ?? 0}</span> fornitori</>} />
      </div>

      {nonConvertiti.length > 0 && (
        <p className="mt-3 rounded-lg border border-warn/25 bg-warn-soft px-3 py-2 text-[13px] text-warn" role="status">
          Non inclusi nella spesa in EUR, perché manca il cambio BCE alla data del documento:{" "}
          {nonConvertiti.map((n, i) => <span key={n.valuta} className="num">{i > 0 && " · "}{money(n.importo, n.valuta)} ({n.documenti} {n.documenti === 1 ? "documento" : "documenti"})</span>)}.
        </p>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <section className="card p-4 lg:col-span-2" aria-labelledby="t-spesa">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="t-spesa" className="text-[13px] font-medium">Spesa per {k?.passo === "mese" ? "mese" : "settimana"}</h2>
            <p className="text-xs text-subtle">Imponibile delle fatture in EUR · {intervallo}</p>
          </div>
          {haDati ? (
            <>
              <div className="mt-6 flex h-40 items-end gap-1.5" aria-hidden>
                {serie.map((s) => {
                  const v = Number(s.spesa);
                  return (
                    <div key={s.inizio} className="group relative flex h-full flex-1 flex-col justify-end">
                      <div className={cn("w-full rounded-sm transition-colors duration-150", v > 0 ? "bg-fg/25 group-hover:bg-ok" : "bg-line")}
                        style={{ height: `${Math.max(v > 0 ? 4 : 1.5, (v / massimo) * 100)}%` }} />
                      <div className="pointer-events-none absolute -top-9 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-raised px-2 py-1 text-[11px] shadow-pop group-hover:block">
                        <span className="num font-medium">{money(v)}</span> <span className="text-subtle">· {dataBreve(s.inizio)} – {dataBreve(s.fine)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex justify-between text-[11px] text-subtle" aria-hidden>
                <span>dal {dataBreve(serie[0]?.inizio)}</span><span>al {dataBreve(k?.oggi)}</span>
              </div>
              <table className="sr-only">
                <caption>Spesa per {k?.passo === "mese" ? "mese" : "settimana"}, {intervallo}</caption>
                <thead><tr><th scope="col">Periodo</th><th scope="col">Spesa</th></tr></thead>
                <tbody>{serie.map((s) => <tr key={s.inizio}><td>{data(s.inizio)} – {data(s.fine)}</td><td>{money(s.spesa)}</td></tr>)}</tbody>
              </table>
            </>
          ) : <Vuoto compatto titolo="Nessuna spesa in questo periodo">{vuotoPeriodo}</Vuoto>}
        </section>

        <section className="card p-4" aria-labelledby="t-cat">
          <h2 id="t-cat" className="text-[13px] font-medium">Spesa per categoria</h2>
          <p className="text-xs text-subtle">{intervallo}</p>
          {k?.categorie?.length ? (
            <ul className="mt-4 space-y-3">
              {k.categorie.map((c) => (
                <li key={c.categoria}>
                  <div className="flex justify-between gap-3 text-xs">
                    <span className={cn("truncate", c.categoria === "Non classificato" && "text-subtle")}>{c.categoria}</span>
                    <span className="num text-muted">{money(c.spesa)}</span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line" aria-hidden>
                    <div className="h-full rounded-full bg-fg/40" style={{ width: `${(Number(c.spesa) / totCategorie) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : <Vuoto compatto titolo="Nessun dato nel periodo">{haDati ? "Le categorie compaiono quando gli articoli sono abbinati al catalogo." : "Cambia periodo o carica un documento."}</Vuoto>}
        </section>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <section className="card lg:col-span-2" aria-labelledby="t-rinc">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 id="t-rinc" className="text-[13px] font-medium">Rincari da gestire</h2>
            <Link href="/anomalie" className="flex items-center gap-1 text-xs text-muted hover:text-fg">Tutti <ArrowRight className="size-3" /></Link>
          </div>
          {rincari?.length ? (
            <ul className="mt-2">
              {rincari.map((r) => (
                <li key={r.id} className="riga">
                  <Link href={`/documenti/${r.documento_id}`} className="flex items-center gap-4 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{r.master_nome ?? r.descrizione}</p>
                      <p className="truncate text-xs text-subtle">{r.ragione_sociale} · {data(r.data_documento)}</p>
                    </div>
                    <p className="num hidden whitespace-nowrap text-xs text-muted sm:block">
                      {money(r.prezzo_precedente, r.valuta)} → <span className="text-fg">{money(r.prezzo_confronto, r.valuta)}</span>
                      <span className="text-subtle">/{r.unita_confronto}</span>
                    </p>
                    <Variazione v={r.variazione_pct} anomalia className="w-16 justify-end" />
                    <p className="num w-24 text-right text-xs text-danger">{r.impatto != null ? `+${money(r.impatto, r.valuta)}` : "—"}</p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Vuoto compatto titolo="Nessun rincaro da gestire">
              {(k?.n_confronti ?? 0) === 0 && (k?.rincari_aperti ?? 0) === 0
                ? "Un rincaro si rileva dal secondo acquisto dello stesso articolo dallo stesso fornitore: finora ogni articolo è stato acquistato una sola volta."
                : "I prezzi confrontati sono entro la soglia."}
            </Vuoto>
          )}
        </section>

        <section className="card p-4" aria-labelledby="t-forn">
          <h2 id="t-forn" className="text-[13px] font-medium">Fornitori principali</h2>
          <p className="text-xs text-subtle">Per spesa · {intervallo}</p>
          {k?.top_fornitori?.length ? (
            <ul className="mt-4 space-y-3">
              {k.top_fornitori.map((f) => (
                <li key={f.ragione_sociale} className="flex items-center justify-between gap-3 text-xs">
                  <span className="flex min-w-0 items-center gap-2"><span className="truncate">{f.ragione_sociale}</span><Paese codice={f.paese} /></span>
                  <span className="num whitespace-nowrap text-muted">{f.spesa != null ? money(f.spesa) : "non convertito"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Vuoto compatto titolo="Nessun acquisto nel periodo">
              {(k?.fornitori ?? 0) > 0 ? <>La sede ha {k!.fornitori} fornitori, ma nessuna loro fattura ha data in questo periodo.</> : "I fornitori compaiono con il primo documento."}
            </Vuoto>
          )}
        </section>
      </div>

      <section className="card mt-3" aria-labelledby="t-doc">
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <h2 id="t-doc" className="text-[13px] font-medium">Ultimi documenti caricati</h2>
          <Link href="/documenti" className="flex items-center gap-1 text-xs text-muted hover:text-fg">Tutti <ArrowRight className="size-3" /></Link>
        </div>
        <TabellaDocumenti documenti={recenti ?? []}
          vuoto={<Vuoto titolo="Nessun documento">Carica la prima fattura o il primo DDT per iniziare a controllare i prezzi.</Vuoto>} />
      </section>
    </>
  );
}
