"use client";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, ChevronDown, PencilLine } from "lucide-react";
import { cn, data as fmtData, money, num } from "@/lib/format";
import { TIPI_DOCUMENTO, UNITA, type Documento, type Riga } from "@/lib/tipi";
import { AnomaliaBadge, Badge, Paese, Variazione } from "@/components/ui";
import { AzioniAnomalia } from "@/components/azioni-anomalia";
import { controlloDocumento, controlloRiga, leggiNumero, motivoConfronto } from "@/lib/controlli";
import { correggiDocumento, correggiRiga } from "./actions";

type Valore = string | number | null;
type Permessi = { righe: boolean; documento: boolean; approvare: boolean; contestare: boolean };

/** Cella modificabile sul posto: clic per modificare, Invio o uscita per salvare, Esc per annullare. */
function Cella({ valore, mostra, tipo = "testo", opzioni, modificabile, salva, etichetta, allinea = "left", className }: {
  valore: Valore; mostra?: React.ReactNode; tipo?: "testo" | "numero" | "data"; opzioni?: readonly string[];
  modificabile: boolean; salva: (v: Valore) => Promise<string | null>; etichetta: string;
  allinea?: "left" | "right"; className?: string;
}) {
  const [attiva, setAttiva] = useState(false);
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const annullata = useRef(false);
  const testo = mostra ?? (valore === null || valore === "" ? "—" : String(valore));

  const conferma = async (grezzo: string) => {
    setAttiva(false);
    if (annullata.current) { annullata.current = false; return; }
    let nuovo: Valore = grezzo.trim() === "" ? null : grezzo.trim();
    if (tipo === "numero") {
      const n = leggiNumero(grezzo);
      if (n === undefined) { setErrore("Numero non valido"); return; }
      nuovo = n;
    }
    if (nuovo === valore || (nuovo === null && (valore === null || valore === ""))) return;
    setInCorso(true); setErrore(null);
    const esito = await salva(nuovo);
    setInCorso(false);
    if (esito) setErrore(esito);
  };

  if (!modificabile) return <span className={cn(allinea === "right" && "block text-right", className)}>{testo}</span>;

  if (attiva) {
    const comuni = {
      autoFocus: true, "aria-label": etichetta,
      className: cn("input h-7 px-1.5", allinea === "right" && "text-right", tipo === "numero" && "num", className),
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
        if (e.key === "Escape") { annullata.current = true; e.currentTarget.blur(); }
        if (e.key === "Enter") e.currentTarget.blur();
      },
    };
    if (opzioni) {
      return (
        <select {...comuni} defaultValue={valore === null ? "" : String(valore)}
          onChange={(e) => conferma(e.target.value)} onBlur={() => setAttiva(false)}>
          {(valore === null || !opzioni.includes(String(valore))) && <option value="">{valore ?? "—"}</option>}
          {opzioni.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    return (
      <input {...comuni} type={tipo === "data" ? "date" : "text"} inputMode={tipo === "numero" ? "decimal" : undefined}
        defaultValue={valore === null ? "" : tipo === "numero" ? String(valore).replace(".", ",") : String(valore)}
        onFocus={(e) => e.currentTarget.select()} onBlur={(e) => conferma(e.currentTarget.value)} />
    );
  }

  return (
    <button type="button" onClick={() => setAttiva(true)} title={errore ?? `Modifica ${etichetta.toLowerCase()}`}
      className={cn("-mx-1.5 block min-h-7 w-[calc(100%+0.75rem)] cursor-text rounded-md px-1.5 py-1 transition-colors duration-150 hover:bg-hover",
        allinea === "right" ? "text-right" : "text-left", inCorso && "opacity-50",
        errore && "ring-1 ring-danger", className)}>
      {testo}
    </button>
  );
}

function Campo({ etichetta, children }: { etichetta: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow mb-0.5">{etichetta}</p>
      <div className="text-[13px]">{children}</div>
    </div>
  );
}

export function Editor({ documento, righe: iniziali, permessi }: { documento: Documento; righe: Riga[]; permessi: Permessi }) {
  const router = useRouter();
  const [doc, setDoc] = useState(documento);
  const [righe, setRighe] = useState(iniziali);
  const [aperte, setAperte] = useState<Set<string>>(new Set());
  const [errore, setErrore] = useState<string | null>(null);
  const [salvato, setSalvato] = useState<string | null>(null);
  useEffect(() => setDoc(documento), [documento]);
  useEffect(() => setRighe(iniziali), [iniziali]);
  useEffect(() => {
    if (!errore) return;
    const t = setTimeout(() => setErrore(null), 8000);
    return () => clearTimeout(t);
  }, [errore]);
  useEffect(() => {
    if (!salvato) return;
    const t = setTimeout(() => setSalvato(null), 4000);
    return () => clearTimeout(t);
  }, [salvato]);

  // Aggiornamento ottimistico: la cella cambia subito, poi il server ricalcola prezzi e anomalie.
  const salvaRiga = (id: string, campo: keyof Riga) => async (valore: Valore) => {
    const prima = righe;
    setRighe((r) => r.map((x) => (x.id === id ? { ...x, [campo]: valore, corretto_manualmente: true } : x)));
    const esito = await correggiRiga(id, { [campo]: valore });
    if (!esito.ok) { setRighe(prima); setErrore(esito.errore); return esito.errore; }
    setSalvato("Riga salvata. Prezzo di confronto, variazioni e rincari sono stati ricalcolati.");
    router.refresh();
    return null;
  };
  const salvaDoc = (campo: keyof Documento) => async (valore: Valore) => {
    const prima = doc;
    setDoc((d) => ({ ...d, [campo]: valore, corretto_manualmente: true }));
    const esito = await correggiDocumento(doc.id, { [campo]: valore });
    if (!esito.ok) { setDoc(prima); setErrore(esito.errore); return esito.errore; }
    setSalvato(campo === "valuta" || campo === "data_documento"
      ? "Documento salvato. Controvalore in EUR e confronti di prezzo sono stati ricalcolati."
      : "Documento salvato. La modifica è nel registro di audit.");
    router.refresh();
    return null;
  };

  const f = doc.fornitori;
  const avvisi = controlloDocumento(doc, righe);
  // La colonna delle variazioni compare solo se almeno una riga ha un prezzo precedente con cui confrontarsi.
  const conVariazioni = righe.some((r) => r.variazione_pct != null);
  const colonne = conVariazioni ? 9 : 8;
  const alterna = (id: string) => setAperte((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-3">
      <AnimatePresence>
        {errore && (
          <motion.div role="alert" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger">{errore}</motion.div>
        )}
      </AnimatePresence>
      <p role="status" aria-live="polite" className={cn("flex items-center gap-2 rounded-lg border border-ok/25 bg-ok-soft px-3 py-2 text-[13px] text-ok transition-opacity duration-200", salvato ? "opacity-100" : "sr-only opacity-0")}>
        {salvato && <><Check className="size-3.5 shrink-0" aria-hidden />{salvato}</>}
      </p>

      <section className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Fornitore</p>
            <p className="mt-1 flex items-center gap-2 text-[15px] font-medium"><span className="truncate">{f?.ragione_sociale ?? "—"}</span><Paese codice={f?.paese} /></p>
            <p className="num mt-0.5 text-xs text-muted">
              {f?.partita_iva_o_estera ?? "P.IVA non indicata"}{f?.codice_identificativo_estero ? ` · ${f.codice_identificativo_estero}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {doc.corretto_manualmente && <Badge><PencilLine className="size-3" />Corretto a mano</Badge>}
            {doc.n_anomalie > 0 ? <Badge tono="danger">{doc.n_anomalie} {doc.n_anomalie === 1 ? "rincaro" : "rincari"}</Badge>
              : conVariazioni ? <Badge tono="ok">Prezzi entro la soglia</Badge> : <Badge>Nessun prezzo confrontabile</Badge>}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 sm:grid-cols-4">
          <Campo etichetta="Tipo"><Cella etichetta="Tipo" valore={doc.tipo} opzioni={TIPI_DOCUMENTO} modificabile={permessi.documento} salva={salvaDoc("tipo")} /></Campo>
          <Campo etichetta="Numero"><Cella etichetta="Numero" valore={doc.numero} modificabile={permessi.documento} salva={salvaDoc("numero")} className="num" /></Campo>
          <Campo etichetta="Data"><Cella etichetta="Data" tipo="data" valore={doc.data_documento} mostra={fmtData(doc.data_documento)} modificabile={permessi.documento} salva={salvaDoc("data_documento")} /></Campo>
          <Campo etichetta="Valuta"><Cella etichetta="Valuta" valore={doc.valuta} opzioni={["EUR", "CHF", "USD", "GBP"]} modificabile={permessi.documento} salva={salvaDoc("valuta")} className="num" /></Campo>
          <Campo etichetta="Imponibile"><Cella etichetta="Imponibile" tipo="numero" valore={doc.imponibile} mostra={money(doc.imponibile, doc.valuta)} modificabile={permessi.documento} salva={salvaDoc("imponibile")} className="num" /></Campo>
          <Campo etichetta="IVA"><Cella etichetta="IVA" tipo="numero" valore={doc.iva} mostra={money(doc.iva, doc.valuta)} modificabile={permessi.documento} salva={salvaDoc("iva")} className="num" /></Campo>
          <Campo etichetta="Totale"><Cella etichetta="Totale" tipo="numero" valore={doc.totale} mostra={money(doc.totale, doc.valuta)} modificabile={permessi.documento} salva={salvaDoc("totale")} className="num font-medium" /></Campo>
          <Campo etichetta="Controvalore">
            <span className="num block py-1 text-muted">
              {doc.valuta === "EUR" ? "—" : doc.totale_eur != null ? <>{money(doc.totale_eur)} <span className="text-subtle">· cambio BCE {num(doc.tasso_cambio, 4)}</span></> : "Cambio non ancora disponibile"}
            </span>
          </Campo>
        </div>
        {avvisi.map((a) => (
          <p key={a.tipo} className="mt-3 flex items-start gap-2 rounded-md border border-warn/25 bg-warn-soft px-2.5 py-1.5 text-xs text-warn">
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>{a.tipo === "somma_righe"
              ? <>La somma delle righe (<span className="num">{money(a.trovato, doc.valuta)}</span>) non coincide con l&apos;imponibile (<span className="num">{money(a.atteso, doc.valuta)}</span>).</>
              : <>Imponibile più IVA (<span className="num">{money(a.trovato, doc.valuta)}</span>) non coincide con il totale (<span className="num">{money(a.atteso, doc.valuta)}</span>).</>}
              {" "}Verifica sull&apos;originale e correggi il valore sbagliato.</span>
          </p>
        ))}
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-baseline justify-between px-4 pb-1 pt-3">
          <h2 className="text-[13px] font-medium">Righe estratte <span className="num text-subtle">· {righe.length}</span></h2>
          {permessi.righe && <p className="text-[11px] text-subtle">Clicca su un valore per correggerlo</p>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[660px] text-[13px]">
            <thead>
              <tr>
                <th className="th w-8 pr-0">#</th><th className="th">Articolo</th><th className="th text-right">Q.tà</th>
                <th className="th w-16">UM</th><th className="th text-right">Prezzo</th><th className="th text-right">Sc.%</th>
                <th className="th text-right">Totale</th>
                {conVariazioni && <th className="th text-right"><abbr title="Variazione del prezzo rispetto all'acquisto precedente dallo stesso fornitore, a parità di unità e valuta" className="no-underline">Var. prezzo</abbr></th>}
                <th className="th w-8"><span className="sr-only">Dettagli</span></th>
              </tr>
            </thead>
            <tbody>
              {righe.map((r) => {
                const aperta = aperte.has(r.id);
                const mod = permessi.righe;
                const controllo = controlloRiga(r);
                const motivo = motivoConfronto(r.confronto_esito, !!r.master_id);
                return (
                  <Fragment key={r.id}>
                    <tr className={cn("border-t border-line align-top transition-colors duration-200", r.anomalia_prezzo && "bg-danger-soft")}>
                      <td className="td num pr-0 pt-3.5 text-xs text-subtle">{r.numero_riga ?? ""}</td>
                      <td className="td">
                        <Cella etichetta="Descrizione" valore={r.descrizione} modificabile={mod} salva={salvaRiga(r.id, "descrizione")} className="font-medium" />
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-subtle">
                          {r.master_nome
                            ? <span className="inline-flex items-center gap-1 text-muted"><span className={cn("size-1.5 rounded-full", r.master_stato === "bozza" ? "bg-warn" : "bg-ok")} />{r.master_nome}{r.master_stato === "bozza" && " · bozza"}</span>
                            : <Link href="/validazione" className="inline-flex items-center gap-1 text-warn hover:underline"><span className="size-1.5 rounded-full bg-warn" />Da abbinare al catalogo</Link>}
                          {r.codice_articolo && <span className="num">cod. {r.codice_articolo}</span>}
                          {r.prezzo_base != null && r.unita_base && r.unita_base !== r.unita_misura && <span className="num">{money(r.prezzo_base, r.valuta)}/{r.unita_base}</span>}
                          {r.corretto_manualmente && <span className="inline-flex items-center gap-0.5"><PencilLine className="size-2.5" />corretta</span>}
                        </div>
                        {!controllo.ok && (
                          <p className="mt-1 flex items-start gap-1.5 text-[11px] text-warn">
                            <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
                            {controllo.tipo === "sconto_non_applicato"
                              ? <span>Lo sconto del {num(r.sconto_percentuale)}% non risulta applicato al totale (atteso {money(controllo.atteso, r.valuta)}). Se in fattura non c&apos;è, azzera lo sconto: il prezzo netto usato per i confronti cambia.</span>
                              : <span>Quantità × prezzo{r.sconto_percentuale ? " − sconto" : ""} dà {money(controllo.atteso, r.valuta)}, non {money(r.totale_riga, r.valuta)}.</span>}
                          </p>
                        )}
                        {r.descrizione_originale && r.descrizione_originale !== r.descrizione && <p className="mt-0.5 text-[11px] italic text-subtle">{r.descrizione_originale}</p>}
                      </td>
                      <td className="td"><Cella etichetta="Quantità" tipo="numero" allinea="right" valore={r.quantita} mostra={num(r.quantita, 3)} modificabile={mod} salva={salvaRiga(r.id, "quantita")} className="num" /></td>
                      <td className="td"><Cella etichetta="Unità di misura" valore={r.unita_misura} opzioni={UNITA} modificabile={mod} salva={salvaRiga(r.id, "unita_misura")} className="text-muted" /></td>
                      <td className="td"><Cella etichetta="Prezzo unitario" tipo="numero" allinea="right" valore={r.prezzo_unitario} mostra={money(r.prezzo_unitario, r.valuta)} modificabile={mod} salva={salvaRiga(r.id, "prezzo_unitario")} className="num" /></td>
                      <td className="td"><Cella etichetta="Sconto percentuale" tipo="numero" allinea="right" valore={r.sconto_percentuale} mostra={r.sconto_percentuale ? num(r.sconto_percentuale) : "—"} modificabile={mod} salva={salvaRiga(r.id, "sconto_percentuale")} className="num text-muted" /></td>
                      <td className="td"><Cella etichetta="Totale riga" tipo="numero" allinea="right" valore={r.totale_riga} mostra={money(r.totale_riga, r.valuta)} modificabile={mod} salva={salvaRiga(r.id, "totale_riga")} className="num" /></td>
                      {conVariazioni && (
                        <td className="td pt-3.5 text-right">
                          {r.variazione_pct != null ? <Variazione v={r.variazione_pct} anomalia={r.anomalia_prezzo} />
                            : <span className="text-xs text-subtle" title={motivo ?? undefined}>{r.confronto_esito === "primo_acquisto" ? "primo" : "n.c."}</span>}
                        </td>
                      )}
                      <td className="td px-1 pt-2.5">
                        <button type="button" onClick={() => alterna(r.id)} aria-expanded={aperta} aria-label="Dettagli della riga" className="btn btn-ghost btn-sm px-1">
                          <ChevronDown className={cn("size-3.5 transition-transform duration-200", aperta && "rotate-180")} />
                        </button>
                      </td>
                    </tr>
                    {r.anomalia_prezzo && (
                      <tr className="bg-danger-soft">
                        <td /><td colSpan={colonne - 1} className="px-3 pb-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="flex flex-wrap items-center gap-2 text-xs">
                              <AnomaliaBadge stato={r.anomalia_stato} />
                              <span className="num text-muted">
                                da {money(r.prezzo_precedente, r.valuta)} a <span className="text-fg">{money(r.prezzo_confronto, r.valuta)}</span>/{r.unita_confronto}
                              </span>
                              {r.anomalia_nota && <span className="text-muted">· «{r.anomalia_nota}»</span>}
                            </p>
                            <AzioniAnomalia rigaId={r.id} stato={r.anomalia_stato} puoApprovare={permessi.approvare} puoContestare={permessi.contestare} />
                          </div>
                        </td>
                      </tr>
                    )}
                    {aperta && (
                      <tr className={cn(r.anomalia_prezzo && "bg-danger-soft")}>
                        <td /><td colSpan={colonne - 1} className="px-3 pb-3">
                          <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-line bg-bg p-3 sm:grid-cols-5">
                            <Campo etichetta="Peso netto (kg)"><Cella etichetta="Peso netto in kg" tipo="numero" valore={r.peso_netto_kg} mostra={num(r.peso_netto_kg, 3)} modificabile={mod} salva={salvaRiga(r.id, "peso_netto_kg")} className="num" /></Campo>
                            <Campo etichetta="Contenuto per unità"><Cella etichetta="Contenuto per unità" tipo="numero" valore={r.contenuto_per_unita} mostra={num(r.contenuto_per_unita, 3)} modificabile={mod} salva={salvaRiga(r.id, "contenuto_per_unita")} className="num" /></Campo>
                            <Campo etichetta="Unità del contenuto"><Cella etichetta="Unità del contenuto" valore={r.unita_contenuto} opzioni={["kg", "g", "lt", "cl", "ml", "pz"]} modificabile={mod} salva={salvaRiga(r.id, "unita_contenuto")} /></Campo>
                            <Campo etichetta="IVA %"><Cella etichetta="Aliquota IVA" tipo="numero" valore={r.aliquota_iva} mostra={num(r.aliquota_iva)} modificabile={mod} salva={salvaRiga(r.id, "aliquota_iva")} className="num" /></Campo>
                            <Campo etichetta="Prezzo netto normalizzato">
                              <span className="num block py-1 text-muted">{r.prezzo_base != null ? `${money(r.prezzo_base, r.valuta)}/${r.unita_base}` : `${money(r.prezzo_netto, r.valuta)}/${r.unita_misura ?? "—"}`}</span>
                            </Campo>
                          </div>
                          <p className="mt-2 text-[11px] leading-relaxed text-subtle">
                            {r.master_unita_base && r.prezzo_base == null
                              ? <>L&apos;articolo del catalogo si misura in <span className="text-muted">{r.master_unita_base}</span>, questa riga è in <span className="text-muted">{r.unita_misura ?? "—"}</span>: per confrontarla indica il peso netto o il contenuto per unità. </>
                              : r.prezzo_base != null && r.unita_base !== r.unita_misura
                                ? <>Prezzo riportato da <span className="text-muted">{r.unita_misura}</span> a <span className="text-muted">{r.unita_base}</span> usando {r.peso_netto_kg ? "il peso netto" : r.fattore_conversione ? "il fattore di conversione dell'articolo" : r.contenuto_per_unita ? "il contenuto per unità" : "la conversione dell'unità"}. </>
                                : null}
                            {motivo ?? (r.variazione_pct != null && <>Confrontato con l&apos;acquisto precedente: {money(r.prezzo_precedente, r.valuta)}/{r.unita_confronto}.</>)}
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!righe.length && <tr><td colSpan={colonne} className="px-4 py-10 text-center text-[13px] text-muted">Nessuna riga con prezzo trovata in questo documento.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
