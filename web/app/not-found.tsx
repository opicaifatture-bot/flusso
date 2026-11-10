import Link from "next/link";

export default function NonTrovata() {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="card max-w-md p-8 text-center">
        <h1 className="text-base font-semibold">Pagina non trovata</h1>
        <p className="mt-2 text-[13px] text-muted">L&apos;elemento non esiste oppure appartiene a una sede a cui non hai accesso.</p>
        <Link href="/" className="btn btn-primary mt-5">Torna alla panoramica</Link>
      </div>
    </div>
  );
}
