import type { Metadata } from "next";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase";
import { data } from "@/lib/format";
import { RUOLI, type Ruolo } from "@/lib/tipi";
import { esci } from "@/app/login/actions";
import { AccettaInvito, ModuliInvito } from "./moduli";

export const metadata: Metadata = { title: "Invito", robots: { index: false } };
export const dynamic = "force-dynamic";

const MOTIVI: Record<string, string> = {
  non_valido: "Questo collegamento non è valido oppure è già stato usato.",
  scaduto: "Questo invito è scaduto. Chiedi al titolare di inviartene uno nuovo.",
  revocato: "Questo invito è stato revocato.",
  accettato: "Questo invito è già stato accettato: puoi accedere normalmente.",
};

export default async function Invito({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await supabaseServer();
  const [{ data: inv }, { data: { user } }] = await Promise.all([
    /^[0-9a-f]{64}$/.test(token) ? supabase.rpc("anteprima_invito", { p_token: token }) : Promise.resolve({ data: { stato: "non_valido" } }),
    supabase.auth.getUser(),
  ]);
  const valido = inv?.stato === "valido";
  const stessaEmail = !!user?.email && user.email.toLowerCase() === inv?.email;

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-[400px] animate-in">
        <div className="mb-6 text-center">
          <span className="mx-auto grid size-10 place-items-center rounded-xl bg-inverse text-base font-bold text-inverse-fg">P</span>
          <h1 className="mt-5 text-xl font-semibold tracking-tight">{valido ? "Sei stato invitato" : "Invito non disponibile"}</h1>
        </div>
        <div className="card space-y-5 p-6 shadow-pop">
          {!valido ? (
            <>
              <p className="text-[13px] text-muted">{MOTIVI[inv?.stato ?? "non_valido"]}</p>
              <Link href="/login" className="btn h-9 w-full">Vai all&apos;accesso</Link>
            </>
          ) : (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
                <dt className="text-muted">Dove</dt><dd className="font-medium">{inv.sede ?? `Tutte le sedi di ${inv.gruppo}`}</dd>
                <dt className="text-muted">Ruolo</dt><dd className="font-medium">{RUOLI[inv.ruolo as Ruolo]}</dd>
                <dt className="text-muted">Valido fino al</dt><dd>{data(inv.scade_il)}</dd>
              </dl>
              {user && stessaEmail ? <AccettaInvito token={token} />
                : user ? (
                  <div className="space-y-3">
                    <p className="text-[13px] text-warn">Hai effettuato l&apos;accesso come {user.email}, ma l&apos;invito è per {inv.email}.</p>
                    <form action={esci}><button className="btn h-9 w-full">Esci e riapri il collegamento</button></form>
                  </div>
                ) : <ModuliInvito token={token} email={inv.email} />}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
