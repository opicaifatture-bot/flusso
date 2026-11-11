import { cruscotto, pianoCorrente, sessione } from "@/lib/sessione";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { homeLimitata, limitato, percorsoConsentito } from "@/lib/aree";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user, sedi, attivo, ruolo } = await sessione();
  const percorso = (await headers()).get("x-percorso") ?? "/";
  if (!percorsoConsentito(ruolo, percorso)) redirect(homeLimitata(ruolo));
  const [k, piano, allarmi] = attivo ? await Promise.all([
    limitato(ruolo) ? Promise.resolve(null) : cruscotto(attivo.id, 90), pianoCorrente(attivo.gruppo_id),
    supabase.from("allarmi").select("id", { count: "exact", head: true }).eq("ristorante_id", attivo.id).neq("stato", "risolto"),
  ]) : [null, null, null];

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
        allarmi: allarmi?.count ?? 0,
      }}
      funzioni={piano?.funzioni ?? []}
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
