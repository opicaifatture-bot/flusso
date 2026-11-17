"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

/**
 * Aggiorna la pagina quando cambiano ordini, chiamate o tavoli della sede, con un suono
 * per le nuove chiamate e i piatti pronti. Funziona finché la pagina è aperta sul telefono.
 */
export function TempoReale({ sede, tabelle, suono = true }: { sede: string; tabelle: string[]; suono?: boolean }) {
  const router = useRouter();
  const [notifiche, setNotifiche] = useState<NotificationPermission | "assenti">("default");
  const audio = useRef<AudioContext | null>(null);
  useEffect(() => {
    try { setNotifiche("Notification" in window ? Notification.permission : "assenti"); } catch { setNotifiche("assenti"); }
    const beep = () => {
      if (!suono) return;
      try {
        audio.current ??= new AudioContext();
        const o = audio.current.createOscillator(); const g = audio.current.createGain();
        o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(audio.current.destination); o.start(); o.stop(audio.current.currentTime + 0.25);
      } catch {}
    };
    const avvisa = (testo: string) => {
      beep();
      try { if ("Notification" in window && Notification.permission === "granted" && document.hidden) new Notification("Kitchen OS · Sala", { body: testo }); } catch {}
      try { navigator.vibrate?.(200); } catch {}
    };
    const sb = supabaseBrowser();
    let ch = sb.channel(`sala-${sede}-${tabelle.join("-")}`);
    for (const t of tabelle) {
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table: t, filter: `ristorante_id=eq.${sede}` }, (p: { eventType: string; new: unknown }) => {
        const n = p.new as Record<string, unknown>;
        if (t === "chiamate_tavolo" && p.eventType === "INSERT") avvisa(`Nuova richiesta: ${n.tipo}`);
        if (t === "ordini_righe" && p.eventType === "UPDATE" && n.stato === "pronto") avvisa(`Pronto: ${n.nome}`);
        if (t === "ordini_righe" && p.eventType === "INSERT" && tabelle.length === 1) avvisa(`Nuovo ordine: ${n.nome}`);
        router.refresh();
      });
    }
    ch.subscribe();
    const giro = setInterval(() => router.refresh(), 30000);   // rete instabile: aggiornamento di sicurezza
    return () => { sb.removeChannel(ch); clearInterval(giro); };
  }, [sede, tabelle, suono, router]);

  return (
    <div className="flex items-center gap-2 text-xs text-muted print:hidden">
      <span className="inline-flex items-center gap-1.5"><span className="size-2 animate-pulse rounded-full bg-ok" />Aggiornamento in tempo reale</span>
      {notifiche === "default" && <button className="btn btn-sm" onClick={async () => setNotifiche(await Notification.requestPermission())}>Attiva le notifiche</button>}
      {notifiche === "denied" && <span>Notifiche bloccate nelle impostazioni del browser</span>}
    </div>
  );
}
