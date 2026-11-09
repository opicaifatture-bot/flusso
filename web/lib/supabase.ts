import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

/**
 * Client Supabase lato server, con la sessione dell'utente (cookie).
 * Inoltra l'IP del visitatore nell'header x-pg-client-ip: il trigger di audit
 * lo registra accanto a ogni modifica.
 */
export async function supabaseServer() {
  const store = await cookies();
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "";
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { headers: ip ? { "x-pg-client-ip": ip } : {} },
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            /* chiamato da un Server Component: la sessione viene rinnovata dal middleware */
          }
        },
      },
    }
  );
}
