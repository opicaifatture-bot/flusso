"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

/**
 * Tiene la pagina allineata allo stato dei documenti senza ricaricarla:
 * Supabase Realtime (filtrato dalla RLS) e, finché ci sono documenti in
 * lavorazione, un controllo periodico di riserva.
 */
export function InDiretta({ ristoranteId, inLavorazione = false }: { ristoranteId: string; inLavorazione?: boolean }) {
  const router = useRouter();

  useEffect(() => {
    const sb = supabaseBrowser();
    let timer: ReturnType<typeof setTimeout>;
    const aggiorna = () => { clearTimeout(timer); timer = setTimeout(() => router.refresh(), 300); };
    const canale = sb
      .channel(`documenti:${ristoranteId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "documenti", filter: `ristorante_id=eq.${ristoranteId}` }, aggiorna)
      .subscribe();
    return () => { clearTimeout(timer); sb.removeChannel(canale); };
  }, [ristoranteId, router]);

  useEffect(() => {
    if (!inLavorazione) return;
    const intervallo = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(intervallo);
  }, [inLavorazione, router]);

  return null;
}
