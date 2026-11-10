"use client";
import { useActionState, useState, useTransition } from "react";
import type { Esito } from "@/lib/tipi";
import { accediEAccetta, accetta, registrati } from "./actions";

function Messaggio({ esito }: { esito: Esito<string> | null }) {
  if (!esito) return null;
  return <p role="status" aria-live="polite" className={esito.ok ? "text-[13px] text-ok" : "text-[13px] text-danger"}>{esito.ok ? esito.dati : esito.errore}</p>;
}

export function ModuliInvito({ token, email }: { token: string; email: string }) {
  const [haAccount, setHaAccount] = useState(false);
  const [nuovo, registra, r1] = useActionState(registrati.bind(null, token), null);
  const [esistente, accedi, r2] = useActionState(accediEAccetta.bind(null, token), null);
  return haAccount ? (
    <form action={accedi} className="space-y-4">
      <div><label className="label" htmlFor="e2">Email</label><input id="e2" className="input h-9" value={email} readOnly /></div>
      <div><label className="label" htmlFor="p2">La tua password</label><input id="p2" name="password" type="password" required autoComplete="current-password" className="input h-9" /></div>
      <Messaggio esito={esistente} />
      <button disabled={r2} className="btn btn-primary h-9 w-full">Accedi e accetta l&apos;invito</button>
      <button type="button" onClick={() => setHaAccount(false)} className="btn btn-ghost w-full">Non ho ancora un account</button>
    </form>
  ) : (
    <form action={registra} className="space-y-4">
      <div><label className="label" htmlFor="e1">Email</label><input id="e1" className="input h-9" value={email} readOnly aria-describedby="e1n" />
        <p id="e1n" className="mt-1 text-[11px] text-subtle">L&apos;invito vale solo per questo indirizzo.</p></div>
      <div><label className="label" htmlFor="p1">Scegli una password</label><input id="p1" name="password" type="password" required minLength={10} autoComplete="new-password" className="input h-9" aria-describedby="p1n" />
        <p id="p1n" className="mt-1 text-[11px] text-subtle">Almeno 10 caratteri. La conosci solo tu.</p></div>
      <div><label className="label" htmlFor="c1">Ripeti la password</label><input id="c1" name="conferma" type="password" required minLength={10} autoComplete="new-password" className="input h-9" /></div>
      <Messaggio esito={nuovo} />
      {!(nuovo?.ok) && <button disabled={r1} className="btn btn-primary h-9 w-full">Crea l&apos;account</button>}
      <button type="button" onClick={() => setHaAccount(true)} className="btn btn-ghost w-full">Ho già un account</button>
    </form>
  );
}

export function AccettaInvito({ token }: { token: string }) {
  const [inCorso, avvia] = useTransition();
  const [errore, setErrore] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {errore && <p role="alert" className="text-[13px] text-danger">{errore}</p>}
      <button disabled={inCorso} className="btn btn-primary h-9 w-full" onClick={() => avvia(async () => { const r = await accetta(token); if (r && !r.ok) setErrore(r.errore); })}>
        Accetta l&apos;invito
      </button>
    </div>
  );
}
