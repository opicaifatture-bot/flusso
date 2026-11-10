import Link from "next/link";
import type { Piano } from "@/lib/sessione";
import { Avviso } from "./ui";

/** Avviso comune ai moduli: funzione non inclusa nel piano oppure abbonamento che non consente scritture. */
export function StatoModulo({ piano, inclusa, scrivibile, nome }: { piano: Piano | null; inclusa: boolean; scrivibile: boolean; nome: string }) {
  if (scrivibile) return null;
  return (
    <div className="mb-4">
      <Avviso tono="warn">
        {!inclusa
          ? <>«{nome}» non è incluso nel piano {piano?.nome ?? "attuale"}. I dati eventualmente già presenti restano consultabili. </>
          : <>L&apos;abbonamento non è attivo ({piano?.stato}): i dati restano consultabili, ma non si possono registrare nuove operazioni. </>}
        <Link href="/impostazioni#piano" className="underline">Vedi il piano</Link>
      </Avviso>
    </div>
  );
}
