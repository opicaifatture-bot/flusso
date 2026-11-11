import { Schede } from "@/components/ui";

const VOCI = [
  { href: "/autocontrollo/oggi", chiave: "oggi", etichetta: "Oggi" },
  { href: "/autocontrollo", chiave: "scadenzario", etichetta: "Scadenzario" },
  { href: "/autocontrollo/piano", chiave: "piano", etichetta: "Piano HACCP" },
  { href: "/autocontrollo/registri", chiave: "registri", etichetta: "Registri" },
  { href: "/autocontrollo/infestanti", chiave: "infestanti", etichetta: "Infestanti" },
  { href: "/autocontrollo/analisi", chiave: "analisi", etichetta: "Analisi" },
  { href: "/autocontrollo/formazione", chiave: "formazione", etichetta: "Formazione" },
  { href: "/autocontrollo/allergeni", chiave: "allergeni", etichetta: "Allergeni" },
  { href: "/autocontrollo/documenti", chiave: "documenti", etichetta: "Documenti" },
  { href: "/autocontrollo/persone", chiave: "persone", etichetta: "Persone e PIN" },
  { href: "/autocontrollo/ispezione", chiave: "ispezione", etichetta: "Ispezione" },
] as const;
export type SchedaAutocontrollo = (typeof VOCI)[number]["chiave"];

export function NavAutocontrollo({ attiva }: { attiva: SchedaAutocontrollo }) {
  return <div className="mb-5 print:hidden"><Schede attiva={attiva} voci={[...VOCI]} /></div>;
}
