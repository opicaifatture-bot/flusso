import type { Metadata } from "next";
import { pianoCorrente, sessioneSede } from "@/lib/sessione";
import { Intestazione } from "@/components/ui";
import { MenuCompleto } from "@/components/shell";

export const metadata: Metadata = { title: "Menu" };

export default async function PaginaMenu() {
  const { attivo } = await sessioneSede();
  const piano = await pianoCorrente(attivo.gruppo_id);
  return <div className="mx-auto max-w-xl"><Intestazione titolo="Tutte le sezioni" sottotitolo={attivo.nome} /><MenuCompleto funzioni={piano?.funzioni ?? []} /></div>;
}
