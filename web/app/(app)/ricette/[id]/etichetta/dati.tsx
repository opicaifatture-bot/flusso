"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { esegui } from "@/lib/azioni";
import type { Allergene } from "@/lib/autocontrollo";

export type DatiEtichetta = { denominazione: string | null; conservazione: string | null; modalita_uso: string | null; imballaggio: string | null; smaltimento: string | null;
  tracce_aggiuntive: string[]; peso_netto_g: number | null; durata_giorni: number | null };

export function ModuloEtichetta({ ricetta, valori, allergeni }: { ricetta: string; valori: DatiEtichetta; allergeni: Allergene[] }) {
  const router = useRouter();
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);
  const [inCorso, avvia] = useTransition();
  const campo = (k: keyof DatiEtichetta, et: string, aiuto?: string, num?: boolean) => (
    <div><label className="label" htmlFor={`et-${k}`}>{et}</label><input id={`et-${k}`} name={k} inputMode={num ? "decimal" : undefined} defaultValue={valori[k] == null ? "" : String(valori[k])} className={num ? "input num" : "input"} />
      {aiuto && <p className="mt-1 text-[11px] text-subtle">{aiuto}</p>}</div>
  );
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => {
      e.preventDefault(); const fd = new FormData(e.currentTarget); const v = (k: string) => String(fd.get(k) ?? "").trim();
      avvia(async () => {
        const r = await esegui("salva_dati_etichetta", { p_ricetta_id: ricetta, p_dati: { denominazione: v("denominazione"), conservazione: v("conservazione"), modalita_uso: v("modalita_uso"),
          imballaggio: v("imballaggio"), smaltimento: v("smaltimento"), peso_netto_g: v("peso_netto_g").replace(",", ".") || null, durata_giorni: v("durata_giorni") || null, tracce_aggiuntive: fd.getAll("tracce_aggiuntive") } });
        setEsito(r.ok ? { ok: true, testo: "Salvato" } : { ok: false, testo: r.errore }); if (r.ok) router.refresh();
      });
    }}>
      {campo("denominazione", "Denominazione di vendita")}{campo("peso_netto_g", "Peso netto (g)", undefined, true)}
      {campo("conservazione", "Modalità di conservazione")}{campo("durata_giorni", "Da consumarsi entro (giorni dalla preparazione)", "Dal manuale o dalle prove di conservabilità", true)}
      {campo("modalita_uso", "Modalità d'uso")}{campo("imballaggio", "Imballaggio", "Materiale e codice identificativo (es. PP 5)")}
      {campo("smaltimento", "Indicazioni di smaltimento", "Etichetta ambientale: es. «Vaschetta: plastica — raccolta plastica. Verifica le disposizioni del tuo comune»")}
      <fieldset className="sm:col-span-2"><legend className="label">Può contenere tracce di (contaminazione crociata in cucina)</legend>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">{allergeni.map((a) => <label key={a.codice} className="flex items-center gap-2 text-xs"><input type="checkbox" name="tracce_aggiuntive" value={a.codice} defaultChecked={valori.tracce_aggiuntive.includes(a.codice)} className="size-4" />{a.nome}</label>)}</div></fieldset>
      <div className="flex items-center gap-3 sm:col-span-2"><button disabled={inCorso} className="btn btn-primary btn-sm">Salva</button><span role="status" className={esito?.ok ? "text-xs text-ok" : "text-xs text-danger"}>{esito?.testo}</span></div>
    </form>
  );
}
