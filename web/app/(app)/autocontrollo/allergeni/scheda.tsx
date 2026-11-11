"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { esegui } from "@/lib/azioni";
import type { Allergene } from "@/lib/autocontrollo";

export type Info = { ingredienti: string | null; allergeni: string[]; tracce: string[]; fonte: string; archivio_id: string | null;
  energia_kj: number | null; energia_kcal: number | null; grassi: number | null; grassi_saturi: number | null; carboidrati: number | null; zuccheri: number | null; proteine: number | null; sale: number | null };
const NUTR: [keyof Info, string][] = [["energia_kj", "Energia (kJ)"], ["energia_kcal", "Energia (kcal)"], ["grassi", "Grassi (g)"], ["grassi_saturi", "di cui saturi (g)"],
  ["carboidrati", "Carboidrati (g)"], ["zuccheri", "di cui zuccheri (g)"], ["proteine", "Proteine (g)"], ["sale", "Sale (g)"]];

/** Scheda di un prodotto: allergeni, tracce, ingredienti e valori per 100 g, sempre con la fonte. */
export function SchedaProdotto({ master, info, allergeni, schede }: { master: string; info: Info | null; allergeni: Allergene[]; schede: { id: string; titolo: string }[] }) {
  const router = useRouter();
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);
  const [inCorso, avvia] = useTransition();
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault(); const fd = new FormData(e.currentTarget);
      const dati: Record<string, unknown> = { allergeni: fd.getAll("allergeni"), tracce: fd.getAll("tracce"), ingredienti: fd.get("ingredienti"), fonte: fd.get("fonte"), archivio_id: fd.get("archivio_id") || null };
      for (const [k] of NUTR) { const t = String(fd.get(k) ?? "").trim().replace(",", "."); if (t) { const n = Number(t); if (Number.isNaN(n) || n < 0) return setEsito({ ok: false, testo: "Valore nutrizionale non valido" }); dati[k] = n; } }
      avvia(async () => { const r = await esegui("salva_info_prodotto", { p_master_id: master, p_dati: dati }); setEsito(r.ok ? { ok: true, testo: "Scheda salvata" } : { ok: false, testo: r.errore }); if (r.ok) router.refresh(); });
    }}>
      <fieldset><legend className="label">Contiene</legend><div className="grid grid-cols-2 gap-1 sm:grid-cols-4">{allergeni.map((a) => (
        <label key={a.codice} className="flex items-center gap-2 text-xs"><input type="checkbox" name="allergeni" value={a.codice} defaultChecked={info?.allergeni.includes(a.codice)} className="size-4" />{a.nome}</label>))}</div></fieldset>
      <fieldset><legend className="label">Può contenere tracce di</legend><div className="grid grid-cols-2 gap-1 sm:grid-cols-4">{allergeni.map((a) => (
        <label key={a.codice} className="flex items-center gap-2 text-xs"><input type="checkbox" name="tracce" value={a.codice} defaultChecked={info?.tracce.includes(a.codice)} className="size-4" />{a.nome}</label>))}</div></fieldset>
      <div><label className="label" htmlFor={`ing-${master}`}>Ingredienti (come da scheda tecnica)</label><textarea id={`ing-${master}`} name="ingredienti" rows={2} defaultValue={info?.ingredienti ?? ""} className="input h-auto py-1.5" /></div>
      <fieldset><legend className="label">Valori medi per 100 g</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{NUTR.map(([k, n]) => (
        <div key={k}><label className="text-[11px] text-muted" htmlFor={`${k}-${master}`}>{n}</label><input id={`${k}-${master}`} name={k} inputMode="decimal" defaultValue={info?.[k] != null ? String(info[k]) : ""} className="input num" /></div>))}</div></fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor={`fonte-${master}`}>Fonte dei dati</label><select id={`fonte-${master}`} name="fonte" required defaultValue={info?.fonte ?? ""} className="input"><option value="" disabled>Scegli…</option><option value="scheda_tecnica">Scheda tecnica del fornitore</option><option value="etichetta">Etichetta del prodotto</option><option value="manuale">Inserimento manuale</option></select></div>
        <div><label className="label" htmlFor={`sch-${master}`}>Scheda tecnica (da Documenti)</label><select id={`sch-${master}`} name="archivio_id" defaultValue={info?.archivio_id ?? ""} className="input"><option value="">—</option>{schede.map((s) => <option key={s.id} value={s.id}>{s.titolo}</option>)}</select></div>
      </div>
      <div className="flex items-center gap-3"><button disabled={inCorso} className="btn btn-primary btn-sm">Salva la scheda</button><span role="status" className={esito?.ok ? "text-xs text-ok" : "text-xs text-danger"}>{esito?.testo}</span></div>
    </form>
  );
}
