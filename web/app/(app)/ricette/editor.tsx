"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { leggiNumero } from "@/lib/controlli";
import { esegui } from "@/lib/azioni";

export type Ingrediente = { master_id: string | null; sotto_ricetta_id: string | null; quantita: string; unita: string; quantita_tipo: "lorda" | "netta"; resa_pct: string; resa_fonte: string };
export type RicettaIniziale = { id?: string; nome: string; tipo: "piatto" | "semilavorato"; categoria: string; codice_pos: string; porzioni: string; resa_quantita: string; resa_unita: string; prezzo_vendita: string; ingredienti: Ingrediente[] };
const VUOTO: Ingrediente = { master_id: null, sotto_ricetta_id: null, quantita: "", unita: "g", quantita_tipo: "lorda", resa_pct: "", resa_fonte: "" };
const UNITA = ["g", "kg", "ml", "cl", "lt", "pz", "conf"];

/** Editor di ricetta. Ogni salvataggio crea una nuova versione: la precedente resta archiviata. */
export function EditorRicetta({ iniziale, articoli, semilavorati }: { iniziale: RicettaIniziale; articoli: { id: string; nome: string; unita: string }[]; semilavorati: { id: string; nome: string }[] }) {
  const router = useRouter();
  const [r, setR] = useState(iniziale);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, avvia] = useTransition();
  const campo = (k: keyof RicettaIniziale) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setR({ ...r, [k]: e.target.value });
  const ing = (i: number, patch: Partial<Ingrediente>) => setR({ ...r, ingredienti: r.ingredienti.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  const salva = () => {
    const n = (t: string) => { const v = leggiNumero(t); return v == null ? NaN : v; };
    const ingredienti = r.ingredienti.filter((x) => x.master_id || x.sotto_ricetta_id).map((x) => ({
      master_id: x.master_id, sotto_ricetta_id: x.sotto_ricetta_id, quantita: n(x.quantita), unita: x.unita,
      quantita_tipo: x.quantita_tipo, resa_pct: x.quantita_tipo === "netta" ? n(x.resa_pct) : null, resa_fonte: x.resa_fonte || null,
    }));
    if (ingredienti.some((x) => !(Number(x.quantita) > 0))) return setErrore("Ogni ingrediente deve avere una quantità valida");
    if (ingredienti.some((x) => x.resa_pct !== null && Number.isNaN(x.resa_pct))) return setErrore("La resa deve essere un numero tra 1 e 100");
    if (iniziale.id && !window.confirm("Verrà creata una nuova versione della ricetta; quella attuale resta archiviata. Confermi?")) return;
    avvia(async () => {
      setErrore(null);
      const esito = await esegui<string>("salva_ricetta", {
        p_ristorante_id: "@sede", p_ricetta_id: iniziale.id ?? null,
        p_dati: { nome: r.nome, tipo: r.tipo, categoria: r.categoria, codice_pos: r.codice_pos, porzioni: n(r.porzioni), resa_quantita: n(r.resa_quantita), resa_unita: r.resa_unita, prezzo_vendita: n(r.prezzo_vendita), ingredienti },
      });
      if (!esito.ok) return setErrore(esito.errore);
      router.push(`/ricette/${esito.dati}`); router.refresh();
    });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); salva(); }} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2"><label className="label" htmlFor="r-nome">Nome</label><input id="r-nome" className="input" required value={r.nome} onChange={campo("nome")} /></div>
        <div><label className="label" htmlFor="r-tipo">Tipo</label><select id="r-tipo" className="input" value={r.tipo} onChange={campo("tipo")}><option value="piatto">Piatto</option><option value="semilavorato">Semilavorato</option></select></div>
        <div><label className="label" htmlFor="r-cat">Categoria</label><input id="r-cat" className="input" value={r.categoria} onChange={campo("categoria")} /></div>
        <div><label className="label" htmlFor="r-porz">Porzioni ottenute</label><input id="r-porz" className="input num" required inputMode="decimal" value={r.porzioni} onChange={campo("porzioni")} /></div>
        {r.tipo === "piatto" ? (
          <>
            <div><label className="label" htmlFor="r-prezzo">Prezzo per porzione (€, IVA esclusa)</label><input id="r-prezzo" className="input num" inputMode="decimal" value={r.prezzo_vendita} onChange={campo("prezzo_vendita")} /></div>
            <div><label className="label" htmlFor="r-pos">Codice sul sistema di cassa</label><input id="r-pos" className="input num" value={r.codice_pos} onChange={campo("codice_pos")} aria-describedby="r-pos-n" /><p id="r-pos-n" className="mt-1 text-[11px] text-subtle">Serve per importare le vendite.</p></div>
          </>
        ) : (
          <>
            <div><label className="label" htmlFor="r-resa">Quantità ottenuta</label><input id="r-resa" className="input num" required inputMode="decimal" value={r.resa_quantita} onChange={campo("resa_quantita")} /></div>
            <div><label className="label" htmlFor="r-resau">Unità</label><select id="r-resau" className="input" value={r.resa_unita} onChange={campo("resa_unita")}>{["kg", "g", "lt", "ml", "pz"].map((u) => <option key={u}>{u}</option>)}</select></div>
          </>
        )}
      </div>

      <fieldset>
        <legend className="mb-2 text-[13px] font-medium">Ingredienti</legend>
        <ul className="space-y-2">
          {r.ingredienti.map((x, i) => (
            <li key={i} className="grid gap-2 rounded-lg border border-line p-2 sm:grid-cols-[1fr_6rem_5rem_7rem_6rem_auto] sm:items-end">
              <div><label className="label" htmlFor={`i-a-${i}`}>Articolo o semilavorato</label>
                <select id={`i-a-${i}`} className="input" value={x.master_id ? `m:${x.master_id}` : x.sotto_ricetta_id ? `s:${x.sotto_ricetta_id}` : ""}
                  onChange={(e) => { const [t, id] = e.target.value.split(":"); ing(i, { master_id: t === "m" ? id : null, sotto_ricetta_id: t === "s" ? id : null }); }}>
                  <option value="">Scegli…</option>
                  <optgroup label="Catalogo">{articoli.map((a) => <option key={a.id} value={`m:${a.id}`}>{a.nome} (prezzo a {a.unita})</option>)}</optgroup>
                  {semilavorati.length > 0 && <optgroup label="Semilavorati">{semilavorati.filter((s) => s.id !== iniziale.id).map((s) => <option key={s.id} value={`s:${s.id}`}>{s.nome}</option>)}</optgroup>}
                </select></div>
              <div><label className="label" htmlFor={`i-q-${i}`}>Quantità</label><input id={`i-q-${i}`} className="input num" inputMode="decimal" value={x.quantita} onChange={(e) => ing(i, { quantita: e.target.value })} /></div>
              <div><label className="label" htmlFor={`i-u-${i}`}>Unità</label><select id={`i-u-${i}`} className="input" value={x.unita} onChange={(e) => ing(i, { unita: e.target.value })}>{UNITA.map((u) => <option key={u}>{u}</option>)}</select></div>
              <div><label className="label" htmlFor={`i-t-${i}`}>La quantità è</label><select id={`i-t-${i}`} className="input" value={x.quantita_tipo} onChange={(e) => ing(i, { quantita_tipo: e.target.value as "lorda" | "netta" })}><option value="lorda">lorda (acquistata)</option><option value="netta">netta (pulita)</option></select></div>
              <div><label className="label" htmlFor={`i-r-${i}`}>Resa %</label><input id={`i-r-${i}`} className="input num" inputMode="decimal" disabled={x.quantita_tipo === "lorda"} value={x.quantita_tipo === "lorda" ? "" : x.resa_pct} placeholder={x.quantita_tipo === "netta" ? "serve" : "—"} onChange={(e) => ing(i, { resa_pct: e.target.value })} /></div>
              <button type="button" className="btn btn-ghost btn-sm px-1.5" aria-label={`Togli l'ingrediente ${i + 1}`} onClick={() => setR({ ...r, ingredienti: r.ingredienti.filter((_, j) => j !== i) })}><Trash2 className="size-3.5" /></button>
              {x.quantita_tipo === "netta" && <div className="sm:col-span-6"><label className="label" htmlFor={`i-f-${i}`}>Da dove viene la resa</label><input id={`i-f-${i}`} className="input" value={x.resa_fonte} placeholder="es. prova di cucina del 3 marzo" onChange={(e) => ing(i, { resa_fonte: e.target.value })} /></div>}
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-sm mt-2" onClick={() => setR({ ...r, ingredienti: [...r.ingredienti, { ...VUOTO }] })}><Plus className="size-3.5" />Aggiungi ingrediente</button>
        <p className="mt-2 text-[11px] leading-relaxed text-subtle">Se indichi la quantità netta serve la resa (peso pulito ÷ peso acquistato): l&apos;app non applica rese standard. Senza resa, o senza una conversione tra l&apos;unità della ricetta e quella di acquisto, il costo risulta incompleto e dice cosa manca.</p>
      </fieldset>
      {errore && <p role="alert" className="text-xs text-danger">{errore}</p>}
      <button disabled={inCorso} className="btn btn-primary">{inCorso ? "Salvataggio…" : iniziale.id ? "Salva come nuova versione" : "Crea ricetta"}</button>
    </form>
  );
}

/** Import delle vendite da CSV (esportazione della cassa): data;codice o nome;quantità;servizio. Ogni riga ha una chiave: reimportare lo stesso file non duplica. */
export function ImportVendite({ ricette }: { ricette: { id: string; nome: string; codice_pos: string | null }[] }) {
  const router = useRouter();
  const [esito, setEsito] = useState<string | null>(null);
  const [inCorso, avvia] = useTransition();
  const importa = (testo: string) => avvia(async () => {
    let ok = 0; const errori: string[] = [];
    const righe = testo.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const [i, linea] of righe.entries()) {
      const c = linea.split(/[;,\t]/).map((x) => x.trim());
      if (i === 0 && !/^\d{4}-\d{2}-\d{2}$/.test(c[0])) continue;   // intestazione
      const ricetta = ricette.find((x) => (x.codice_pos && x.codice_pos === c[1]) || x.nome.toLowerCase() === c[1]?.toLowerCase());
      const q = leggiNumero(c[2] ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c[0]) || !ricetta || !q || q <= 0) { errori.push(`riga ${i + 1}: ${!ricetta ? "piatto non riconosciuto" : "data o quantità non valida"}`); continue; }
      const servizio = ["pranzo", "cena"].includes(c[3]?.toLowerCase()) ? c[3].toLowerCase() : null;
      const r = await esegui("registra_vendita", { p_ristorante_id: "@sede", p_ricetta_id: ricetta.id, p_giorno: c[0], p_quantita: q, p_servizio: servizio, p_fonte: "import", p_chiave: `csv:${c[0]}:${ricetta.id}:${servizio ?? "-"}` });
      if (r.ok) ok++; else errori.push(`riga ${i + 1}: ${r.errore}`);
    }
    setEsito(`${ok} righe importate${errori.length ? ` · ${errori.length} scartate: ${errori.slice(0, 5).join("; ")}` : ""}`);
    router.refresh();
  });
  return (
    <div>
      <label className="label" htmlFor="csv">File CSV delle vendite</label>
      <input id="csv" type="file" accept=".csv,text/csv,text/plain" disabled={inCorso} className="block text-xs file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-fg"
        onChange={async (e) => { const f = e.target.files?.[0]; if (f) importa(await f.text()); e.target.value = ""; }} />
      <p className="mt-2 text-[11px] leading-relaxed text-subtle">Formato: <span className="num">AAAA-MM-GG;codice o nome del piatto;quantità;pranzo|cena</span>. Una riga per piatto, giorno e servizio. Nessun sistema di cassa è collegato direttamente: l&apos;import da file è l&apos;unico canale oggi attivo.</p>
      {esito && <p role="status" aria-live="polite" className="mt-2 text-xs text-muted">{esito}</p>}
    </div>
  );
}
