import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageShell } from "@/components/site";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Organiser Login — eFootball Arena Kenya" },
      { name: "description", content: "Sign in for tournament organisers." },
      { property: "og:title", content: "Organiser Login — eFootball Arena Kenya" },
      { property: "og:description", content: "Admin access for tournament organisers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: String(f.get("email")), password: String(f.get("password")) });
    setBusy(false);
    if (error) return toast.error(error.message);
    nav({ to: "/admin" });
  }
  return (
    <PageShell kicker="Organisers" title="Sign in">
      <form onSubmit={submit} className="panel max-w-md space-y-4 p-6">
        <div className="space-y-1.5"><Label>Email</Label><Input name="email" type="email" required className="h-11" /></div>
        <div className="space-y-1.5"><Label>Password</Label><Input name="password" type="password" required className="h-11" /></div>
        <Button type="submit" variant="hero" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
      </form>
    </PageShell>
  );
}
