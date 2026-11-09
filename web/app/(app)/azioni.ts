"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { sessione } from "@/lib/sessione";

export async function cambiaSede(id: string) {
  const { sedi } = await sessione();
  if (!sedi.some((s) => s.id === id)) return;
  (await cookies()).set("pg_sede", id, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  revalidatePath("/", "layout");
}
