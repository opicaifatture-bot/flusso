import { Schede } from "@/components/ui";

export function NavAutocontrollo({ attiva }: { attiva: "scadenzario" | "documenti" | "persone" }) {
  return (
    <div className="mb-5">
      <Schede attiva={attiva} voci={[
        { href: "/autocontrollo", chiave: "scadenzario", etichetta: "Scadenzario" },
        { href: "/autocontrollo/documenti", chiave: "documenti", etichetta: "Documenti" },
        { href: "/autocontrollo/persone", chiave: "persone", etichetta: "Persone e PIN" },
      ]} />
    </div>
  );
}
