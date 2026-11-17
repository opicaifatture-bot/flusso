"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { esegui } from "@/lib/azioni";
import type { Allergene } from "@/lib/autocontrollo";

export type VoceMenu = { id?: string; nome: string; descrizione: string | null; prezzo: number | string; categoria: string; reparto: string; ricetta_id: string | null;
  allergeni: string[]; traduzioni: Record<string, { nome?: string; descrizione?: string }>; ordine: number; visibile: boolean };
const LINGUE = [["en", "Inglese"], ["fr", "Francese"], ["de", "Tedesco"], ["es", "Spagnolo"]] as const;

/** Crea o modifica una voce del menu, con traduzioni e allergeni (per le voci senza ricetta). */
export function ModuloVoce({ voce, ricette, allergeni }: { voce?: VoceMenu; ricette: { id: string; nome: string }[]; allergeni: Allergene[] }) {
  const router = useRouter();
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);
  const [inCorso, avvia] = useTransition();
  const p = voce?.id ?? "nuova";
  return (
    <form className="grid gap-3 sm:grid-cols-4" onSubmit={(e) => {
      e.preventDefault(); const fd = new FormData(e.currentTarget); const v = (k: string) => String(fd.get(k) ?? "").trim();
      const traduzioni: Record<string, { nome?: string; descrizione?: string }> = {};
      for (const [l] of LINGUE) { const n = v(`nome_${l}`), d = v(`descr_${l}`); if (n || d) traduzioni[l] = { ...(n && { nome: n }), ...(d && { descrizione: d }) }; }
      const prezzo = Number(v("prezzo").replace(",", "."));
      if (!(prezzo >= 0)) return setEsito({ ok: false, testo: "Prezzo non valido" });
      avvia(async () => {
        const r = await esegui("salva_voce_menu", { p_ristorante_id: "@sede", p_voce_id: voce?.id ?? null, p_dati: {
          nome: v("nome"), descrizione: v("descrizione"), prezzo, categoria: v("categoria"), reparto: v("reparto"), ricetta_id: v("ricetta_id") || null,
          ordine: Number(v("ordine") || 0), visibile: fd.get("visibile") === "on", allergeni: fd.getAll("allergeni"), traduzioni } });
        setEsito(r.ok ? { ok: true, testo: "Salvato" } : { ok: false, testo: r.errore }); if (r.ok) { if (!voce) e.currentTarget?.reset(); router.refresh(); }
      });
    }}>
      <div className="sm:col-span-2"><label className="label" htmlFor={`${p}-n`}>Nome (italiano)</label><input id={`${p}-n`} name="nome" required defaultValue={voce?.nome} className="input" /></div>
      <div><label className="label" htmlFor={`${p}-p`}>Prezzo (€)</label><input id={`${p}-p`} name="prezzo" required inputMode="decimal" defaultValue={voce ? String(voce.prezzo).replace(".", ",") : ""} className="input num" /></div>
      <div><label className="label" htmlFor={`${p}-c`}>Categoria</label><input id={`${p}-c`} name="categoria" required defaultValue={voce?.categoria ?? ""} placeholder="es. Antipasti" className="input" /></div>
      <div className="sm:col-span-4"><label className="label" htmlFor={`${p}-d`}>Descrizione</label><input id={`${p}-d`} name="descrizione" defaultValue={voce?.descrizione ?? ""} className="input" /></div>
      <div><label className="label" htmlFor={`${p}-r`}>Reparto</label><select id={`${p}-r`} name="reparto" defaultValue={voce?.reparto ?? "cucina"} className="input">
        {["cucina", "pasticceria", "bar", "pizzeria"].map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
      <div className="sm:col-span-2"><label className="label" htmlFor={`${p}-ric`}>Ricetta collegata (allergeni e food cost)</label><select id={`${p}-ric`} name="ricetta_id" defaultValue={voce?.ricetta_id ?? ""} className="input">
        <option value="">Nessuna</option>{ricette.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}</select></div>
      <div><label className="label" htmlFor={`${p}-o`}>Ordine</label><input id={`${p}-o`} name="ordine" type="number" defaultValue={voce?.ordine ?? 0} className="input num" /></div>
      <label className="flex items-center gap-2 text-[13px] sm:col-span-4"><input type="checkbox" name="visibile" defaultChecked={voce?.visibile ?? true} className="size-4" />Visibile ai clienti</label>
      <details className="sm:col-span-4"><summary className="cursor-pointer text-[13px] font-medium">Traduzioni</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">{LINGUE.map(([l, n]) => (
          <div key={l} className="space-y-1"><input aria-label={`Nome in ${n}`} name={`nome_${l}`} placeholder={`Nome in ${n.toLowerCase()}`} defaultValue={voce?.traduzioni?.[l]?.nome ?? ""} className="input" />
            <input aria-label={`Descrizione in ${n}`} name={`descr_${l}`} placeholder={`Descrizione in ${n.toLowerCase()}`} defaultValue={voce?.traduzioni?.[l]?.descrizione ?? ""} className="input" /></div>))}</div></details>
      <details className="sm:col-span-4"><summary className="cursor-pointer text-[13px] font-medium">Allergeni dichiarati (per voci senza ricetta, es. bevande)</summary>
        <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-4">{allergeni.map((a) => (
          <label key={a.codice} className="flex items-center gap-2 text-xs"><input type="checkbox" name="allergeni" value={a.codice} defaultChecked={voce?.allergeni.includes(a.codice)} className="size-4" />{a.nome}</label>))}</div>
        <p className="mt-1 text-[11px] text-subtle">Con una ricetta collegata gli allergeni si calcolano dalle schede dei prodotti; quelli spuntati qui si aggiungono.</p></details>
      <div className="flex items-center gap-3 sm:col-span-4"><button disabled={inCorso} className="btn btn-primary btn-sm">{voce ? "Salva" : "Aggiungi al menu"}</button>
        <span role="status" className={esito?.ok ? "text-xs text-ok" : "text-xs text-danger"}>{esito?.testo}</span></div>
    </form>
  );
}

/** Crea le voci di menu dai piatti con un prezzo di vendita, saltando quelli già presenti. */
export function ImportaRicette({ piatti }: { piatti: { id: string; nome: string; categoria: string | null; prezzo: number }[] }) {
  const router = useRouter();
  const [esito, setEsito] = useState<string | null>(null);
  const [inCorso, avvia] = useTransition();
  if (!piatti.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button disabled={inCorso} className="btn btn-sm" onClick={() => avvia(async () => {
        let n = 0;
        for (const r of piatti) { const x = await esegui("salva_voce_menu", { p_ristorante_id: "@sede", p_dati: { nome: r.nome, prezzo: r.prezzo, categoria: r.categoria ?? "Piatti", ricetta_id: r.id } }); if (x.ok) n++; }
        setEsito(`${n} piatti aggiunti al menu`); router.refresh();
      })}>Importa {piatti.length} piatti dalle ricette</button>
      {esito && <span className="text-xs text-ok">{esito}</span>}
    </span>
  );
}
