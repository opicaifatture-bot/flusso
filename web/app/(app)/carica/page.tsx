import type { Metadata } from "next";
import { sessioneSede } from "@/lib/sessione";
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
        ? <Caricatore ristoranteId={attivo.id} />
        : <Avviso tono="warn">Il tuo ruolo consente solo la consultazione: per caricare documenti chiedi l&apos;accesso al titolare.</Avviso>}
    </div>
  );
}
