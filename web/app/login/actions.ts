"use server";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase";

export async function accedi(formData: FormData) {
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
  });
  if (error) {
    const messaggio = /invalid login/i.test(error.message) ? "Email o password non corretti" : error.message;
    redirect(`/login?errore=${encodeURIComponent(messaggio)}`);
  }
  redirect("/");
}

export async function esci() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
