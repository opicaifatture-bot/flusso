import "./globals.css";
import Link from "next/link";
import type { Metadata } from "next";
import { supabaseServer } from "@/lib/supabase";
import { esci } from "./login/actions";

export const metadata: Metadata = { title: "Price Guardian", description: "Invisible Accounting & Price Guardian" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <html lang="it">
      <body className="min-h-screen">
        {user && (
          <header className="border-b border-stone-200 bg-white">
            <div className="mx-auto flex max-w-7xl items-center gap-8 px-6 py-4">
              <Link href="/" className="text-lg font-semibold tracking-tight">
                Price<span className="text-amber-700">Guardian</span>
              </Link>
              <nav className="flex gap-6 text-sm text-stone-600">
                <Link href="/" className="hover:text-stone-900">Documenti</Link>
                <Link href="/anomalie" className="hover:text-stone-900">Anomalie</Link>
                <Link href="/carica" className="hover:text-stone-900">Carica</Link>
              </nav>
              <form action={esci} className="ml-auto flex items-center gap-3 text-sm text-stone-500">
                <span className="hidden sm:inline">{user.email}</span>
                <button className="rounded-md border border-stone-300 px-3 py-1 hover:bg-stone-100">Esci</button>
              </form>
            </div>
          </header>
        )}
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
