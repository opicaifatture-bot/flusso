"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw, Trash2 } from "lucide-react";
import { cn } from "@/lib/format";
import type { Documento } from "@/lib/tipi";
import { eliminaDocumento, riprovaDocumento } from "../../carica/actions";

const PASSI = [
  { chiave: "in_coda", titolo: "In coda", testo: "File ricevuto nell'archivio protetto" },
  { chiave: "estrazione", titolo: "Estrazione", testo: "Lettura del documento con l'IA" },
  { chiave: "abbinamento", titolo: "Abbinamento", testo: "Collegamento degli articoli al catalogo master" },
  { chiave: "completato", titolo: "Completato", testo: "Controllo dei prezzi" },
];

export function StatoElaborazione({ documento, puoRiprovare, puoEliminare }: { documento: Documento; puoRiprovare: boolean; puoEliminare: boolean }) {
  const router = useRouter();
  const [inCorso, avvia] = useTransition();
  const [errore, setErrore] = useState<string | null>(null);
  const { stato, fase } = documento;

  if (stato === "errore" || stato === "duplicato") {
    return (
      <div className="card p-6">
        <p className={cn("text-sm font-medium", stato === "errore" ? "text-danger" : "text-warn")}>
          {stato === "errore" ? "Elaborazione non riuscita" : "Documento già presente"}
        </p>
        <p className="mt-1.5 text-[13px] text-muted">{documento.errore}</p>
        {errore && <p role="alert" className="mt-2 text-[13px] text-danger">{errore}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          {stato === "duplicato" && documento.duplicato_di && <Link href={`/documenti/${documento.duplicato_di}`} className="btn btn-primary">Apri il documento originale</Link>}
          {stato === "errore" && puoRiprovare && (
            <button disabled={inCorso} className="btn btn-primary"
              onClick={() => avvia(async () => { setErrore(null); const r = await riprovaDocumento(documento.id); if (!r.ok) setErrore(r.errore); router.refresh(); })}>
              <RotateCw className="size-3.5" />Riprova
            </button>
          )}
          {puoEliminare && (
            <button disabled={inCorso} className="btn"
              onClick={() => avvia(async () => { const r = await eliminaDocumento(documento.id); if (!r.ok) setErrore(r.errore); else router.push("/documenti"); })}>
              <Trash2 className="size-3.5" />Elimina
            </button>
          )}
        </div>
      </div>
    );
  }

  const corrente = stato === "in_coda" ? 0 : fase === "abbinamento" ? 2 : 1;
  return (
    <div className="card p-6">
      <p className="text-sm font-medium">Documento in elaborazione</p>
      <p className="mt-1 text-[13px] text-muted">Di solito bastano pochi secondi. Puoi lasciare questa pagina: l&apos;elaborazione continua in background.</p>
      <ol className="mt-6 space-y-4">
        {PASSI.map((p, i) => (
          <li key={p.chiave} className="flex items-start gap-3">
            <span className={cn("mt-1 size-2.5 shrink-0 rounded-full transition-colors duration-300",
              i < corrente ? "bg-ok" : i === corrente ? "animate-pulse-dot bg-info" : "bg-line-strong")} />
            <div>
              <p className={cn("text-[13px] font-medium transition-colors duration-300", i > corrente && "text-subtle")}>{p.titolo}</p>
              <p className="text-xs text-subtle">{p.testo}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
