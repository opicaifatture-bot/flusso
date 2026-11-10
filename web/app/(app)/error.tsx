"use client";
import { useEffect } from "react";

export default function Errore({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="card mx-auto mt-16 max-w-md p-8 text-center" role="alert">
      <h1 className="text-base font-semibold">Qualcosa non ha funzionato</h1>
      <p className="mt-2 text-[13px] text-muted">La pagina non è stata caricata. I tuoi dati non sono stati modificati.</p>
      {error.digest && <p className="num mt-2 text-[11px] text-subtle">Riferimento: {error.digest}</p>}
      <button onClick={reset} className="btn btn-primary mt-5">Riprova</button>
    </div>
  );
}
