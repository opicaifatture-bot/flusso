import { cruscotto, sessione } from "@/lib/sessione";
import { Shell } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, sedi, attivo, ruolo } = await sessione();
  const k = attivo ? await cruscotto(attivo.id) : null;

  return (
    <Shell
      email={user.email ?? ""}
      ruolo={ruolo}
      sedi={sedi.map((s) => ({ id: s.id, nome: s.nome }))}
      attiva={attivo ? { id: attivo.id, nome: attivo.nome } : null}
      gruppo={attivo?.gruppi?.nome ?? null}
      conteggi={{
        validazione: (k?.da_validare ?? 0) + (k?.master_in_bozza ?? 0),
        rincari: k?.rincari_aperti ?? 0,
        lavorazione: k?.in_lavorazione ?? 0,
      }}
    >
      {attivo ? children : (
        <div className="card mx-auto mt-16 max-w-md p-8 text-center">
          <h1 className="text-base font-semibold">Nessuna sede associata</h1>
          <p className="mt-2 text-[13px] text-muted">
            Il tuo utente non è ancora collegato a un ristorante. Chiedi al titolare di aggiungerti
            da Impostazioni → Team.
          </p>
        </div>
      )}
    </Shell>
  );
}
