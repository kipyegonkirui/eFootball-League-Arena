import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageShell, StatusBadge } from "@/components/site";
import { useDialogs } from "@/components/dialogs";
import { friendlyError } from "@/lib/tournament";
import { clearMine, loadMine, saveMine } from "@/lib/saved";
import { formatDue, isPast, roundDeadlinesQuery, type MyRegistration } from "@/lib/league";
import { OpponentWhatsApp } from "@/components/my-matches";
import { MatchScreenshotUpload } from "@/components/match-screenshot";

export const Route = createFileRoute("/status")({
  head: () => ({
    meta: [
      { title: "Check Registration Status — eFootball Arena Kenya" },
      { name: "description", content: "Look up your registration with your reference and phone number." },
      { property: "og:title", content: "Check Status — eFootball Arena Kenya" },
      { property: "og:description", content: "See if your payment is verified and your group slot." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { ref?: string } => ({ ref: typeof s.ref === "string" ? s.ref.slice(0, 40) : undefined }),
  component: StatusPage,
});

type R = MyRegistration;

function StatusPage() {
  const dialogs = useDialogs();
  const [r, setR] = useState<R | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [creds, setCreds] = useState<{ ref: string; phone: string } | null>(null);
  const { ref: refParam } = Route.useSearch();
  const [saved, setSaved] = useState<{ ref: string; phone: string } | null>(null);
  const [ready, setReady] = useState(false);
  const auto = useRef(false);
  const deadlines = useQuery(roundDeadlinesQuery(r?.season_status === "running" ? r.season_number ?? undefined : undefined)).data;
  async function lookup(ref: string, phone: string) {
    setBusy(true);
    const { data, error } = await supabase.rpc("lookup_registration", { _reference: ref, _phone: phone });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    const found = (data as unknown as R | null) ?? null;
    setR(found);
    if (found) { saveMine({ ref: found.reference, phone }); setSaved({ ref: found.reference, phone }); }
  }
  // Open the page already filled in: from a shared link (?ref=), or this device's last registration.
  useEffect(() => {
    const mine = loadMine();
    setSaved(mine);
    setReady(true);
    if (!auto.current && mine && (!refParam || refParam.toUpperCase() === mine.ref)) {
      auto.current = true;
      setCreds(mine);
      lookup(mine.ref, mine.phone);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function forget() { clearMine(); setSaved(null); setR(undefined); setCreds(null); toast.success("Removed from this device"); }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const c = { ref: String(f.get("ref")), phone: String(f.get("phone")) };
    setCreds(c);
    await lookup(c.ref, c.phone);
  }
  async function dispute(fixtureId: string) {
    if (!creds) return;
    const note = await dialogs.prompt({ title: "Dispute this result", description: "An organiser reviews every dispute. Until then the match is held back from the table.", label: "What is wrong with this result?", placeholder: "e.g. the real score was 2-1, or the match was not played", confirmLabel: "Send dispute", minLength: 5 });
    if (note === null) return;
    const { error } = await supabase.rpc("raise_dispute", { _reference: creds.ref, _phone: creds.phone, _fixture_id: fixtureId, _note: note });
    if (error) return toast.error(friendlyError(error));
    toast.success("Dispute sent. An organiser will review it.");
    await lookup(creds.ref, creds.phone);
  }
  return (
    <PageShell kicker="Players" title="Check status">
      <div className="grid gap-6 md:grid-cols-2">
        <form onSubmit={submit} className="panel space-y-4 p-6" key={ready ? "ready" : "init"}>
          <div className="space-y-1.5">
            <Label>Reference, M-Pesa code or eFootball username</Label>
            <Input name="ref" required defaultValue={refParam ?? saved?.ref ?? ""} placeholder="EFA-XXXXXXXX" autoCapitalize="characters" autoComplete="off" className="h-11" />
            <p className="text-xs text-muted-foreground">Lost your reference? Type your M-Pesa transaction code or your eFootball username instead.</p>
          </div>
          <div className="space-y-1.5"><Label>Phone used to register</Label><Input name="phone" required inputMode="tel" defaultValue={saved?.phone ?? ""} placeholder="0712 345 678" className="h-11" /></div>
          <Button type="submit" variant="hero" className="w-full" disabled={busy}>{busy ? "Checking…" : "Check status"}</Button>
          {saved && <button type="button" onClick={forget} className="w-full text-center text-xs text-muted-foreground underline">Not you? Forget this device</button>}
        </form>
        {r === null && <p className="panel p-6 text-muted-foreground">No registration matches those details. Check the phone number you registered with, and try your M-Pesa code or eFootball username if the reference does not work.</p>}
        {r && (
          <div className="panel space-y-3 p-6">
            <StatusBadge status={r.status} />
            {r.season_number ? <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Season {r.season_number}{r.season_status === "completed" ? " · ended" : ""}</p> : null}
          <p className="font-display text-3xl font-bold">{r.gamer_tag}{r.team_name && <span className="ml-2 text-base font-normal text-muted-foreground">{r.team_name}</span>}</p>
            <p className="text-sm text-muted-foreground">{r.reference} · phone {r.phone_hint}</p>
            {r.status === "verified" && <p className="text-lg">Group <b className="text-primary">{String.fromCharCode(64 + (r.group_number ?? 1))}</b>, slot <b className="text-primary">{r.slot_number}</b>. {r.fixtures.length === 0 ? "Fixtures appear once your group is full." : ""}</p>}
            {r.status === "pending" && <p className="text-sm">We're checking your M-Pesa payment. Your seat is assigned only after verification.</p>}
            {r.status === "rejected" && <p className="text-sm">Reason: {r.reason ?? "—"}. You may register again with a valid payment.</p>}
          </div>
        )}
      </div>
      {r && r.fixtures.length > 0 && (
        <div className="panel mt-6 overflow-hidden">
          <p className="border-b border-border px-4 py-3 text-2xl font-bold uppercase">My fixtures</p>
          <ul className="divide-y divide-border/60">
            {r.fixtures.map((f) => {
              const canAct = r.status === "verified" && !!creds && f.status === "scheduled";
              const mine = f.is_home ? f.home_score : f.away_score;
              const theirs = f.is_home ? f.away_score : f.home_score;
              return (
                <li key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <span className="w-16 text-xs font-bold uppercase text-muted-foreground">Rd {f.round}</span>
                  <span className="flex-1"><b>{f.is_home ? "Home" : "Away"}</b> vs {f.opponent}{f.opponent_team && <span className="text-muted-foreground"> ({f.opponent_team})</span>}</span>
                  <span className="font-display text-lg font-bold">{f.status === "confirmed" ? `${mine} - ${theirs}` : f.status === "disputed" ? "Disputed" : "To play"}</span>
                  {f.status === "confirmed" && <Button size="sm" variant="outline" onClick={() => dispute(f.id)}>Dispute</Button>}
                  {f.status === "disputed" && f.my_dispute_open && <span className="text-xs text-muted-foreground">Under review</span>}
                  {canAct && creds && <span className="w-full"><OpponentWhatsApp creds={creds} fixture={f} me={r.gamer_tag} due={deadlines?.get(f.round)} /><MatchScreenshotUpload creds={creds} fixture={f} /></span>}
                  {f.status === "scheduled" && deadlines?.get(f.round) && <span className={"w-full pl-[76px] text-xs " + (isPast(deadlines.get(f.round)!) ? "text-destructive" : "text-muted-foreground")}>Due {formatDue(deadlines.get(f.round)!)}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </PageShell>
  );
}
