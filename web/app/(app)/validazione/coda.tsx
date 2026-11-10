"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Check, GitMerge, Sparkles, X } from "lucide-react";
import { cn, data as dataFmt, money, num } from "@/lib/format";
import { UNITA_BASE, type Esito, type Master } from "@/lib/tipi";
import { Badge, Paese, Vuoto } from "@/components/ui";
import { approvaMaster, confermaAbbinamento, creaMasterEConferma, rifiutaProposta, unisciMaster } from "./actions";

export type AliasInCoda = {
  id: string; descrizione_normalizzata: string; descrizione_originale: string | null; codice_articolo: string | null;
  unita_misura: string | null; stato_abbinamento: "da_abbinare" | "proposto"; confidenza: number | null;
  motivazione: string | null; master_proposto_id: string | null; fattore_proposto: number | null;
  ragione_sociale: string; paese: string | null; quantita: number | null; prezzo_unitario: number | null; valuta: string;
  documento_id: string; data_rilevazione: string;
};
export type Bozza = Master & { esempi: string[] };

const NUOVO = "__nuovo__";
const uscita = { opacity: 0, height: 0, marginTop: 0, transition: { duration: 0.25 } };

function leggiFattore(t: string): number | null {
  const n = Number(t.trim().replace(",", "."));
  return t.trim() && Number.isFinite(n) && n > 0 ? n : null;
}

function SchedaAlias({ a, master, categorie, puo, fatto }: {
  a: AliasInCoda; master: Master[]; categorie: string[]; puo: boolean; fatto: (id: string) => void;
}) {
  const [scelta, setScelta] = useState(a.master_proposto_id ?? (master.length ? "" : NUOVO));
  const [nome, setNome] = useState(a.descrizione_normalizzata);
  // Nessuna categoria predefinita: va scelta, altrimenti finirebbe sulla prima in ordine alfabetico.
  const [categoria, setCategoria] = useState("");
  const [unita, setUnita] = useState<string>(["kg", "lt", "pz"].includes(a.unita_misura ?? "") ? a.unita_misura! : "kg");
  const [fattore, setFattore] = useState(a.fattore_proposto ? String(a.fattore_proposto).replace(".", ",") : "");
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, avvia] = useTransition();

  const selezionato = master.find((m) => m.id === scelta);
  const base = scelta === NUOVO ? unita : selezionato?.unita_base;
  const serveFattore = !!base && !!a.unita_misura && base !== a.unita_misura
    && !(base === "kg" && a.unita_misura === "g") && !(base === "lt" && ["cl", "ml", "l"].includes(a.unita_misura));

  const esegui = (azione: () => Promise<Esito>) => avvia(async () => {
    setErrore(null);
    const r = await azione();
    if (r.ok) fatto(a.id); else setErrore(r.errore);
  });
  const conferma = () => {
    if (scelta === NUOVO) {
      if (!nome.trim()) return setErrore("Indica il nome dell'articolo");
      if (!categoria) return setErrore("Scegli la categoria del nuovo articolo");
      return esegui(() => creaMasterEConferma(a.id, { nome, categoria, unita }, leggiFattore(fattore)));
    }
    if (!scelta) return setErrore("Scegli un articolo del catalogo");
    esegui(() => confermaAbbinamento(a.id, scelta, leggiFattore(fattore)));
  };

  return (
    <div className="grid gap-4 p-4 md:grid-cols-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {a.stato_abbinamento === "proposto"
            ? <Badge tono="info"><Sparkles className="size-3" />Proposta IA{a.confidenza != null && <span className="num"> · {Math.round(a.confidenza * 100)}%</span>}</Badge>
            : <Badge tono="warn">Da abbinare</Badge>}
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted"><span className="truncate">{a.ragione_sociale}</span><Paese codice={a.paese} /></span>
        </div>
        <p className="mt-2 text-sm font-medium">{a.descrizione_normalizzata}</p>
        {a.descrizione_originale && a.descrizione_originale !== a.descrizione_normalizzata && <p className="text-xs italic text-subtle">{a.descrizione_originale}</p>}
        <p className="num mt-1.5 text-xs text-muted">
          {a.codice_articolo && <>cod. {a.codice_articolo} · </>}
          {num(a.quantita, 3)} {a.unita_misura} × {money(a.prezzo_unitario, a.valuta)}
          {" · "}<Link href={`/documenti/${a.documento_id}`} className="underline hover:text-fg">documento del {dataFmt(a.data_rilevazione)}</Link>
        </p>
        {a.stato_abbinamento === "proposto" && a.confidenza != null && a.confidenza < 0.7 && <p className="mt-1.5 text-xs text-warn">Confidenza bassa: verifica con attenzione.</p>}
        {a.motivazione && a.stato_abbinamento === "proposto" && <p className="mt-2 border-l-2 border-line pl-2.5 text-xs text-muted">{a.motivazione}</p>}
      </div>

      <div className="min-w-0 space-y-2.5">
        <div>
          <label className="label" htmlFor={`m-${a.id}`}>Articolo del catalogo</label>
          <select id={`m-${a.id}`} className="input" value={scelta} disabled={!puo} onChange={(e) => setScelta(e.target.value)}>
            <option value="" disabled>Scegli…</option>
            {master.map((m) => <option key={m.id} value={m.id}>{m.nome} · {m.unita_base}{m.stato === "bozza" ? " (bozza)" : ""}</option>)}
            <option value={NUOVO}>+ Nuovo articolo master…</option>
          </select>
        </div>
        {scelta === NUOVO && (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input className="input col-span-2" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome standard" aria-label="Nome del nuovo articolo" />
            <select className="input" value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoria" required>
              <option value="" disabled>Categoria…</option>
              {categorie.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select className="input w-20" value={unita} onChange={(e) => setUnita(e.target.value)} aria-label="Unità base">
              {UNITA_BASE.map((u) => <option key={u}>{u}</option>)}
            </select>
            <p className="col-span-2 text-[11px] text-subtle">Usa un nome generico, senza formato della confezione: «tanica 5 lt» e «bottiglia 0,75» sono lo stesso articolo.</p>
          </div>
        )}
        {serveFattore && (
          <div>
            <label className="label" htmlFor={`f-${a.id}`}>Quanti {base} contiene 1 {a.unita_misura}? <span className="font-normal text-subtle">(facoltativo)</span></label>
            <input id={`f-${a.id}`} className="input num w-28" inputMode="decimal" placeholder="es. 6" value={fattore} onChange={(e) => setFattore(e.target.value)} />
          </div>
        )}
        {errore && <p role="alert" className="text-xs text-danger">{errore}</p>}
        {puo && (
          <div className="flex gap-2 pt-0.5">
            <button disabled={inCorso} onClick={conferma} className="btn btn-ok"><Check className="size-3.5" />Conferma</button>
            {a.stato_abbinamento === "proposto" && (
              <button disabled={inCorso} onClick={() => esegui(() => rifiutaProposta(a.id))} className="btn btn-ghost"><X className="size-3.5" />Rifiuta proposta</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SchedaBozza({ b, altri, categorie, puo, fatto }: { b: Bozza; altri: Master[]; categorie: string[]; puo: boolean; fatto: (id: string) => void }) {
  const [nome, setNome] = useState(b.nome);
  const [categoria, setCategoria] = useState(b.categoria ?? categorie[0] ?? "");
  const [unita, setUnita] = useState(b.unita_base);
  const [verso, setVerso] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, avvia] = useTransition();
  const esegui = (azione: () => Promise<Esito>) => avvia(async () => {
    setErrore(null);
    const r = await azione();
    if (r.ok) fatto(b.id); else setErrore(r.errore);
  });

  return (
    <div className="grid gap-4 p-4 md:grid-cols-2">
      <div className="min-w-0">
        <Badge tono="warn">Nuovo articolo · bozza</Badge>
        <p className="mt-2 text-sm font-medium">{b.nome}</p>
        {b.esempi.length > 0 && <p className="mt-1 text-xs text-muted">Dalle righe: {b.esempi.slice(0, 3).join(" · ")}</p>}
      </div>
      <div className="space-y-2.5">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input className="input col-span-2" value={nome} disabled={!puo} onChange={(e) => setNome(e.target.value)} aria-label="Nome dell'articolo master" />
          <select className="input" value={categoria} disabled={!puo} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoria">
            {!categorie.includes(categoria) && <option>{categoria}</option>}
            {categorie.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className="input w-20" value={unita} disabled={!puo} onChange={(e) => setUnita(e.target.value)} aria-label="Unità base">
            {UNITA_BASE.map((u) => <option key={u}>{u}</option>)}
          </select>
        </div>
        {errore && <p role="alert" className="text-xs text-danger">{errore}</p>}
        {puo ? (
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={inCorso} onClick={() => esegui(() => approvaMaster(b.id, { nome, categoria, unita }))} className="btn btn-ok"><Check className="size-3.5" />Approva</button>
            {altri.length > 0 && (
              <>
                <span className="text-xs text-subtle">oppure</span>
                <select className="input w-52" value={verso} onChange={(e) => setVerso(e.target.value)} aria-label="Articolo di destinazione in cui unire questa bozza">
                  <option value="">Scegli l&apos;articolo di destinazione…</option>
                  {altri.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                </select>
                <button disabled={inCorso || !verso} title={verso ? undefined : "Scegli prima l'articolo di destinazione"} onClick={() => esegui(() => unisciMaster(b.id, verso))} className="btn"><GitMerge className="size-3.5" />Unisci</button>
              </>
            )}
          </div>
        ) : <p className="text-xs text-subtle">Solo il titolare può approvare i nuovi articoli del catalogo.</p>}
        {puo && verso && <p className="text-[11px] text-warn">Unendo, descrizioni e storico prezzi di «{b.nome}» passano a «{altri.find((m) => m.id === verso)?.nome}» e i confronti vengono ricalcolati. La bozza viene eliminata: non si può annullare.</p>}
      </div>
    </div>
  );
}

export function Coda({ alias, bozze, master, categorie, permessi }: {
  alias: AliasInCoda[]; bozze: Bozza[]; master: Master[]; categorie: string[]; permessi: { validare: boolean; approvare: boolean };
}) {
  const router = useRouter();
  const [nascosti, setNascosti] = useState<Set<string>>(new Set());
  const fatto = (id: string) => { setNascosti((s) => new Set(s).add(id)); router.refresh(); };
  // Prima i casi più incerti: senza proposta, poi per confidenza crescente.
  const vAlias = alias.filter((a) => !nascosti.has(a.id))
    .sort((x, y) => (x.confidenza ?? -1) - (y.confidenza ?? -1));
  const vBozze = bozze.filter((b) => !nascosti.has(b.id));

  if (!vAlias.length && !vBozze.length) {
    return <div className="card"><Vuoto titolo="Tutto validato">Ogni articolo dei documenti è collegato al catalogo. I prossimi casi incerti compariranno qui.</Vuoto></div>;
  }

  return (
    <div className="space-y-8">
      {vAlias.length > 0 && (
        <section>
          <h2 className="text-[13px] font-medium">Abbinamenti da confermare <span className="num text-subtle">· {vAlias.length}</span></h2>
          <p className="mt-0.5 text-xs text-muted">In ordine di incertezza. Confermando, la descrizione del fornitore resta collegata all&apos;articolo: i prossimi documenti si abbinano da soli e i prezzi vengono confrontati con lo storico di quell&apos;articolo. Dal catalogo il titolare può revocare.</p>
          <ul className="mt-3">
            <AnimatePresence initial={false}>
              {vAlias.map((a) => (
                <motion.li key={a.id} layout exit={uscita} className={cn("card mt-2 overflow-hidden")}>
                  <SchedaAlias a={a} master={master} categorie={categorie} puo={permessi.validare} fatto={fatto} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </section>
      )}
      {vBozze.length > 0 && (
        <section>
          <h2 className="text-[13px] font-medium">Nuovi articoli del catalogo <span className="num text-subtle">· {vBozze.length}</span></h2>
          <p className="mt-0.5 text-xs text-muted">Creati dall&apos;IA per prodotti mai visti. Controlla nome, categoria e unità base: valgono per tutte le sedi del gruppo. L&apos;unità base decide come si confrontano i prezzi (un articolo a kg comprato a pezzi richiede il peso). Approvando, l&apos;articolo diventa definitivo; si può correggere in seguito dal catalogo.</p>
          <ul className="mt-3">
            <AnimatePresence initial={false}>
              {vBozze.map((b) => (
                <motion.li key={b.id} layout exit={uscita} className="card mt-2 overflow-hidden">
                  <SchedaBozza b={b} altri={master.filter((m) => m.id !== b.id)} categorie={categorie} puo={permessi.approvare} fatto={fatto} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </section>
      )}
    </div>
  );
}
