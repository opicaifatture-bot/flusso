import type { Metadata } from "next";
import { sessioneSede } from "@/lib/sessione";
import Link from "next/link";
import { Avviso, Intestazione } from "@/components/ui";
import { Caricatore } from "./caricatore";

export const metadata: Metadata = { title: "Carica" };

export default async function Carica() {
  const { attivo, permessi } = await sessioneSede();
  return (
    <div className="mx-auto max-w-2xl">
      <Intestazione titolo="Carica documenti"
        sottotitolo={<>I file vanno direttamente nell&apos;archivio protetto di <span className="text-fg">{attivo.nome}</span> e vengono letti in background: puoi caricarne più insieme e cambiare pagina.</>} />
      {permessi.caricare
        ? (
          <>
            <Caricatore ristoranteId={attivo.id} />
            <div className="mt-6 space-y-1.5 text-xs leading-relaxed text-subtle">
              <p><span className="text-muted">Cosa succede dopo l&apos;invio.</span> Ogni file viene letto in background, di solito in meno di un minuto. Puoi chiudere questa pagina: l&apos;avanzamento resta in <Link href="/documenti?filtro=lavorazione" className="text-muted underline">Documenti → In lavorazione</Link> e un documento fermo da più di 5 minuti passa a errore, da cui si può riprovare.</p>
              <p><span className="text-muted">Doppioni.</span> Lo stesso file non viene caricato due volte. Se carichi una seconda foto della stessa fattura, viene riconosciuta da fornitore, numero e data e marcata come duplicato, senza registrare di nuovo le righe.</p>
              <p><span className="text-muted">Limiti.</span> Un file deve contenere un solo documento. I PDF protetti da password e le fatture firmate .p7m vanno prima sbloccati o estratti.</p>
            </div>
          </>
        )
        : <Avviso tono="warn">Il tuo ruolo consente solo la consultazione: per caricare documenti chiedi l&apos;accesso al titolare.</Avviso>}
    </div>
  );
}
