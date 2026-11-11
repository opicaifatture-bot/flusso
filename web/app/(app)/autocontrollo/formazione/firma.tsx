"use client";
import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { esegui } from "@/lib/azioni";
import { CampiOperatore, TrattoFirma, type Persona } from "../operatore";

/** Firma annuale della policy di igiene: persona, PIN e tratto della firma. */
export function FirmaPolicy({ versione, persone }: { versione: string; persone: Persona[] }) {
  const router = useRouter();
  const [firma, setFirma] = useState("");
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);
  const [inCorso, avvia] = useTransition();
  const aggiorna = useCallback((s: string) => setFirma(s), []);
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => {
      e.preventDefault(); const fd = new FormData(e.currentTarget);
      avvia(async () => {
        const r = await esegui<{ ok: boolean; motivo?: string }>("firma_policy", { p_ristorante_id: "@sede", p_persona_id: fd.get("persona_id"), p_pin: fd.get("pin"), p_versione_id: versione, p_firma: firma });
        if (!r.ok) return setEsito({ ok: false, testo: r.errore });
        if (!r.dati?.ok) return setEsito({ ok: false, testo: r.dati?.motivo ?? "Firma non riuscita" });
        setEsito({ ok: true, testo: "Firmato: valido per un anno" }); router.refresh();
      });
    }}>
      <CampiOperatore persone={persone} obbligatorio id="firma" />
      <div className="sm:col-span-2"><p className="label">Firma</p><TrattoFirma onChange={aggiorna} /></div>
      <p className="text-[11px] text-subtle sm:col-span-2">Firmando dichiari di aver letto la policy. Vengono salvati: chi firma (verificato con il PIN), data e ora, il tratto della firma e l&apos;impronta digitale del documento, così è dimostrabile quale versione è stata firmata.</p>
      <div className="flex items-center gap-3 sm:col-span-2"><button disabled={inCorso} className="btn btn-primary">Firma</button><span role="status" className={esito?.ok ? "text-xs text-ok" : "text-xs text-danger"}>{esito?.testo}</span></div>
    </form>
  );
}
