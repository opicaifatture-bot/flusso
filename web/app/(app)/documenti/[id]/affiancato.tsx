"use client";
import { useState } from "react";
import { cn } from "@/lib/format";

/** Vista affiancata su desktop; su schermi piccoli diventa due schede (Dati / Originale). */
export function Affiancato({ sinistra, destra }: { sinistra: React.ReactNode; destra: React.ReactNode }) {
  const [scheda, setScheda] = useState<"dati" | "originale">("dati");
  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg border border-line bg-surface p-1 lg:hidden" role="tablist">
        {(["dati", "originale"] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={scheda === s} onClick={() => setScheda(s)}
            className={cn("h-7 rounded-md text-xs font-medium transition-colors duration-150", scheda === s ? "bg-hover text-fg" : "text-muted")}>
            {s === "dati" ? "Dati estratti" : "Originale"}
          </button>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className={cn("h-[72dvh] lg:sticky lg:top-8 lg:block lg:h-[calc(100dvh-4rem)]", scheda !== "originale" && "hidden")}>{sinistra}</div>
        <div className={cn("min-w-0 lg:block", scheda !== "dati" && "hidden")}>{destra}</div>
      </div>
    </>
  );
}
