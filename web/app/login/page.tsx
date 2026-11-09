import { accedi } from "./actions";

export default async function Login({ searchParams }: { searchParams: Promise<{ errore?: string }> }) {
  const { errore } = await searchParams;
  return (
    <div className="mx-auto mt-24 max-w-sm rounded-xl border border-stone-200 bg-white p-8 shadow-sm">
      <h1 className="text-xl font-semibold">Price<span className="text-amber-700">Guardian</span></h1>
      <p className="mt-1 text-sm text-stone-500">Contabilità invisibile e controllo prezzi</p>
      <form action={accedi} className="mt-6 space-y-4">
        <input name="email" type="email" required placeholder="Email"
          className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus:border-amber-700 focus:outline-none" />
        <input name="password" type="password" required placeholder="Password"
          className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus:border-amber-700 focus:outline-none" />
        {errore && <p className="text-sm text-red-600">{errore}</p>}
        <button className="w-full rounded-md bg-stone-900 py-2 text-sm font-medium text-white hover:bg-stone-800">Accedi</button>
      </form>
    </div>
  );
}
