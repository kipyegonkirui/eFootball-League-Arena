import bannerImg from "@/assets/stadium-empty.jpg";
import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { PublicGroup } from "@/lib/tournament";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/tournament", label: "Groups" },
  { to: "/league", label: "League" },
  { to: "/register", label: "Register" },
  { to: "/status", label: "Check status" },
  { to: "/rules", label: "Rules" },
] as const;

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const router = useRouter();
  async function logout() {
    setOpen(false);
    await supabase.auth.signOut();
    router.navigate({ to: "/", replace: true });
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setSignedIn(!!session);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") router.invalidate();
    });
    return () => data.subscription.unsubscribe();
  }, [router]);

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
          <img src="/logo-mark.png" alt="" width={40} height={40} className="h-10 w-10 rounded-lg object-cover" />
          <span className="font-display text-xl font-bold uppercase leading-none tracking-wide">
            eFootball <span className="text-gradient-brand">Arena</span>
            <span className="block text-[10px] font-semibold tracking-[0.3em] text-muted-foreground">KENYA</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="rounded-md px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{ className: "text-primary" }}
              activeOptions={{ exact: true }}
            >
              {n.label}
            </Link>
          ))}
          {signedIn && (
            <Link to="/admin" className="rounded-md px-3 py-2 text-sm font-semibold text-accent">
              Admin
            </Link>
          )}
          {signedIn && (
            <button onClick={logout} className="ml-1 rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
              Log out
            </button>
          )}
        </nav>
        <button
          className="grid h-10 w-10 place-items-center rounded-md border border-border md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <nav className="border-t border-border bg-background px-4 pb-4 md:hidden">
          {[...NAV, ...(signedIn ? [{ to: "/admin", label: "Admin" } as const] : [])].map((n) => (
            <Link
              key={n.to}
              to={n.to}
              onClick={() => setOpen(false)}
              className="block border-b border-border/50 py-3 text-base font-semibold"
              activeProps={{ className: "text-primary" }}
              activeOptions={{ exact: true }}
            >
              {n.label}
            </Link>
          ))}
          {signedIn && <button onClick={logout} className="block w-full py-3 text-left text-base font-semibold text-muted-foreground">Log out</button>}
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-border/60">
      {/* Links sit on the left and the footer has extra bottom space, so a floating host badge in the bottom-right corner never covers them. */}
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 pb-24 pt-8 text-sm text-muted-foreground">
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link to="/status" className="hover:text-foreground">Check status</Link>
          <Link to="/rules" className="hover:text-foreground">Rules</Link>
          <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link to="/auth" className="font-semibold hover:text-foreground">Organiser login</Link>
        </nav>
        <p>© {new Date().getFullYear()} eFootball Arena Kenya. Independent tournament organiser.</p>
      </div>
    </footer>
  );
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    pending: { cls: "status-pending", label: "Awaiting payment verification" },
    verified: { cls: "status-verified", label: "Verified" },
    rejected: { cls: "status-rejected", label: "Rejected" },
    open: { cls: "status-open", label: "Open" },
    full: { cls: "status-verified", label: "Full" },
  };
  const m = map[status] ?? map.pending;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide", m.cls, className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {m.label}
    </span>
  );
}

export function GroupCard({ group }: { group: PublicGroup }) {
  const filled = group.players.length;
  const seats = Array.from({ length: group.capacity }, (_, i) => group.players.find((p) => p.slot === i + 1));
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h3 className="text-2xl font-bold uppercase">Group {String.fromCharCode(64 + group.group_number)}</h3>
          <p className="text-xs text-muted-foreground">
            {filled}/{group.capacity} confirmed
          </p>
        </div>
        <StatusBadge status={group.is_full || filled >= group.capacity ? "full" : "open"} />
      </div>
      <div className="h-1 bg-muted">
        <div className="h-full bg-gradient-brand transition-all" style={{ width: `${(filled / group.capacity) * 100}%` }} />
      </div>
      <ol className="divide-y divide-border/60">
        {seats.map((p, i) => (
          <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="w-6 font-display text-base font-bold text-muted-foreground">{i + 1}</span>
            {p ? (
              <>
                <span className="font-semibold">{p.gamer_tag}{p.team_name && <span className="ml-2 text-xs font-normal text-muted-foreground">{p.team_name}</span>}</span>
                <span className="ml-auto text-xs text-muted-foreground">{p.platform}</span>
              </>
            ) : (
              <span className="text-muted-foreground/60">Open seat</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PageShell({ title, kicker, children }: { title: string; kicker?: string; children: React.ReactNode }) {
  return (
    <main className="bg-pitch">
      <div className="relative isolate overflow-hidden">
        <img src={bannerImg} alt="" width={500} height={375} className="absolute inset-0 -z-10 h-full w-full object-cover opacity-40" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-background/40 via-background/70 to-background" />
        <div className="mx-auto max-w-6xl px-4 pb-6 pt-10 md:pb-8 md:pt-14">
          {kicker && <p className="text-xs font-bold uppercase tracking-[0.3em] text-accent">{kicker}</p>}
          <h1 className="mt-2 text-4xl font-extrabold uppercase md:text-6xl">{title}</h1>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 pb-10 md:pb-14">
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}
