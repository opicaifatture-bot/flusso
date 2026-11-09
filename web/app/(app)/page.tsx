import Link from "next/link";
import { ArrowRight, Upload } from "lucide-react";
import { cruscotto, sessioneSede } from "@/lib/sessione";
import { cn, data, money, moneyCompatto, pct } from "@/lib/format";
import type { Documento, Riga } from "@/lib/tipi";
import { Intestazione, Kpi, Paese, Variazione, Vuoto } from "@/components/ui";
import { COLONNE_DOCUMENTO, TabellaDocumenti } from "@/components/tabella-documenti";
import { InDiretta } from "@/components/in-diretta";

export default async function Panoramica() {
  const { supabase, attivo, permessi } = await sessioneSede();
  const [k, { data: recenti }, { data: rincari }] = await Promise.all([
    cruscotto(attivo.id),
    supabase.from("documenti").select(COLONNE_DOCUMENTO).eq("ristorante_id", attivo.id)
      .order("created_at", { ascending: false }).limit(8).returns<Documento[]>(),
    supabase.from("v_anomalie").select("id,documento_id,descrizione,master_nome,ragione_sociale,variazione_pct,impatto_eur,prezzo_precedente,prezzo_confronto,unita_confronto,valuta,data_documento")
      .eq("ristorante_id", attivo.id).eq("anomalia_stato", "aperta")
      .order("impatto_eur", { ascending: false, nullsFirst: false }).limit(5).returns<Riga[]>(),
  ]);

  const delta = k && k.spesa_30g_prec > 0 ? ((k.spesa_30g - k.spesa_30g_prec) / k.spesa_30g_prec) * 100 : null;
  const settimane = k?.settimane ?? [];
  const massimo = Math.max(1, ...settimane.map((s) => Number(s.spesa)));
  const totCategorie = Math.max(1, ...(k?.categorie ?? []).map((c) => Number(c.spesa)));
  const daValidare = (k?.da_validare ?? 0) + (k?.master_in_bozza ?? 0);

  return (
    <>
      <InDiretta ristoranteId={attivo.id} inLavorazione={(k?.in_lavorazione ?? 0) > 0} />
      <Intestazione titolo="Panoramica" sottotitolo={<>{attivo.nome} · soglia rincari <span className="num">+{Number(attivo.soglia_anomalia_pct)}%</span></>}>
        {permessi.caricare && <Link href="/carica" className="btn btn-primary"><Upload className="size-3.5" />Carica documento</Link>}
      </Intestazione>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi etichetta="Spesa · 30 giorni" valore={moneyCompatto(k?.spesa_30g ?? 0)}
          nota={delta === null ? "Nessun confronto disponibile" : <><span className={cn("num", delta > 0 ? "text-warn" : "text-ok")}>{pct(delta)}</span> sui 30 giorni precedenti</>} />
        <Kpi etichetta="Rincari da gestire" valore={k?.rincari_aperti ?? 0} tono={k?.rincari_aperti ? "danger" : undefined} href="/anomalie"
          nota={k?.rincari_aperti ? <>Impatto <span className="num">{money(k.impatto_rincari)}</span></> : "Nessun rincaro oltre soglia"} />
        <Kpi etichetta="Risparmi · 90 giorni" valore={moneyCompatto(k?.risparmi_90g ?? 0)} tono={k?.risparmi_90g ? "ok" : undefined} nota="Prezzi scesi rispetto all'acquisto precedente" />
        <Kpi etichetta="Da validare" valore={daValidare} tono={daValidare ? "warn" : undefined} href="/validazione"
          nota={daValidare ? "Abbinamenti e nuovi articoli" : "Catalogo allineato"} />
        <Kpi etichetta="Documenti · 30 giorni" valore={k?.documenti_30g ?? 0}
          nota={<><span className="num">{k?.fornitori_attivi ?? 0}</span> fornitori attivi{k?.errori ? <> · <span className="text-danger">{k.errori} in errore</span></> : null}</>} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <section className="card p-4 lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[13px] font-medium">Spesa settimanale</h2>
            <p className="text-xs text-subtle">Imponibile fatture, in EUR · ultime 12 settimane</p>
          </div>
          <div className="mt-6 flex h-40 items-end gap-1.5" role="img" aria-label="Grafico della spesa settimanale">
            {settimane.map((s) => {
              const v = Number(s.spesa);
              return (
                <div key={s.inizio} className="group relative flex h-full flex-1 flex-col justify-end">
                  <div className={cn("w-full rounded-sm transition-colors duration-150", v > 0 ? "bg-fg/25 group-hover:bg-ok" : "bg-line")}
                    style={{ height: `${Math.max(v > 0 ? 4 : 1.5, (v / massimo) * 100)}%` }} />
                  <div className="pointer-events-none absolute -top-9 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-raised px-2 py-1 text-[11px] shadow-pop group-hover:block">
                    <span className="num font-medium">{money(v)}</span> <span className="text-subtle">· sett. del {data(s.inizio)}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-subtle">
            <span>{settimane[0] ? data(settimane[0].inizio) : ""}</span><span>Questa settimana</span>
          </div>
        </section>

        <section className="card p-4">
          <h2 className="text-[13px] font-medium">Spesa per categoria</h2>
          <p className="text-xs text-subtle">Ultimi 90 giorni</p>
          {k?.categorie?.length ? (
            <ul className="mt-4 space-y-3">
              {k.categorie.map((c) => (
                <li key={c.categoria}>
                  <div className="flex justify-between gap-3 text-xs">
                    <span className={cn("truncate", c.categoria === "Non classificato" && "text-subtle")}>{c.categoria}</span>
                    <span className="num text-muted">{money(c.spesa)}</span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-fg/40" style={{ width: `${(Number(c.spesa) / totCategorie) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : <Vuoto titolo="Ancora nessun dato">Le categorie compaiono quando gli articoli vengono abbinati al catalogo.</Vuoto>}
        </section>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-[13px] font-medium">Rincari da gestire</h2>
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
                    <p className="num w-20 text-right text-xs text-danger">{r.impatto_eur != null ? `+${money(r.impatto_eur)}` : "—"}</p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <Vuoto titolo="Nessun rincaro da gestire">I prezzi degli ultimi documenti sono in linea con gli acquisti precedenti.</Vuoto>}
        </section>

        <section className="card p-4">
          <h2 className="text-[13px] font-medium">Fornitori principali</h2>
          <p className="text-xs text-subtle">Ultimi 90 giorni</p>
          {k?.top_fornitori?.length ? (
            <ul className="mt-4 space-y-3">
              {k.top_fornitori.map((f) => (
                <li key={f.ragione_sociale} className="flex items-center justify-between gap-3 text-xs">
                  <span className="flex min-w-0 items-center gap-2"><span className="truncate">{f.ragione_sociale}</span><Paese codice={f.paese} /></span>
                  <span className="num whitespace-nowrap text-muted">{money(f.spesa)}</span>
                </li>
              ))}
            </ul>
          ) : <Vuoto titolo="Ancora nessun fornitore" />}
        </section>
      </div>

      <section className="card mt-3">
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <h2 className="text-[13px] font-medium">Documenti recenti</h2>
          <Link href="/documenti" className="flex items-center gap-1 text-xs text-muted hover:text-fg">Tutti <ArrowRight className="size-3" /></Link>
        </div>
        <TabellaDocumenti documenti={recenti ?? []}
          vuoto={<Vuoto titolo="Nessun documento">Carica la prima fattura o il primo DDT per iniziare a controllare i prezzi.</Vuoto>} />
      </section>
    </>
  );
}
