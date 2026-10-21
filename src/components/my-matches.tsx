import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { clearMine, loadMine, saveMine, type Saved } from "@/lib/saved";
import { formatDue, groupLetter, isPast, nextFixture, type MyFixture, type MyRegistration } from "@/lib/league";

async function lookup(ref: string, phone: string): Promise<MyRegistration | null> {
  const { data, error } = await supabase.rpc("lookup_registration", { _reference: ref, _phone: phone });
  if (error) throw new Error(error.message);
  return (data as unknown as MyRegistration | null) ?? null;
}

/**
 * "My matches": the signed-in-by-memory player's next match and fixtures, shown above the league table.
 * Uses the registration remembered on this device (same as the Check status page), or asks for it once.
 */
export function MyMatches({ seasonNumber, deadlines }: { seasonNumber: number; deadlines: Map<number, string> | undefined }) {
  const qc = useQueryClient();
  const [saved, setSaved] = useState<Saved | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { setSaved(loadMine()); setReady(true); }, []);

  // Key starts with "public-league" so live fixture updates refresh it automatically.
  const q = useQuery({
    queryKey: ["public-league", "mine", saved?.ref ?? "", saved?.phone ?? ""],
    enabled: !!saved,
    queryFn: () => lookup(saved!.ref, saved!.phone),
    staleTime: 10_000,
  });

  function forget() { clearMine(); setSaved(null); qc.removeQueries({ queryKey: ["public-league", "mine"] }); }

  if (!ready) return null;
  if (!saved || (q.isSuccess && q.data === null)) return <Finder notFound={!!saved} onFound={(s) => setSaved(s)} onForget={saved ? forget : undefined} />;
  if (q.isLoading) return <Skeleton className="mb-6 h-28 rounded-xl" />;
  const r = q.data;
  if (!r) return null;
  if (r.season_number != null && r.season_number !== seasonNumber) return null; // their registration is for another season

  const next = nextFixture(r.fixtures);
  const played = r.fixtures.filter((f) => f.status === "confirmed").length;

  return (
    <section className="panel mb-6 p-5" aria-label="My matches">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">My matches</p>
          <p className="font-display text-2xl font-bold">
            {r.gamer_tag}
            {r.status === "verified" && r.group_number != null && <span className="ml-2 text-sm font-normal text-muted-foreground">Group {groupLetter(r.group_number)} · slot {r.slot_number}</span>}
          </p>
        </div>
        <button type="button" onClick={forget} className="text-xs text-muted-foreground underline">Not you?</button>
      </div>

      {r.status === "pending" && <p className="mt-3 text-sm text-muted-foreground">We're checking your payment. Your slot and fixtures appear once you're verified.</p>}
      {r.status === "rejected" && <p className="mt-3 text-sm text-muted-foreground">This registration isn't active{r.reason ? `: ${r.reason}` : ""}. You can register again from the Register page.</p>}
      {r.status === "verified" && r.fixtures.length === 0 && <p className="mt-3 text-sm text-muted-foreground">You're in. Your fixtures appear here as soon as your group is full and the league starts.</p>}

      {r.status === "verified" && r.fixtures.length > 0 && (
        <>
          {next ? <NextMatch f={next} due={deadlines?.get(next.round)} /> : <p className="mt-3 rounded-lg bg-primary/10 p-3 text-sm font-semibold text-primary">All your matches are played.</p>}
          <details className="mt-4 group">
            <summary className="cursor-pointer select-none text-sm font-semibold text-primary">All my fixtures ({played} of {r.fixtures.length} played)</summary>
            <ul className="mt-2 divide-y divide-border/60 rounded-lg border border-border">
              {r.fixtures.map((f) => <FixtureRow key={f.id} f={f} due={deadlines?.get(f.round)} />)}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">Something wrong with a result? <Link to="/status" className="underline">Dispute it on your status page</Link>.</p>
          </details>
        </>
      )}
    </section>
  );
}

function NextMatch({ f, due }: { f: MyFixture; due: string | undefined }) {
  const late = due ? isPast(due) : false;
  return (
    <div className="mt-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-primary">Your next match · Round {f.round}</p>
      <p className="mt-1 font-display text-2xl font-bold">vs {f.opponent}{f.opponent_team && <span className="ml-2 text-sm font-normal text-muted-foreground">{f.opponent_team}</span>}</p>
      <p className="mt-1 text-sm text-muted-foreground">{f.is_home ? "You are home" : "You are away"}</p>
      {due && (
        <p className={cn("mt-2 inline-flex items-center gap-1.5 text-sm font-semibold", late ? "text-destructive" : "text-foreground")}>
          <CalendarClock className="h-4 w-4" />
          {late ? "Was due" : "Play by"} {formatDue(due)}
        </p>
      )}
    </div>
  );
}

function FixtureRow({ f, due }: { f: MyFixture; due: string | undefined }) {
  const mine = f.is_home ? f.home_score : f.away_score;
  const theirs = f.is_home ? f.away_score : f.home_score;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
      <span className="w-10 text-xs font-bold uppercase text-muted-foreground">Rd {f.round}</span>
      <span className="min-w-0 flex-1 truncate">{f.is_home ? "Home" : "Away"} vs <b>{f.opponent}</b></span>
      <span className="font-display text-base font-bold">{f.status === "confirmed" ? `${mine} - ${theirs}` : f.status === "disputed" ? "Disputed" : "To play"}</span>
      {f.status === "scheduled" && due && <span className={cn("w-full pl-[52px] text-xs", isPast(due) ? "text-destructive" : "text-muted-foreground")}>Due {formatDue(due)}</span>}
    </li>
  );
}

function Finder({ notFound, onFound, onForget }: { notFound: boolean; onFound: (s: Saved) => void; onForget?: (() => void) | undefined }) {
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(notFound);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const ref = String(f.get("ref") ?? "").trim();
    const phone = String(f.get("phone") ?? "").trim();
    setBusy(true);
    try {
      const found = await lookup(ref, phone);
      if (!found) { setMissing(true); return; }
      const s = { ref: found.reference, phone };
      saveMine(s);
      onFound(s);
    } catch { setMissing(true); } finally { setBusy(false); }
  }
  return (
    <section className="panel mb-6 p-5" aria-label="Find my matches">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">My matches</p>
      <p className="mt-1 font-display text-2xl font-bold">Find your fixtures</p>
      <p className="mt-1 text-sm text-muted-foreground">Enter your details once and this device remembers them.</p>
      <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <Input name="ref" required placeholder="Reference or eFootball username" autoComplete="off" className="h-11" aria-label="Reference or eFootball username" />
        <Input name="phone" required inputMode="tel" placeholder="Phone you registered with" className="h-11" aria-label="Phone number" />
        <Button type="submit" variant="hero" className="h-11" disabled={busy}>{busy ? "Looking…" : "Show my matches"}</Button>
      </form>
      {missing && <p role="alert" className="mt-2 text-sm text-destructive">No registration matches those details. Check the phone number you registered with.</p>}
      {onForget && <button type="button" onClick={onForget} className="mt-2 text-xs text-muted-foreground underline">Forget the saved details on this device</button>}
    </section>
  );
}
