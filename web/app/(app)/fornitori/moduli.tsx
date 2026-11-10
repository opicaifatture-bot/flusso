"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { leggiNumero } from "@/lib/controlli";
import { data, money, num } from "@/lib/format";
import { esegui, leggi } from "@/lib/azioni";

type Voce = { id: string; nome: string };
const INDICATORI = [["puntualita", "Puntualità"], ["completezza", "Completezza"], ["conformita", "Conformità"], ["prezzi", "Stabilità dei prezzi"]] as const;

/** Pesi e campione minimo della valutazione: li decide il titolare, l'app non ne propone di "giusti". */
export function ConfigScorecard({ config }: { config: { campione_minimo: number; pesi: Record<string, number> } }) {
  const router = useRouter();
  const [inCorso, avvia] = useTransition();
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);
  return (
    <form className="grid gap-3 sm:grid-cols-5" onSubmit={(e) => {
      e.preventDefault(); const fd = new FormData(e.currentTarget);
      const pesi: Record<string, number> = {};
      for (const [k, nome] of INDICATORI) { const v = leggiNumero(String(fd.get(k) ?? "")); if (v == null || v < 0) return setEsito({ ok: false, testo: `${nome}: peso non valido` }); pesi[k] = v; }
      const campione = leggiNumero(String(fd.get("campione") ?? ""));
      if (!campione || campione < 1) return setEsito({ ok: false, testo: "Il campione minimo deve essere almeno 1" });
      avvia(async () => {
        const r = await esegui("imposta_scorecard", { p_gruppo_id: "@gruppo", p_config: { campione_minimo: Math.round(campione), pesi } });
        setEsito(r.ok ? { ok: true, testo: "Salvato" } : { ok: false, testo: r.errore }); if (r.ok) router.refresh();
      });
    }}>
      {INDICATORI.map(([k, nome]) => (
        <div key={k}><label className="label" htmlFor={`sc-${k}`}>Peso · {nome}</label><input id={`sc-${k}`} name={k} className="input num" inputMode="decimal" required defaultValue={String(config.pesi?.[k] ?? 1).replace(".", ",")} /></div>
      ))}
      <div><label className="label" htmlFor="sc-campione">Consegne minime</label><input id="sc-campione" name="campione" className="input num" inputMode="numeric" required defaultValue={config.campione_minimo} /></div>
      <div className="flex items-center gap-3 sm:col-span-5">
        <button disabled={inCorso} className="btn btn-primary">{inCorso ? "Attendere…" : "Salva i criteri"}</button>
        <p role="status" aria-live="polite" className={esito?.ok ? "text-xs text-ok" : "text-xs text-danger"}>{esito?.testo}</p>
      </div>
      <p className="text-[11px] leading-relaxed text-subtle sm:col-span-5">Peso 0 esclude un indicatore dal punteggio. Sotto il numero minimo di consegne registrate il punteggio non viene calcolato. La modifica vale per tutto il gruppo ed è registrata nell&apos;audit.</p>
    </form>
  );
}

type Confronto = { fornitore_id: string; ragione_sociale: string; paese: string | null; prezzo: number | null; unita: string | null; valuta: string; prezzo_eur: number | null; tasso_cambio: number | null; data: string | null; documento_id: string; numero: string | null; confrontabile: boolean; n_acquisti: number };

/** Confronto tra fornitori sullo stesso articolo master: ultimo prezzo netto effettivamente fatturato alla sede. */
export function ConfrontoFornitori({ articoli }: { articoli: Voce[] }) {
  const [righe, setRighe] = useState<Confronto[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, avvia] = useTransition();
  return (
    <div>
      <label className="label" htmlFor="cf-art">Articolo del catalogo</label>
      <select id="cf-art" className="input max-w-md" defaultValue="" disabled={inCorso} onChange={(e) => { const id = e.target.value; if (!id) return setRighe(null);
        avvia(async () => { const r = await leggi<Confronto[]>("confronta_fornitori", { p_ristorante_id: "@sede", p_master_id: id }); if (r.ok) { setRighe(r.dati ?? []); setErrore(null); } else setErrore(r.errore); }); }}>
        <option value="">Scegli…</option>{articoli.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
      </select>
      {errore && <p role="alert" className="mt-2 text-xs text-danger">{errore}</p>}
      <div aria-live="polite">
        {righe && (righe.length ? (
          <table className="mt-3 w-full text-[13px]">
            <thead><tr><th scope="col" className="th">Fornitore</th><th scope="col" className="th text-right">Ultimo prezzo netto</th><th scope="col" className="th">Fonte</th><th scope="col" className="th text-right">Acquisti</th></tr></thead>
            <tbody>{righe.map((x) => (
              <tr key={x.fornitore_id} className="riga">
                <td className="td">{x.ragione_sociale}{x.paese && <span className="text-xs text-subtle"> · {x.paese}</span>}</td>
                <td className="td num text-right">{x.prezzo_eur != null ? <>{money(x.prezzo_eur, "EUR", 4)}/{x.unita}{x.valuta !== "EUR" && <span className="block text-xs text-subtle">{money(x.prezzo, x.valuta, 4)} · cambio BCE {num(x.tasso_cambio, 4)}</span>}</> : <span className="text-warn">non confrontabile: manca l&apos;unità base o il cambio</span>}</td>
                <td className="td text-xs"><Link className="underline" href={`/documenti/${x.documento_id}`}>{x.numero ?? "s.n."} del {data(x.data)}</Link></td>
                <td className="td num text-right">{x.n_acquisti}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p className="mt-3 text-xs text-muted">Nessun acquisto di questo articolo nella sede.</p>)}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-subtle">Prezzi di date diverse non sono direttamente equivalenti: controlla la data di ciascuna fattura. Il confronto non considera qualità, pezzatura o condizioni di consegna.</p>
    </div>
  );
}

type RigaOrdine = { master_id: string; quantita: string; unita: string; nota: string };
const UNITA = ["kg", "g", "lt", "ml", "pz", "conf", "cartone"];

/** Proposta d'ordine: resta in bozza finché il titolare non la approva. L'app non la invia al fornitore. */
export function ProponiOrdine({ fornitori, articoli }: { fornitori: Voce[]; articoli: Voce[] }) {
  const router = useRouter();
  const [fornitore, setFornitore] = useState("");
  const [nota, setNota] = useState("");
  const [righe, setRighe] = useState<RigaOrdine[]>([{ master_id: "", quantita: "", unita: "kg", nota: "" }]);
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);
  const [inCorso, avvia] = useTransition();
  const riga = (i: number, p: Partial<RigaOrdine>) => setRighe(righe.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const invia = () => {
    const out: Record<string, unknown>[] = [];
    for (const x of righe.filter((r) => r.master_id)) {
      const q = leggiNumero(x.quantita);
      if (!q || q <= 0) return setEsito({ ok: false, testo: "Ogni riga deve avere una quantità valida" });
      out.push({ master_id: x.master_id, articolo: articoli.find((a) => a.id === x.master_id)?.nome ?? "", quantita: q, unita: x.unita, nota: x.nota.trim() || null });
    }
    if (!out.length) return setEsito({ ok: false, testo: "Aggiungi almeno una riga" });
    avvia(async () => {
      const r = await esegui("proponi_ordine", { p_ristorante_id: "@sede", p_fornitore_id: fornitore, p_righe: out, p_nota: nota });
      if (!r.ok) return setEsito({ ok: false, testo: r.errore });
      setEsito({ ok: true, testo: "Proposta salvata in bozza" }); setRighe([{ master_id: "", quantita: "", unita: "kg", nota: "" }]); setNota(""); router.refresh();
    });
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); invia(); }} className="space-y-3">
      <div className="max-w-md"><label className="label" htmlFor="po-f">Fornitore</label>
        <select id="po-f" className="input" required value={fornitore} onChange={(e) => setFornitore(e.target.value)}><option value="" disabled>Scegli…</option>{fornitori.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></div>
      <ul className="space-y-2">{righe.map((x, i) => (
        <li key={i} className="grid gap-2 rounded-lg border border-line p-2 sm:grid-cols-[1fr_6rem_6rem_1fr_auto] sm:items-end">
          <div><label className="label" htmlFor={`po-a-${i}`}>Articolo</label><select id={`po-a-${i}`} className="input" value={x.master_id} onChange={(e) => riga(i, { master_id: e.target.value })}><option value="">Scegli…</option>{articoli.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}</select></div>
          <div><label className="label" htmlFor={`po-q-${i}`}>Quantità</label><input id={`po-q-${i}`} className="input num" inputMode="decimal" value={x.quantita} onChange={(e) => riga(i, { quantita: e.target.value })} /></div>
          <div><label className="label" htmlFor={`po-u-${i}`}>Unità</label><select id={`po-u-${i}`} className="input" value={x.unita} onChange={(e) => riga(i, { unita: e.target.value })}>{UNITA.map((u) => <option key={u}>{u}</option>)}</select></div>
          <div><label className="label" htmlFor={`po-n-${i}`}>Nota</label><input id={`po-n-${i}`} className="input" value={x.nota} onChange={(e) => riga(i, { nota: e.target.value })} /></div>
          <button type="button" className="btn btn-ghost btn-sm px-1.5" aria-label={`Togli la riga ${i + 1}`} onClick={() => setRighe(righe.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></button>
        </li>
      ))}</ul>
      <button type="button" className="btn btn-sm" onClick={() => setRighe([...righe, { master_id: "", quantita: "", unita: "kg", nota: "" }])}><Plus className="size-3.5" />Aggiungi riga</button>
      <div className="max-w-md"><label className="label" htmlFor="po-nota">Nota per chi approva <span className="font-normal text-subtle">· facoltativo</span></label><input id="po-nota" className="input" value={nota} onChange={(e) => setNota(e.target.value)} /></div>
      <div className="flex items-center gap-3"><button disabled={inCorso} className="btn btn-primary">{inCorso ? "Attendere…" : "Salva la proposta"}</button><p role="status" aria-live="polite" className={esito?.ok ? "text-xs text-ok" : "text-xs text-danger"}>{esito?.testo}</p></div>
      <p className="text-[11px] leading-relaxed text-subtle">Le quantità le decidi tu: l&apos;app non le calcola. La proposta non viene inviata al fornitore, né in bozza né dopo l&apos;approvazione.</p>
    </form>
  );
}
