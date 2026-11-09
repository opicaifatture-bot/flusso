import type { Metadata } from "next";
import { accedi } from "./actions";

export const metadata: Metadata = { title: "Accedi" };

export default async function Login({ searchParams }: { searchParams: Promise<{ errore?: string }> }) {
  const { errore } = await searchParams;
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(60%_50%_at_50%_0%,var(--ok-soft),transparent_70%)]" />
      <div className="relative w-full max-w-[360px] animate-in">
        <div className="mb-8 text-center">
          <span className="mx-auto grid size-10 place-items-center rounded-xl bg-inverse text-base font-bold text-inverse-fg">P</span>
          <h1 className="mt-5 text-xl font-semibold tracking-tight">Price Guardian</h1>
          <p className="mt-1 text-[13px] text-muted">Contabilità invisibile e controllo prezzi</p>
        </div>
        <form action={accedi} className="card space-y-4 p-6 shadow-pop">
          <div>
            <label htmlFor="email" className="label">Email</label>
            <input id="email" name="email" type="email" required autoComplete="email" autoFocus className="input h-9" />
          </div>
          <div>
            <label htmlFor="password" className="label">Password</label>
            <input id="password" name="password" type="password" required autoComplete="current-password" className="input h-9" />
          </div>
          {errore && <p role="alert" className="text-[13px] text-danger">{errore}</p>}
          <button className="btn btn-primary h-9 w-full">Accedi</button>
        </form>
        <p className="mt-6 text-center text-[11px] text-subtle">Italia · Francia · Monaco · Svizzera</p>
      </div>
    </div>
  );
}
