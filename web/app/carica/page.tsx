"use client";
import Link from "next/link";
import { useActionState } from "react";
import { caricaDocumento, type Esito } from "./actions";

export default function Carica() {
  const [esito, azione, inCorso] = useActionState<Esito | null, FormData>(caricaDocumento, null);
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Carica documento</h1>
        <p className="text-sm text-stone-500">Fattura XML (FatturaPA), PDF o foto di DDT, in italiano, francese o inglese.</p>
      </div>
      <form action={azione} className="space-y-4 rounded-xl border border-stone-200 bg-white p-6">
        <input type="file" name="file" required accept=".pdf,.xml,.jpg,.jpeg,.png,.webp,application/pdf,application/xml,text/xml,image/*"
          className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-stone-900 file:px-4 file:py-2 file:text-white" />
        <button disabled={inCorso} className="w-full rounded-md bg-amber-700 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50">
          {inCorso ? "Estrazione in corso con Claude…" : "Elabora documento"}
        </button>
      </form>
      {esito && (
        <div className={`rounded-xl p-4 text-sm ${!esito.ok ? "bg-red-50 text-red-700" : esito.n_anomalie ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
          <p>{esito.messaggio}</p>
          {esito.documento_id && <Link href={`/documenti/${esito.documento_id}`} className="mt-2 inline-block font-medium underline">Vedi dettaglio →</Link>}
        </div>
      )}
    </div>
  );
}
