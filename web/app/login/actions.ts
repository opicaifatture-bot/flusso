"use server";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase";

export async function accedi(formData: FormData) {
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
  });
  if (error) redirect(`/login?errore=${encodeURIComponent(error.message)}`);
  redirect("/");
}

export async function esci() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
