import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";

/** Apre una versione dell'archivio con un link temporaneo. L'accesso è verificato dalle policy dello storage. */
export async function GET(req: NextRequest) {
  const percorso = req.nextUrl.searchParams.get("p") ?? "";
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png|webp)$/i.test(percorso)) return new NextResponse("Non valido", { status: 400 });
  const supabase = await supabaseServer();
  const { data, error } = await supabase.storage.from("archivio").createSignedUrl(percorso, 300);
  if (error || !data) return new NextResponse("Non disponibile", { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
