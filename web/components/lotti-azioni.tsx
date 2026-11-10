"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { leggiNumero } from "@/lib/controlli";
import { esegui, leggi } from "@/lib/azioni";
import { data, num } from "@/lib/format";

export function AzioneQuantita({ lotto, tipo, etichetta, domanda, conMotivo }: { lotto: string; tipo: string; etichetta: string; domanda: string; conMotivo?: boolean }) {
  const router = useRouter();
  const [inCorso, avvia] = useTransition();
  const [errore, setErrore] = useState<string | null>(null);
  const vai = () => {
    const testo = window.prompt(domanda);
    if (testo === null) return;
    const q = leggiNumero(testo);
    if (!q || q <= 0) return setErrore("Quantità non valida");
    let motivo: string | null = null;
    if (conMotivo) {
      motivo = window.prompt("Motivo (obbligatorio, resta nel registro):");
      if (motivo === null) return;
      if (!motivo.trim()) return setErrore("Il motivo è obbligatorio");
    }
    avvia(async () => {
      // La chiave rende l'operazione ripetibile senza doppioni se la rete cade a metà.
      const r = await esegui("registra_movimento", { p_lotto_id: lotto, p_tipo: tipo, p_quantita: q, p_motivo: motivo, p_chiave: crypto.randomUUID() });
      setErrore(r.ok ? null : r.errore);
      if (r.ok) router.refresh();
    });
  };
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={inCorso} onClick={vai} className="btn btn-sm">{etichetta}</button>
      {errore && <span role="alert" className="text-xs text-danger">{errore}</span>}
    </span>
  );
}

type Riga = { lotto_id: string; codice_lotto: string | null; ubicazione: string | null; scadenza: string | null; ricevuto_il: string; unita: string; disponibile: number; da_prelevare: number | null; criterio: string; convertibile: boolean };

/** Suggerimento di prelievo: mostra quali lotti usare e con quale criterio. Non registra nulla. */
export function SuggerisciPrelievo({ articoli }: { articoli: { id: string; nome: string; unita: string }[] }) {
  const [righe, setRighe] = useState<Riga[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, avvia] = useTransition();
  return (
    <div>
      <form className="grid gap-3 sm:grid-cols-[1fr_8rem_6rem_auto] sm:items-end" onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget); const q = leggiNumero(String(f.get("q")));
        if (!q || q <= 0) return setErrore("Quantità non valida");
        avvia(async () => {
          const r = await leggi<Riga[]>("suggerisci_prelievo", { p_ristorante_id: "@sede", p_master_id: f.get("m"), p_quantita: q, p_unita: f.get("u") });
          setErrore(r.ok ? null : r.errore); setRighe(r.ok ? r.dati ?? [] : null);
        });
      }}>
        <div><label className="label" htmlFor="sp-m">Articolo</label><select id="sp-m" name="m" required className="input">{articoli.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}</select></div>
        <div><label className="label" htmlFor="sp-q">Quantità</label><input id="sp-q" name="q" required inputMode="decimal" className="input num" /></div>
        <div><label className="label" htmlFor="sp-u">Unità</label><select id="sp-u" name="u" className="input">{["kg", "g", "lt", "ml", "pz", "conf"].map((u) => <option key={u}>{u}</option>)}</select></div>
        <button disabled={inCorso} className="btn">Suggerisci</button>
      </form>
      {errore && <p role="alert" className="mt-2 text-xs text-danger">{errore}</p>}
      {righe && (righe.length ? (
        <ol className="mt-3 space-y-1.5 text-[13px]" aria-live="polite">
          {righe.map((r, i) => (
            <li key={r.lotto_id} className="flex flex-wrap items-center gap-x-3 rounded-md border border-line px-3 py-2">
              <span className="num text-subtle">{i + 1}.</span>
              <span className="flex-1">Lotto {r.codice_lotto ?? "senza codice"}{r.ubicazione ? ` · ${r.ubicazione}` : ""}</span>
              <span className="text-xs text-muted">{r.criterio === "FEFO" ? `FEFO · scade il ${data(r.scadenza)}` : `FIFO · arrivato il ${data(r.ricevuto_il)} (senza scadenza)`}</span>
              <span className="num">{r.convertibile ? <>prendi {num(r.da_prelevare, 3)} {r.unita}</> : <span className="text-warn">non convertibile: manca la conversione verso {r.unita}</span>}</span>
            </li>
          ))}
          <li className="text-[11px] text-subtle">Suggerimento automatico: nessun movimento è stato registrato. FEFO = prima ciò che scade prima; senza scadenza vale FIFO, prima ciò che è arrivato prima.</li>
        </ol>
      ) : <p className="mt-3 text-xs text-muted">Nessun lotto utilizzabile per questo articolo.</p>)}
    </div>
  );
}
