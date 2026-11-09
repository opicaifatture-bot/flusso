"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, FileText, RotateCw, UploadCloud, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { cn } from "@/lib/format";
import { avviaElaborazione, prenotaCaricamento, riprovaDocumento, statoDocumenti, type StatoRemoto } from "./actions";

const MAX_BYTE = 25 * 1024 * 1024;
const ESTENSIONI = ["pdf", "xml", "jpg", "jpeg", "png", "webp"];
const PASSI = ["Preparazione", "Caricamento", "In coda", "Estrazione", "Abbinamento", "Completato"] as const;

type Fase = "preparazione" | "caricamento" | "in_coda" | "estrazione" | "abbinamento" | "completato" | "errore" | "duplicato";
type Voce = {
  chiave: string; nome: string; dimensione: number; fase: Fase; messaggio?: string;
  documentoId?: string; remoto?: StatoRemoto; riprovabile?: boolean;
};

const indicePasso = (f: Fase) =>
  ({ preparazione: 0, caricamento: 1, in_coda: 2, estrazione: 3, abbinamento: 4, completato: 5, errore: -1, duplicato: -1 })[f];

function faseDaRemoto(r: StatoRemoto): Fase {
  if (r.stato === "completato") return "completato";
  if (r.stato === "errore") return "errore";
  if (r.stato === "duplicato") return "duplicato";
  if (r.stato === "elaborazione") return r.fase === "abbinamento" ? "abbinamento" : "estrazione";
  return "in_coda";
}

async function sha256(buffer: ArrayBuffer) {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Le foto vengono ridotte nel browser: stessi dati leggibili, molti meno token e upload più rapidi. */
async function riduciImmagine(file: File, lato = 2400, qualita = 0.86): Promise<File> {
  const bmp = await createImageBitmap(file);
  const scala = Math.min(1, lato / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scala);
  canvas.height = Math.round(bmp.height * scala);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob: Blob = await new Promise((ok, ko) =>
    canvas.toBlob((b) => (b ? ok(b) : ko(new Error("compressione"))), "image/jpeg", qualita));
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}

const dimensione = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function Caricatore({ ristoranteId }: { ristoranteId: string }) {
  const [voci, setVoci] = useState<Voce[]>([]);
  const [sopra, setSopra] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const vociRef = useRef(voci);
  vociRef.current = voci;

  const aggiorna = useCallback((chiave: string, patch: Partial<Voce>) =>
    setVoci((v) => v.map((x) => (x.chiave === chiave ? { ...x, ...patch } : x))), []);

  const applicaRemoto = useCallback((r: StatoRemoto) =>
    setVoci((v) => v.map((x) => x.documentoId === r.id
      ? { ...x, remoto: r, fase: faseDaRemoto(r), messaggio: r.errore ?? undefined, riprovabile: r.stato === "errore" }
      : x)), []);

  const elabora = useCallback(async (chiave: string, originale: File) => {
    try {
      const est = originale.name.split(".").pop()?.toLowerCase() ?? "";
      const immagine = originale.type.startsWith("image/");
      if (!immagine && !ESTENSIONI.includes(est)) throw new Error("Formato non supportato: usa PDF, XML, JPG, PNG o WEBP");

      // L'impronta è calcolata sul file originale: lo stesso file non entra due volte.
      const impronta = await sha256(await originale.arrayBuffer());
      let file = originale;
      if (immagine) {
        try { file = await riduciImmagine(originale); }
        catch { throw new Error("Impossibile leggere l'immagine: prova a salvarla come JPG o PNG"); }
      }
      if (file.size > MAX_BYTE) throw new Error("File troppo grande: il limite è 25 MB");

      const prenotazione = await prenotaCaricamento({ nome: file.name, dimensione: file.size, sha256: impronta });
      if (!prenotazione.ok) throw new Error(prenotazione.errore);
      const p = prenotazione.dati!;
      aggiorna(chiave, { documentoId: p.documentoId });

      if (p.duplicato) {
        if (p.stato !== "in_coda") {
          aggiorna(chiave, { fase: "duplicato", messaggio: "Questo file è già stato caricato." });
          return;
        }
      } else {
        aggiorna(chiave, { fase: "caricamento" });
        const { error } = await supabaseBrowser().storage.from("documenti")
          .uploadToSignedUrl(p.percorso, p.token, file, { contentType: p.mime });
        if (error) throw new Error("Caricamento non riuscito: " + error.message);
      }

      aggiorna(chiave, { fase: "in_coda" });
      const avvio = await avviaElaborazione(p.documentoId);
      if (!avvio.ok) {
        aggiorna(chiave, { fase: "errore", messaggio: avvio.errore, riprovabile: true });
      }
    } catch (e) {
      aggiorna(chiave, { fase: "errore", messaggio: e instanceof Error ? e.message : "Errore imprevisto" });
    }
  }, [aggiorna]);

  const aggiungi = useCallback((lista: FileList | File[]) => {
    const nuovi = Array.from(lista).slice(0, 20).map((f) => ({
      voce: { chiave: crypto.randomUUID(), nome: f.name, dimensione: f.size, fase: "preparazione" as Fase }, file: f,
    }));
    if (!nuovi.length) return;
    setVoci((v) => [...nuovi.map((n) => n.voce), ...v]);
    // In sequenza: evita picchi di memoria con molte foto ad alta risoluzione.
    (async () => { for (const n of nuovi) await elabora(n.voce.chiave, n.file); })();
  }, [elabora]);

  // Stato in tempo reale (Realtime) con controllo periodico di riserva.
  useEffect(() => {
    const sb = supabaseBrowser();
    const canale = sb.channel(`carica:${ristoranteId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "documenti", filter: `ristorante_id=eq.${ristoranteId}` },
        (evento: { new: StatoRemoto }) => applicaRemoto(evento.new))
      .subscribe();
    const intervallo = setInterval(async () => {
      const attesi = vociRef.current
        .filter((v) => v.documentoId && ["in_coda", "estrazione", "abbinamento"].includes(v.fase))
        .map((v) => v.documentoId!);
      if (attesi.length) (await statoDocumenti(attesi)).forEach(applicaRemoto);
    }, 4000);
    return () => { clearInterval(intervallo); sb.removeChannel(canale); };
  }, [ristoranteId, applicaRemoto]);

  const riprova = async (v: Voce) => {
    if (!v.documentoId) return;
    aggiorna(v.chiave, { fase: "in_coda", messaggio: undefined, riprovabile: false });
    const r = await riprovaDocumento(v.documentoId);
    if (!r.ok) aggiorna(v.chiave, { fase: "errore", messaggio: r.errore, riprovabile: true });
  };

  return (
    <div className="space-y-4">
      <div
        role="button" tabIndex={0} aria-label="Seleziona o trascina i documenti da caricare"
        onClick={() => input.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setSopra(true); }}
        onDragLeave={() => setSopra(false)}
        onDrop={(e) => { e.preventDefault(); setSopra(false); aggiungi(e.dataTransfer.files); }}
        className={cn("card flex cursor-pointer flex-col items-center justify-center border-dashed px-6 py-14 text-center transition-colors duration-200",
          sopra ? "border-ok bg-ok-soft" : "hover:border-line-strong hover:bg-raised")}
      >
        <span className={cn("grid size-11 place-items-center rounded-full border transition-colors duration-200", sopra ? "border-ok/40 text-ok" : "border-line text-muted")}>
          <UploadCloud className="size-5" />
        </span>
        <p className="mt-4 text-sm font-medium">Trascina qui fatture e DDT, oppure scegli i file</p>
        <p className="mt-1 text-xs text-muted">PDF, XML FatturaPA o foto · fino a 25 MB per file · italiano, francese, tedesco, inglese</p>
        <input ref={input} type="file" multiple hidden
          accept=".pdf,.xml,.jpg,.jpeg,.png,.webp,application/pdf,application/xml,text/xml,image/*"
          onChange={(e) => { if (e.target.files) aggiungi(e.target.files); e.target.value = ""; }} />
      </div>

      <ul className="space-y-2" aria-live="polite">
        <AnimatePresence initial={false}>
          {voci.map((v) => {
            const passo = indicePasso(v.fase);
            const errore = v.fase === "errore";
            const doppio = v.fase === "duplicato";
            const fatto = v.fase === "completato";
            return (
              <motion.li key={v.chiave} layout
                initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
                className="card overflow-hidden p-4">
                <div className="flex items-start gap-3">
                  <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border",
                    errore ? "border-danger/30 bg-danger-soft text-danger" : doppio ? "border-warn/30 bg-warn-soft text-warn"
                      : fatto ? "border-ok/30 bg-ok-soft text-ok" : "border-line text-muted")}>
                    {errore ? <X className="size-4" /> : doppio ? <AlertTriangle className="size-4" /> : fatto ? <Check className="size-4" /> : <FileText className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="truncate text-[13px] font-medium">
                        {fatto && v.remoto ? <>{v.remoto.tipo} <span className="num">{v.remoto.numero ?? "s.n."}</span></> : v.nome}
                      </p>
                      <span className="num shrink-0 text-[11px] text-subtle">{dimensione(v.dimensione)}</span>
                    </div>
                    <p className={cn("mt-0.5 text-xs", errore ? "text-danger" : doppio ? "text-warn" : "text-muted")}>
                      {errore ? (v.messaggio ?? "Errore durante l'elaborazione")
                        : doppio ? (v.messaggio ?? "Documento già presente in archivio")
                        : fatto ? (v.remoto?.n_anomalie
                            ? <span className="text-danger">{v.remoto.n_anomalie} {v.remoto.n_anomalie === 1 ? "rincaro rilevato" : "rincari rilevati"}</span>
                            : "Acquisito · prezzi nella norma")
                        : v.fase === "estrazione" ? "Lettura del documento con l'IA…"
                        : v.fase === "abbinamento" ? "Abbinamento degli articoli al catalogo…"
                        : `${PASSI[passo]}…`}
                    </p>
                    {!errore && !doppio && (
                      <div className="mt-3 flex gap-1" aria-hidden>
                        {PASSI.map((nome, i) => (
                          <div key={nome} className="h-1 flex-1 overflow-hidden rounded-full bg-line">
                            <motion.div className={cn("h-full rounded-full", fatto ? "bg-ok" : "bg-fg/70", i === passo && !fatto && "animate-pulse-dot")}
                              initial={false} animate={{ width: i <= passo ? "100%" : "0%" }} transition={{ duration: 0.4, ease: "easeOut" }} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {errore && v.riprovabile && v.documentoId && (
                      <button type="button" onClick={() => riprova(v)} className="btn btn-sm"><RotateCw className="size-3" />Riprova</button>
                    )}
                    {v.documentoId && (fatto || doppio) && (
                      <Link href={`/documenti/${doppio ? (v.remoto?.duplicato_di ?? v.documentoId) : v.documentoId}`} className="btn btn-sm">Apri</Link>
                    )}
                    {(errore || doppio || fatto) && (
                      <button type="button" aria-label="Rimuovi dall'elenco" className="btn btn-ghost btn-sm px-1.5"
                        onClick={() => setVoci((x) => x.filter((y) => y.chiave !== v.chiave))}><X className="size-3.5" /></button>
                    )}
                  </div>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </div>
  );
}
