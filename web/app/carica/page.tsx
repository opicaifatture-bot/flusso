"use client";
import Link from "next/link";
import { useActionState, useState, startTransition } from "react";
import { caricaDocumento, type Esito } from "./actions";

// Vercel rifiuta richieste oltre ~4,5 MB: restiamo sotto con margine.
const LIMITE = 4 * 1024 * 1024;

async function comprimiImmagine(file: File, maxLato = 2000, qualita = 0.85): Promise<File> {
  const bmp = await createImageBitmap(file);
  const scala = Math.min(1, maxLato / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scala);
  canvas.height = Math.round(bmp.height * scala);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob: Blob = await new Promise((ok, ko) =>
    canvas.toBlob((b) => (b ? ok(b) : ko(new Error("Compressione fallita"))), "image/jpeg", qualita));
  const nome = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], nome, { type: "image/jpeg" });
}

export default function Carica() {
  const [esito, azione, inCorso] = useActionState<Esito | null, FormData>(caricaDocumento, null);
  const [errore, setErrore] = useState<string | null>(null);
  const [preparazione, setPreparazione] = useState(false);

  async function invia(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrore(null);
    const input = e.currentTarget.elements.namedItem("file") as HTMLInputElement;
    let file = input.files?.[0];
    if (!file) return setErrore("Seleziona un file.");
    try {
      setPreparazione(true);
      if (file.type.startsWith("image/")) {
        file = await comprimiImmagine(file);
        if (file.size > LIMITE) file = await comprimiImmagine(file, 1600, 0.7);
      }
    } catch {
      return setErrore("Impossibile leggere l'immagine (formato non supportato? prova JPG o PNG).");
    } finally {
      setPreparazione(false);
    }
    if (file.size > LIMITE) return setErrore("File troppo grande (max 4 MB). Per i PDF prova a comprimerli.");
    const fd = new FormData();
    fd.append("file", file, file.name);
    startTransition(() => azione(fd));
  }

  const occupato = inCorso || preparazione;
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Carica documento</h1>
        <p className="text-sm text-stone-500">Fattura XML (FatturaPA), PDF o foto di DDT, in italiano, francese o inglese.</p>
      </div>
      <form onSubmit={invia} className="space-y-4 rounded-xl border border-stone-200 bg-white p-6">
        <input type="file" name="file" required accept=".pdf,.xml,.jpg,.jpeg,.png,.webp,application/pdf,application/xml,text/xml,image/*"
          className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-stone-900 file:px-4 file:py-2 file:text-white" />
        <button disabled={occupato} className="w-full rounded-md bg-amber-700 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50">
          {preparazione ? "Preparazione immagine…" : inCorso ? "Estrazione in corso con Claude…" : "Elabora documento"}
        </button>
      </form>
      {errore && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{errore}</div>}
      {esito && !errore && (
        <div className={`rounded-xl p-4 text-sm ${!esito.ok ? "bg-red-50 text-red-700" : esito.n_anomalie ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
          <p>{esito.messaggio}</p>
          {esito.documento_id && <Link href={`/documenti/${esito.documento_id}`} className="mt-2 inline-block font-medium underline">Vedi dettaglio →</Link>}
        </div>
      )}
    </div>
  );
}
