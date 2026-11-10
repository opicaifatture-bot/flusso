"use client";
import { useCallback, useRef, useState } from "react";
import { ExternalLink, Maximize, Minus, Plus, RotateCw } from "lucide-react";
import { cn } from "@/lib/format";

type Props = { url: string | null; mime: string | null; testo: string | null; nome: string };

/** Anteprima nativa dell'originale: immagini con zoom e trascinamento, PDF nel lettore del browser, XML come testo. */
export function Visualizzatore({ url, mime, testo, nome }: Props) {
  const immagine = !!mime?.startsWith("image/");
  const pdf = mime === "application/pdf";
  const [zoom, setZoom] = useState(1);
  const [rotazione, setRotazione] = useState(0);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const trascina = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const imposta = useCallback((z: number) => {
    const nuovo = Math.min(5, Math.max(1, Number(z.toFixed(2))));
    setZoom(nuovo);
    if (nuovo === 1) setPos({ x: 0, y: 0 });
  }, []);

  return (
    <div className="card flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <p className="min-w-0 flex-1 truncate text-xs text-muted" title={nome}>{nome}</p>
        {immagine && url && (
          <div className="flex items-center gap-0.5">
            <button type="button" className="btn btn-ghost btn-sm px-1.5" onClick={() => imposta(zoom - 0.5)} aria-label="Riduci"><Minus className="size-3.5" /></button>
            <span className="num w-10 text-center text-[11px] text-subtle">{Math.round(zoom * 100)}%</span>
            <button type="button" className="btn btn-ghost btn-sm px-1.5" onClick={() => imposta(zoom + 0.5)} aria-label="Ingrandisci"><Plus className="size-3.5" /></button>
            <button type="button" className="btn btn-ghost btn-sm px-1.5" onClick={() => setRotazione((r) => (r + 90) % 360)} aria-label="Ruota di 90 gradi"><RotateCw className="size-3.5" /></button>
            <button type="button" className="btn btn-ghost btn-sm px-1.5" onClick={() => { imposta(1); setRotazione(0); }} aria-label="Adatta alla finestra"><Maximize className="size-3.5" /></button>
          </div>
        )}
        {url && <a href={url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm px-1.5" aria-label="Apri l'originale in una nuova scheda"><ExternalLink className="size-3.5" /></a>}
      </div>

      <div className="relative min-h-0 flex-1 bg-bg">
        {!url && !testo ? (
          <div className="grid h-full place-items-center p-8 text-center text-[13px] text-muted">Originale non disponibile.</div>
        ) : immagine && url ? (
          <div
            className={cn("h-full w-full touch-none select-none overflow-hidden", zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in")}
            onWheel={(e) => { if (e.ctrlKey || e.metaKey || zoom > 1) imposta(zoom - e.deltaY * 0.002); }}
            onDoubleClick={() => imposta(zoom > 1 ? 1 : 2.5)}
            tabIndex={0} role="img" aria-label={`Originale: ${nome}. Usa più e meno per lo zoom, R per ruotare, le frecce per spostarti.`}
            onKeyDown={(e) => {
              if (e.key === "+" || e.key === "=") imposta(zoom + 0.5);
              else if (e.key === "-") imposta(zoom - 0.5);
              else if (e.key.toLowerCase() === "r") setRotazione((r) => (r + 90) % 360);
              else if (e.key === "0") { imposta(1); setRotazione(0); }
              else if (e.key.startsWith("Arrow") && zoom > 1) {
                e.preventDefault();
                const d = 60;
                setPos((q) => ({ x: q.x + (e.key === "ArrowLeft" ? d : e.key === "ArrowRight" ? -d : 0), y: q.y + (e.key === "ArrowUp" ? d : e.key === "ArrowDown" ? -d : 0) }));
              }
            }}
            onPointerDown={(e) => {
              if (zoom === 1) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              trascina.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
            }}
            onPointerMove={(e) => {
              const t = trascina.current;
              if (t) setPos({ x: t.px + e.clientX - t.x, y: t.py + e.clientY - t.y });
            }}
            onPointerUp={() => { trascina.current = null; }}
            onPointerCancel={() => { trascina.current = null; }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Originale: ${nome}`} draggable={false}
              className="h-full w-full object-contain transition-transform duration-150 ease-out will-change-transform"
              style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom}) rotate(${rotazione}deg)` }} />
          </div>
        ) : pdf && url ? (
          <iframe src={`${url}#view=FitH`} title={`Originale: ${nome}`} className="h-full w-full bg-white" />
        ) : testo ? (
          <pre className="h-full overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-[11px] leading-relaxed text-muted">{testo}</pre>
        ) : (
          <div className="grid h-full place-items-center p-8 text-center text-[13px] text-muted">
            <a href={url!} target="_blank" rel="noreferrer" className="btn">Apri l&apos;originale</a>
          </div>
        )}
      </div>
    </div>
  );
}
