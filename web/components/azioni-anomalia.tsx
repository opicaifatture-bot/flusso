"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, MessageSquareWarning, Undo2 } from "lucide-react";
import type { StatoAnomalia } from "@/lib/tipi";
import { gestisciAnomalia } from "@/app/(app)/documenti/[id]/actions";

/** Approva (solo titolare), contesta con nota, oppure riapre un rincaro. */
export function AzioniAnomalia({ rigaId, stato, puoApprovare, puoContestare }: {
  rigaId: string; stato: StatoAnomalia | null; puoApprovare: boolean; puoContestare: boolean;
}) {
  const router = useRouter();
  const [inCorso, avvia] = useTransition();
  const [nota, setNota] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  const imposta = (nuovo: StatoAnomalia, testo?: string) => avvia(async () => {
    setErrore(null);
    const r = await gestisciAnomalia(rigaId, nuovo, testo);
    if (!r.ok) setErrore(r.errore);
    else { setNota(null); router.refresh(); }
  });

  if (!puoApprovare && !puoContestare) return null;

  if (nota !== null) {
    return (
      <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); imposta("contestata", nota); }}>
        <input autoFocus value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Motivo (facoltativo)" aria-label="Motivo della contestazione"
          className="input h-7 w-44 text-xs" onKeyDown={(e) => e.key === "Escape" && setNota(null)} />
        <button disabled={inCorso} className="btn btn-sm btn-danger">Contesta</button>
        <button type="button" onClick={() => setNota(null)} className="btn btn-sm btn-ghost">Annulla</button>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {errore && <span role="alert" className="text-xs text-danger">{errore}</span>}
      {(stato ?? "aperta") === "aperta" ? (
        <>
          {puoApprovare && <button disabled={inCorso} onClick={() => imposta("accettata")} className="btn btn-sm btn-ok"><Check className="size-3" />Approva</button>}
          {puoContestare && <button disabled={inCorso} onClick={() => setNota("")} className="btn btn-sm"><MessageSquareWarning className="size-3" />Contesta</button>}
        </>
      ) : (
        puoContestare && (stato !== "accettata" || puoApprovare) &&
          <button disabled={inCorso} onClick={() => imposta("aperta")} className="btn btn-sm btn-ghost"><Undo2 className="size-3" />Riapri</button>
      )}
    </div>
  );
}
