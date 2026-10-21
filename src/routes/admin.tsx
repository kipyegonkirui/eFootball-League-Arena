import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { PageShell, StatusBadge } from "@/components/site";
import { useDialogs } from "@/components/dialogs";
import { formatKes, friendlyError } from "@/lib/tournament";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Admin — eFootball Arena Kenya" },
      { name: "description", content: "Organiser dashboard." },
      { property: "og:title", content: "Admin — eFootball Arena Kenya" },
      { property: "og:description", content: "Organiser dashboard." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const nav = useNavigate();
  const { data: me, isLoading } = useQuery({
    queryKey: ["admin-me"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return { user: null, admin: false };
      const { data } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
      return { user: u.user, admin: !!data };
    },
  });
  if (isLoading) return <PageShell title="Admin">Loading…</PageShell>;
  if (!me?.user) return <PageShell title="Admin"><Button asChild variant="hero"><Link to="/auth">Sign in</Link></Button></PageShell>;
  if (!me.admin)
    return (
      <PageShell title="Not authorised">
        <p className="text-muted-foreground">This account has no admin access.</p>
        <Button className="mt-4" variant="outline" onClick={async () => { await supabase.auth.signOut(); nav({ to: "/auth", replace: true }); }}>Sign out</Button>
      </PageShell>
    );
  return <Dashboard />;
}

type Reg = { seasons: { number: number; status: string } | null; efootball_id: string | null; team_name: string | null; id: string; reference: string; gamer_tag: string; full_name: string; phone: string; email: string | null; platform: string; status: string; slot_number: number | null; created_at: string; tournament_groups: { group_number: number } | null; payment_submissions: { transaction_code: string; amount_kes: number; expected_fee_kes: number; screenshot_path: string | null; payer_phone: string }[] };

function Dashboard() {
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const nav = useNavigate();
  async function logout() { await supabase.auth.signOut(); qc.clear(); nav({ to: "/auth", replace: true }); }
  const [filter, setFilter] = useState("");
  const regs = useQuery({
    queryKey: ["admin-regs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("registrations").select("*, seasons(number, status), tournament_groups(group_number), payment_submissions(transaction_code, amount_kes, expected_fee_kes, screenshot_path, payer_phone)").order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Reg[];
    },
  });
  const all = regs.data ?? [];
  const pending = all.filter((r) => r.status === "pending");
  // Cards and open slots describe the season that is open for sign-ups; older seasons stay in the table below.
  const verified = all.filter((r) => r.status === "verified" && r.seasons?.status === "registration");
  const collected = verified.reduce((s, r) => s + (r.payment_submissions[0]?.amount_kes ?? 0), 0);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["admin-regs"] }); qc.invalidateQueries({ queryKey: ["public-tournament"] }); qc.invalidateQueries({ queryKey: ["admin-settings"] }); };

  async function decide(id: string, decision: "verified" | "rejected") {
    let reason: string | null = null;
    if (decision === "rejected") {
      const answer = await dialogs.prompt({ title: "Reject this registration?", description: "The player sees this reason on the status page and can register again with a valid payment.", label: "Reason for rejection", placeholder: "e.g. M-Pesa code not found, or amount is less than the fee", confirmLabel: "Reject registration", tone: "danger", minLength: 3 });
      if (answer === null) return;
      reason = answer;
    }
    const { error } = await supabase.rpc("admin_decide_registration", { _registration_id: id, _decision: decision, _reason: reason ?? "" });
    if (error) return toast.error(friendlyError(error));
    toast.success(decision === "verified" ? "Verified and slot assigned" : "Rejected");
    refresh();
  }
  async function viewProof(path: string) {
    const { data, error } = await supabase.storage.from("payment-proofs").createSignedUrl(path, 120);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank");
  }
  function exportCsv() {
    const rows = [["reference", "gamer_tag", "efootball_id", "team_name", "full_name", "phone", "platform", "status", "group", "slot", "code", "amount"], ...all.map((r) => [r.reference, r.gamer_tag, r.efootball_id ?? "", r.team_name ?? "", r.full_name, r.phone, r.platform, r.status, r.tournament_groups?.group_number ?? "", r.slot_number ?? "", r.payment_submissions[0]?.transaction_code ?? "", r.payment_submissions[0]?.amount_kes ?? ""])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "registrations.csv"; a.click();
  }
  const shown = all.filter((r) => !filter || `${r.gamer_tag} ${r.reference} ${r.phone} ${r.status}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <PageShell kicker="Organiser" title="Dashboard">
      <div className="mb-4 flex justify-end"><Button variant="outline" onClick={logout}>Log out</Button></div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Card l="Verified" v={String(verified.length)} /><Card l="Pending payments" v={String(pending.length)} />
        <Card l="Verified collections" v={formatKes(collected)} /><OpenSlots verified={verified.length} />
      </div>

      <h2 className="mt-10 text-3xl font-bold uppercase">Pending queue</h2>
      {pending.length === 0 && <p className="mt-2 text-muted-foreground">No payments awaiting verification.</p>}
      <div className="mt-4 space-y-3">
        {pending.map((r) => { const p = r.payment_submissions[0]; return (
          <div key={r.id} className="panel flex flex-col gap-3 p-4 md:flex-row md:items-center">
            <div className="flex-1 text-sm">
              <p className="font-display text-xl font-bold">{r.gamer_tag} <span className="text-sm font-normal text-muted-foreground">{r.reference}</span></p>
              <p className="text-muted-foreground">{r.full_name} · {r.phone} · {r.platform} · Team {r.team_name ?? "—"}</p>
              {p && <p>Code <b>{p.transaction_code}</b> · {formatKes(p.amount_kes)} (fee {formatKes(p.expected_fee_kes)}) · paid from {p.payer_phone}</p>}
            </div>
            <div className="flex gap-2">
              {p?.screenshot_path && <Button variant="outline" size="sm" onClick={() => viewProof(p.screenshot_path!)}>Proof</Button>}
              <Button variant="success" size="sm" onClick={() => decide(r.id, "verified")}>Approve</Button>
              <Button variant="destructive" size="sm" onClick={() => decide(r.id, "rejected")}>Reject</Button>
            </div>
          </div>
        ); })}
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-3">
        <h2 className="text-3xl font-bold uppercase">All registrations</h2>
        <Input placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-10 max-w-xs" />
        <Button variant="outline" onClick={exportCsv}>Export CSV</Button>
      </div>
      <div className="panel mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground"><tr><th className="p-3">Tag</th><th>Season</th><th>Ref</th><th>Status</th><th>Group/Slot</th><th>Code</th></tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r.id} className="border-t border-border"><td className="p-3 font-semibold">{r.gamer_tag}</td><td>{r.seasons ? `S${r.seasons.number}` : "—"}</td><td>{r.reference}</td><td><StatusBadge status={r.status} /></td>
              <td>{r.tournament_groups ? `${String.fromCharCode(64 + r.tournament_groups.group_number)} / ${r.slot_number}` : "—"}</td><td>{r.payment_submissions[0]?.transaction_code}</td></tr>
          ))}</tbody>
        </table>
      </div>

      <LeagueAdmin />

      <Settings onSaved={refresh} />
    </PageShell>
  );
}

function Card({ l, v }: { l: string; v: string }) {
  return <div className="panel p-4"><p className="text-xs uppercase text-muted-foreground">{l}</p><p className="font-display text-3xl font-bold">{v}</p></div>;
}

function useSettings() {
  return useQuery({ queryKey: ["admin-settings"], queryFn: async () => { const { data, error } = await supabase.from("tournament_settings").select("*").eq("id", 1).single(); if (error) throw error; return data; } });
}
function OpenSlots({ verified }: { verified: number }) {
  const { data } = useSettings();
  return <Card l="Open slots" v={data ? String(data.group_capacity * data.max_groups - verified) : "—"} />;
}

function Settings({ onSaved }: { onSaved: () => void }) {
  const { data: s } = useSettings();
  if (!s) return null;
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const patch: Record<string, unknown> = Object.fromEntries(["name", "description", "mpesa_paybill", "mpesa_till", "mpesa_account_reference", "payment_instructions", "start_date"].map((k) => [k, String(f.get(k) ?? "")]));
    patch.fee_kes = Number(f.get("fee_kes")); patch.group_capacity = Number(f.get("group_capacity")); patch.max_groups = Number(f.get("max_groups"));
    for (const k of ["prize_percent", "prize_first_pct", "prize_second_pct", "prize_third_pct"]) patch[k] = Number(f.get(k));
    patch.registration_open = f.get("registration_open") === "on";
    const { error } = await supabase.rpc("admin_update_settings", { _patch: patch as never });
    if (error) return toast.error(friendlyError(error));
    toast.success("Settings saved"); onSaved();
  }
  const fld = (k: string, l: string, v: unknown, type = "text") => <div className="space-y-1.5"><Label>{l}</Label><Input name={k} type={type} defaultValue={(v as string) ?? ""} className="h-10" /></div>;
  return (
    <form onSubmit={save} className="panel mt-10 grid gap-4 p-6 md:grid-cols-2">
      <h2 className="text-3xl font-bold uppercase md:col-span-2">Settings</h2>
      {fld("name", "Tournament name", s.name)}{fld("fee_kes", "Registration fee (KES)", s.fee_kes, "number")}
      <div className="md:col-span-2">{fld("description", "Description", s.description)}</div>
      {fld("mpesa_paybill", "M-Pesa Paybill", s.mpesa_paybill)}{fld("mpesa_till", "M-Pesa Till", s.mpesa_till)}
      {fld("mpesa_account_reference", "Account / reference", s.mpesa_account_reference)}{fld("start_date", "Kick-off date", s.start_date)}
      <div className="md:col-span-2">{fld("payment_instructions", "Payment instructions", s.payment_instructions)}</div>
      {fld("group_capacity", "Players per group (default 8)", s.group_capacity, "number")}{fld("max_groups", "Max groups", s.max_groups, "number")}
      <h3 className="text-xl font-bold uppercase md:col-span-2">Prizes</h3>
      {fld("prize_percent", "Share of verified fees paid out (%)", s.prize_percent, "number")}<div />
      {fld("prize_first_pct", "1st place (% of pool)", s.prize_first_pct, "number")}{fld("prize_second_pct", "2nd place (% of pool)", s.prize_second_pct, "number")}
      {fld("prize_third_pct", "3rd place (% of pool)", s.prize_third_pct, "number")}<p className="self-end text-xs text-muted-foreground">The three places must total 100%.</p>
      <label className="flex items-center gap-2"><input type="checkbox" name="registration_open" defaultChecked={s.registration_open} /> Registration open</label>
      <Button type="submit" variant="hero" className="md:col-span-2">Save settings</Button>
    </form>
  );
}

type AFixture = { id: string; group_number: number; round: number; home_tag: string; away_tag: string; home_score: number | null; away_score: number | null; status: "scheduled" | "confirmed" | "disputed"; result_type?: "played" | "no_show"; result_reason?: string | null };
type AGroup = { group_number: number; capacity: number; is_full: boolean; league_format: "one_week" | "two_week" | null; has_fixtures: boolean; verified: number; one_week_votes: number; two_week_votes: number };
type AWinner = { place: number; gamer_tag: string; team_name: string | null; points: number; prize_kes: number };
type ASeason = { number: number; status: "running" | "completed"; started_at: string | null; ended_at: string | null; prize: { prize_pool_kes: number; winners?: AWinner[] } | null; fixtures_total: number; fixtures_done: number };
type ADispute = { id: string; fixture_id: string; raised_by: string; note: string; created_at: string; season?: number; group_number: number; round: number; home_tag: string; away_tag: string; home_score: number | null; away_score: number | null };
type Overview = { registration_season: number | null; can_generate: boolean; selected: number | null; groups: AGroup[]; seasons: ASeason[]; fixtures: AFixture[]; disputes: ADispute[] };

const FORMAT_NAME = { one_week: "1-week league", two_week: "2-week league (home & away)" } as const;
const letter = (n: number) => String.fromCharCode(64 + n);

function LeagueAdmin() {
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const [group, setGroup] = useState(1);
  const [season, setSeason] = useState<number | undefined>(undefined);
  const ov = useQuery({
    queryKey: ["admin-league", season ?? "default"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_league_overview", season ? { _season: season } : {});
      if (error) throw error;
      return data as unknown as Overview;
    },
  });
  const refresh = () => {
    for (const k of ["admin-league", "public-league", "public-fixtures", "public-tournament", "admin-regs"]) qc.invalidateQueries({ queryKey: [k] });
  };
  const d = ov.data;
  const fixtures = d?.fixtures ?? [];
  const disputes = d?.disputes ?? [];
  const lgroups = d?.groups ?? [];
  const seasons = d?.seasons ?? [];
  const canStart = d?.can_generate ?? false;
  const selected = seasons.find((s) => s.number === d?.selected) ?? null;
  const locked = selected?.status === "completed";
  const groupNums = [...new Set(fixtures.map((f) => f.group_number))].sort((x, y) => x - y);
  const activeGroup = groupNums.includes(group) ? group : groupNums[0] ?? 1;
  const shown = fixtures.filter((f) => f.group_number === activeGroup);

  async function startLeague() {
    const ready = lgroups.filter((g) => g.is_full && !g.has_fixtures);
    const waiting = lgroups.filter((g) => !g.is_full);
    const lines = [
      ...ready.map((g) => `Group ${letter(g.group_number)} starts as a ${g.one_week_votes > g.two_week_votes ? FORMAT_NAME.one_week : FORMAT_NAME.two_week} (${g.one_week_votes} chose 1 week, ${g.two_week_votes} chose 2 weeks).`),
      ...waiting.map((g) => `Group ${letter(g.group_number)} has only ${g.verified} of ${g.capacity} players. They move to Season ${(d?.registration_season ?? 0) + 1} with their payments.`),
    ];
    const go = await dialogs.confirm({
      title: `Start Season ${d?.registration_season}?`,
      description: "This cannot be undone. Sign-ups for the next season open automatically.",
      details: lines,
      confirmLabel: "Start league",
      tone: "success",
    });
    if (!go) return;
    const { data, error } = await supabase.rpc("admin_generate_fixtures");
    if (error) return toast.error(friendlyError(error));
    const r = data as unknown as { fixtures: number; season: number; next_season: number; carried: { players: number; pending: number } };
    toast.success(`Season ${r.season} started with ${r.fixtures} fixtures. Season ${r.next_season} is now open for sign-ups (${r.carried.players} players carried over).`);
    setSeason(r.season);
    refresh();
  }
  async function endSeason(n: number) {
    const go = await dialogs.confirm({
      title: `End Season ${n}?`,
      description: "The prize pool and winners are frozen and its results are locked. This cannot be undone.",
      confirmLabel: "End season",
      tone: "danger",
    });
    if (!go) return;
    const { data, error } = await supabase.rpc("admin_end_season", { _season: n });
    if (error) return toast.error(friendlyError(error));
    const w = (data as unknown as { winners: AWinner[] | null }).winners ?? [];
    toast.success(`Season ${n} ended. Winners: ${w.map((x) => `${x.place}. ${x.gamer_tag}`).join(", ")}`);
    setSeason(n);
    refresh();
  }
  async function record(id: string, home: string, away: string, type: "played" | "no_show" = "played", reason = ""): Promise<boolean> {
    if (type === "played" && (home === "" || away === "")) { toast.error("Enter both scores."); return false; }
    const { error } = await supabase.rpc("admin_record_result", { _fixture_id: id, _home: Number(home || 0), _away: Number(away || 0), _result_type: type, _reason: reason });
    if (error) { toast.error(friendlyError(error)); return false; }
    toast.success(type === "no_show" ? "Recorded as no-show: 0-0, no points" : "Result saved");
    refresh();
    return true;
  }
  async function resolve(dp: ADispute, home: string, away: string, note: string, voidIt: boolean) {
    if (!note.trim()) return toast.error("Add a resolution note.");
    if (!voidIt && (home === "" || away === "")) return toast.error("Enter the final scores or choose Void.");
    const { error } = await supabase.rpc("admin_resolve_dispute", { _fixture_id: dp.fixture_id, _home: voidIt ? (null as never) : Number(home), _away: voidIt ? (null as never) : Number(away), _note: note });
    if (error) return toast.error(friendlyError(error));
    toast.success(voidIt ? "Result voided, match back to scheduled" : "Dispute resolved"); refresh();
  }

  return (
    <section className="mt-10">
      <h2 className="text-3xl font-bold uppercase">Seasons &amp; league</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        A season is one league. When the groups that are ready are full, start the league; players who are not in a full group, and any pending payments, move to the next season automatically, and its sign-ups open straight away.
      </p>

      <div className="panel mt-5 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-2xl font-bold uppercase">Season {d?.registration_season ?? "—"} <span className="text-sm font-normal text-muted-foreground">sign-ups open</span></h3>
          <Button variant="hero" onClick={startLeague} disabled={!canStart}>{canStart ? "Start league with ready groups" : "Waiting for a full group"}</Button>
        </div>
        {lgroups.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No players verified in this season yet.</p>}
        {lgroups.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {lgroups.map((g) => {
              const votes = g.one_week_votes + g.two_week_votes;
              const pct = (n: number) => (votes ? Math.round((n / votes) * 100) : 0);
              const leading = g.one_week_votes > g.two_week_votes ? FORMAT_NAME.one_week : FORMAT_NAME.two_week;
              return (
                <div key={g.group_number} className="rounded-lg border border-border p-4 text-sm">
                  <p className="font-display text-lg font-bold uppercase">Group {letter(g.group_number)} <span className="text-xs font-normal text-muted-foreground">{g.verified} of {g.capacity} verified</span></p>
                  <p className="mt-2">1 week: <b>{g.one_week_votes}</b> ({pct(g.one_week_votes)}%)</p>
                  <p>2 weeks: <b>{g.two_week_votes}</b> ({pct(g.two_week_votes)}%)</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {g.is_full ? <>Ready. Will use: <b className="text-foreground">{leading}</b></> : "Not full. Moves to the next season if you start now."}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {seasons.length > 0 && (
        <div className="mt-5 space-y-3">
          {seasons.map((s) => {
            const finished = s.fixtures_total > 0 && s.fixtures_done === s.fixtures_total;
            return (
              <div key={s.number} className={"panel flex flex-col gap-3 p-4 md:flex-row md:items-center " + (s.number === d?.selected ? "border-primary" : "")}>
                <div className="flex-1 text-sm">
                  <p className="font-display text-xl font-bold uppercase">Season {s.number} <span className={"ml-2 rounded-full px-2 py-0.5 text-xs font-semibold normal-case " + (s.status === "running" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>{s.status === "running" ? "Running" : "Ended"}</span></p>
                  <p className="text-muted-foreground">{s.fixtures_done} of {s.fixtures_total} matches played{s.status === "completed" && s.prize ? ` · prize pool ${formatKes(s.prize.prize_pool_kes)}` : ""}</p>
                  {s.status === "completed" && s.prize?.winners && s.prize.winners.length > 0 && (
                    <p className="mt-1">{s.prize.winners.map((w) => `${w.place}. ${w.gamer_tag} (${formatKes(w.prize_kes)})`).join("  ·  ")}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setSeason(s.number)}>View fixtures</Button>
                  {s.status === "running" && <Button size="sm" variant="success" disabled={!finished} onClick={() => endSeason(s.number)} title={finished ? "" : "Finish every match first"}>End season</Button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {disputes.length > 0 && (
        <div className="mt-6 space-y-3">
          <h3 className="text-xl font-bold uppercase text-destructive">Open disputes ({disputes.length})</h3>
          {disputes.map((x) => <DisputeCard key={x.id} d={x} onResolve={resolve} />)}
        </div>
      )}

      {ov.error && <p className="mt-4 text-destructive">Couldn't load the league.</p>}
      {fixtures.length === 0 && !ov.isLoading && seasons.length === 0 && <p className="mt-4 text-muted-foreground">No fixtures yet. They are created when you start the league.</p>}
      {groupNums.length > 0 && (
        <>
          <h3 className="mt-8 text-2xl font-bold uppercase">Season {d?.selected} fixtures {locked && <span className="text-sm font-normal text-muted-foreground">· ended, results locked</span>}</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {groupNums.map((g) => <Button key={g} size="sm" variant={g === activeGroup ? "hero" : "outline"} onClick={() => setGroup(g)}>Group {letter(g)}</Button>)}
          </div>
          <div className="mt-4 space-y-4">
            {[...new Set(shown.map((f) => f.round))].sort((x, y) => x - y).map((round) => {
              const list = shown.filter((f) => f.round === round);
              const done = list.filter((f) => f.status === "confirmed").length;
              return (
                <div key={round} className={"panel overflow-hidden " + (round % 2 === 0 ? "bg-primary/[0.04]" : "bg-card")}>
                  <div className={"flex items-center justify-between border-b border-border px-4 py-2 " + (round % 2 === 0 ? "bg-accent/15" : "bg-primary/15")}>
                    <h3 className="font-display text-lg font-bold uppercase tracking-wide">Round {round}</h3>
                    <span className="text-xs text-muted-foreground">{done} of {list.length} played</span>
                  </div>
                  <div className="divide-y divide-border/60">
                    {list.map((f) => <ResultRow key={f.id + f.status + f.home_score + f.away_score + f.result_type} f={f} locked={locked} onSave={record} />)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function ResultRow({ f, locked = false, onSave }: { f: AFixture; locked?: boolean; onSave: (id: string, h: string, a: string, type?: "played" | "no_show", reason?: string) => Promise<boolean> }) {
  const noShow = f.result_type === "no_show";
  const [h, setH] = useState(f.home_score?.toString() ?? "");
  const [a, setA] = useState(f.away_score?.toString() ?? "");
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"played" | "no_show">("played");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const num = "h-9 w-16 text-center";

  function askOrSave() {
    if (h === "" || a === "") return toast.error("Enter both scores.");
    // 0-0 is ambiguous: a real draw (1 point each) or a double no-show (0 points each). Ask.
    if (Number(h) === 0 && Number(a) === 0) { setKind("played"); setReason(""); setOpen(true); return; }
    void onSave(f.id, h, a);
  }
  function askNoShow() { setH("0"); setA("0"); setKind("no_show"); setReason(""); setOpen(true); }
  async function confirm() {
    if (kind === "no_show" && reason.trim().length < 5) return toast.error("Enter the reason (at least 5 characters).");
    setSaving(true);
    const ok = await onSave(f.id, "0", "0", kind, reason);
    setSaving(false);
    if (ok) setOpen(false);
  }

  return (
    <div className="px-4 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-[110px] flex-1 text-right font-semibold">{f.home_tag}</span>
        <Input className={num} type="number" min={0} max={99} value={h} onChange={(e) => setH(e.target.value)} disabled={locked || f.status === "disputed"} aria-label={`${f.home_tag} goals`} />
        <span>-</span>
        <Input className={num} type="number" min={0} max={99} value={a} onChange={(e) => setA(e.target.value)} disabled={locked || f.status === "disputed"} aria-label={`${f.away_tag} goals`} />
        <span className="min-w-[110px] flex-1 font-semibold">{f.away_tag}</span>
        {locked ? null : f.status === "disputed" ? <StatusBadge status="pending" className="normal-case" /> : (
          <>
            <Button size="sm" variant={f.status === "confirmed" ? "outline" : "success"} onClick={askOrSave}>{f.status === "confirmed" ? "Correct" : "Save"}</Button>
            <Button size="sm" variant="ghost" onClick={askNoShow}>No-show</Button>
          </>
        )}
      </div>
      {noShow && f.status === "confirmed" && (
        <p className="mt-1 text-xs text-muted-foreground"><b className="text-foreground">Double no-show · 0 points each.</b> Reason: {f.result_reason}</p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record 0-0: {f.home_tag} vs {f.away_tag}</DialogTitle>
            <DialogDescription>A real 0-0 draw and a match nobody turned up for score differently. Choose what happened.</DialogDescription>
          </DialogHeader>
          <RadioGroup value={kind} onValueChange={(v) => setKind(v as "played" | "no_show")} className="space-y-3">
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
              <RadioGroupItem value="played" className="mt-1" />
              <span><b>They played and drew 0-0</b><br /><span className="text-sm text-muted-foreground">1 point each, counts as a played match.</span></span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
              <RadioGroupItem value="no_show" className="mt-1" />
              <span><b>Neither player showed or replied</b><br /><span className="text-sm text-muted-foreground">Recorded 0-0 with 0 points for both. A reason is required.</span></span>
            </label>
          </RadioGroup>
          <div className="space-y-1.5">
            <Label>{kind === "no_show" ? "Reason (required)" : "Note (optional)"}</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={kind === "no_show" ? "e.g. Neither player replied in the group chat by the round deadline" : "e.g. Both screenshots show 0-0"} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button variant="hero" onClick={confirm} disabled={saving}>{saving ? "Saving…" : "Save result"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DisputeCard({ d, onResolve }: { d: ADispute; onResolve: (d: ADispute, h: string, a: string, note: string, voidIt: boolean) => void }) {
  const [h, setH] = useState(d.home_score?.toString() ?? "");
  const [a, setA] = useState(d.away_score?.toString() ?? "");
  const [note, setNote] = useState("");
  return (
    <div className="panel space-y-3 p-4">
      <p className="text-sm"><b>{d.raised_by}</b> disputed {d.season ? `Season ${d.season}, ` : ""}Group {String.fromCharCode(64 + d.group_number)}, Round {d.round}: {d.home_tag} {d.home_score}-{d.away_score} {d.away_tag}</p>
      <p className="rounded-md bg-muted p-3 text-sm">“{d.note}”</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-9 w-16 text-center" type="number" min={0} max={99} value={h} onChange={(e) => setH(e.target.value)} aria-label="Final home goals" />
        <span>-</span>
        <Input className="h-9 w-16 text-center" type="number" min={0} max={99} value={a} onChange={(e) => setA(e.target.value)} aria-label="Final away goals" />
        <Input className="h-9 min-w-[200px] flex-1" placeholder="Resolution note (required)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button size="sm" variant="success" onClick={() => onResolve(d, h, a, note, false)}>Confirm score</Button>
        <Button size="sm" variant="destructive" onClick={() => onResolve(d, h, a, note, true)}>Void &amp; replay</Button>
      </div>
    </div>
  );
}
