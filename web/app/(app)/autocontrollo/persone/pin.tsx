"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { esegui } from "@/lib/azioni";

/** Imposta il PIN di una persona. Il PIN non viene mostrato né salvato in chiaro. */
export function ImpostaPin({ persona, nome, haPin }: { persona: string; nome: string; haPin: boolean }) {
  const router = useRouter();
  const [aperto, setAperto] = useState(false);
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);
  const [inCorso, avvia] = useTransition();
  if (!aperto) return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="btn btn-sm" onClick={() => setAperto(true)}>{haPin ? "Reimposta PIN" : "Imposta PIN"}</button>
      {esito && <span role="status" className={esito.ok ? "text-xs text-ok" : "text-xs text-danger"}>{esito.testo}</span>}
    </span>
  );
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
      e.preventDefault(); const fd = new FormData(e.currentTarget);
      const pin = String(fd.get("pin") ?? ""), conferma = String(fd.get("conferma") ?? "");
      if (pin !== conferma) return setEsito({ ok: false, testo: "I due PIN non coincidono" });
      avvia(async () => {
        const r = await esegui("imposta_pin", { p_persona_id: persona, p_pin: pin });
        setEsito(r.ok ? { ok: true, testo: "PIN impostato" } : { ok: false, testo: r.errore });
        if (r.ok) { setAperto(false); router.refresh(); }
      });
    }}>
      <div><label className="label" htmlFor={`pin-${persona}`}>Nuovo PIN per {nome}</label><input id={`pin-${persona}`} name="pin" type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4,8}" required className="input num w-32" /></div>
      <div><label className="label" htmlFor={`pin2-${persona}`}>Ripeti</label><input id={`pin2-${persona}`} name="conferma" type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4,8}" required className="input num w-32" /></div>
      <button disabled={inCorso} className="btn btn-sm btn-primary">Salva</button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAperto(false)}>Annulla</button>
      {esito && <span role="status" className={esito.ok ? "text-xs text-ok" : "text-xs text-danger"}>{esito.testo}</span>}
    </form>
  );
}
