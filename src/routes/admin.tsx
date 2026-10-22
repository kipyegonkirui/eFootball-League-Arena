import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
import { formatDue, isPast, roundDeadlinesQuery } from "@/lib/league";

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

type Reg = { seasons: { number: number; status: string } | null; efootball_id: string | null; team_name: string | null; id: string; reference: string; gamer_tag: string; full_name: string; phone: string; email: string | null; platform: string; status: string; slot_number: number | null; created_at: string; tournament_groups: { group_number: number } | null; payment_submissions: { method?: string; transaction_code: string; amount_kes: number; expected_fee_kes: number; screenshot_path: string | null; payer_phone: string }[]; verification_audit: { decision: string; reason: string | null; created_at: string }[] };

function Dashboard() {
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const nav = useNavigate();
  async function logout() { await supabase.auth.signOut(); qc.clear(); nav({ to: "/auth", replace: true }); }
  const [filter, setFilter] = useState("");
  const regs = useQuery({
    queryKey: ["admin-regs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("registrations").select("*, seasons(number, status), tournament_groups(group_number), payment_submissions(method, transaction_code, amount_kes, expected_fee_kes, screenshot_path, payer_phone), verification_audit(decision, reason, created_at)").order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Reg[];
    },
  });
  const all = regs.data ?? [];
  const pending = all.filter((r) => r.status === "pending");
  // Cards and open slots describe the season that is open for sign-ups; older seasons stay in the table below.
  const verified = all.filter((r) => r.status === "verified" && r.seasons?.status === "registration");
  const collected = verified.reduce((s, r) => s + (r.payment_submissions[0]?.amount_kes ?? 0), 0);
  const refresh = () => { for (const k of ["admin-regs", "public-tournament", "admin-settings", "admin-league", "public-league"]) qc.invalidateQueries({ queryKey: [k] }); };

  async function removePlayer(r: Reg) {
    const spot = r.tournament_groups ? `Group ${String.fromCharCode(64 + r.tournament_groups.group_number)}, slot ${r.slot_number}` : "their slot";
    const reason = await dialogs.prompt({
      title: `Remove ${r.gamer_tag}?`,
      description: `${spot} opens up again for another player. ${r.gamer_tag} is shown as removed on the status page with this reason, and can register again if needed.`,
      label: "Reason for removal",
      placeholder: "e.g. Test player, or no longer able to play",
      confirmLabel: "Remove player",
      tone: "danger",
      minLength: 3,
    });
    if (reason === null) return;
    const { error } = await supabase.rpc("admin_remove_player", { _registration_id: r.id, _reason: reason });
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(`${r.gamer_tag} removed. ${spot} is open again.`);
    refresh();
  }
  const removalReason = (r: Reg) => r.status === "rejected" ? [...(r.verification_audit ?? [])].sort((x, y) => y.created_at.localeCompare(x.created_at))[0]?.reason ?? null : null;

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

      <FreeTrialAdmin />

      <div className="mt-10 flex flex-wrap items-center gap-3">
        <h2 className="text-3xl font-bold uppercase">All registrations</h2>
        <Input placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-10 max-w-xs" />
        <Button variant="outline" onClick={exportCsv}>Export CSV</Button>
      </div>
      <div className="panel mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground"><tr><th className="p-3">Tag</th><th>Season</th><th>Ref</th><th>Status</th><th>Group/Slot</th><th>Code</th><th /></tr></thead>
          <tbody>{shown.map((r) => { const why = removalReason(r); return (
            <tr key={r.id} className="border-t border-border"><td className="p-3 font-semibold">{r.gamer_tag}</td><td>{r.seasons ? `S${r.seasons.number}` : "—"}</td><td>{r.reference}</td>
              <td><StatusBadge status={r.status} />{why && <span className="block max-w-[220px] truncate text-xs text-muted-foreground" title={why}>{why}</span>}</td>
              <td>{r.tournament_groups ? `${String.fromCharCode(64 + r.tournament_groups.group_number)} / ${r.slot_number}` : "—"}</td><td>{r.payment_submissions[0]?.method === "free_trial" ? <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">Free trial</span> : r.payment_submissions[0]?.transaction_code}</td>
              <td className="whitespace-nowrap pr-3 text-right">{r.status === "verified" && r.seasons?.status === "registration" && <Button size="sm" variant="destructive" onClick={() => removePlayer(r)}>Remove</Button>}</td></tr>
          ); })}</tbody>
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

const FORMAT_NAME = { one_week: "single league (7 matches)", two_week: "double league (14 matches, home & away)" } as const;
const letter = (n: number) => String.fromCharCode(64 + n);

function LeagueAdmin() {
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const [group, setGroup] = useState(1);
  const [season, setSeason] = useState<number | undefined>(undefined);
  const [deadlineSeason, setDeadlineSeason] = useState<number | null>(null);
  const ov = useQuery({
    queryKey: ["admin-league", season ?? "default"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_league_overview", season ? { _season: season } : {});
      if (error) throw error;
      return data as unknown as Overview;
    },
  });
  // Player-uploaded result screenshots. If the SQL for this isn't installed yet the list is simply empty.
  const shotsQ = useQuery({
    queryKey: ["admin-shots"],
    retry: false,
    queryFn: async (): Promise<Shot[]> => {
      const { data, error } = await supabase.rpc("admin_match_screenshots");
      if (error) return [];
      return (data ?? []) as unknown as Shot[];
    },
  });
  const shotsFor = (fixtureId: string) => (shotsQ.data ?? []).filter((x) => x.fixture_id === fixtureId);
  const refresh = () => {
    for (const k of ["admin-league", "public-league", "public-fixtures", "public-tournament", "admin-regs", "admin-shots"]) qc.invalidateQueries({ queryKey: [k] });
  };
  const d = ov.data;
  const fixtures = d?.fixtures ?? [];
  const disputes = d?.disputes ?? [];
  const lgroups = d?.groups ?? [];
  const seasons = d?.seasons ?? [];
  const canStart = d?.can_generate ?? false;
  const selected = seasons.find((s) => s.number === d?.selected) ?? null;
  const locked = selected?.status === "completed";
  const deadlines = useQuery(roundDeadlinesQuery(selected?.status === "running" ? selected.number : undefined)).data;
  const dueOf = (round: number) => deadlines?.get(round);
  const overdue = fixtures.filter((x) => x.status === "scheduled" && !!dueOf(x.round) && isPast(dueOf(x.round)!)).length;
  const groupNums = [...new Set(fixtures.map((f) => f.group_number))].sort((x, y) => x - y);
  const activeGroup = groupNums.includes(group) ? group : groupNums[0] ?? 1;
  const shown = fixtures.filter((f) => f.group_number === activeGroup);

  async function startLeague() {
    const ready = lgroups.filter((g) => g.is_full && !g.has_fixtures);
    const waiting = lgroups.filter((g) => !g.is_full);
    const lines = [
      ...ready.map((g) => `Group ${letter(g.group_number)} starts as a ${g.one_week_votes > g.two_week_votes ? FORMAT_NAME.one_week : FORMAT_NAME.two_week} (${g.one_week_votes} chose single, ${g.two_week_votes} chose double).`),
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
                  <p className="mt-2">Single (7 matches): <b>{g.one_week_votes}</b> ({pct(g.one_week_votes)}%)</p>
                  <p>Double (14 matches): <b>{g.two_week_votes}</b> ({pct(g.two_week_votes)}%)</p>
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
                  {s.status === "running" && <Button size="sm" variant="outline" onClick={() => setDeadlineSeason(s.number)}>Set deadlines</Button>}
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
          {disputes.map((x) => <DisputeCard key={x.id} d={x} onResolve={resolve} shots={shotsFor(x.fixture_id)} />)}
        </div>
      )}

      {ov.error && <p className="mt-4 text-destructive">Couldn't load the league.</p>}
      {fixtures.length === 0 && !ov.isLoading && seasons.length === 0 && <p className="mt-4 text-muted-foreground">No fixtures yet. They are created when you start the league.</p>}
      {groupNums.length > 0 && (
        <>
          <h3 className="mt-8 text-2xl font-bold uppercase">Season {d?.selected} fixtures {locked && <span className="text-sm font-normal text-muted-foreground">· ended, results locked</span>}</h3>
          {overdue > 0 && <p className="mt-1 text-sm font-semibold text-destructive">{overdue} {overdue === 1 ? "match is" : "matches are"} overdue. Use Forfeit to give the walkover to the player who showed up, or No-show if neither played.</p>}
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
                    {list.map((f) => <ResultRow key={f.id + f.status + f.home_score + f.away_score + f.result_type} f={f} locked={locked} onSave={record} shots={shotsFor(f.id)} due={dueOf(f.round)} />)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {deadlineSeason !== null && <DeadlinesDialog key={deadlineSeason} season={deadlineSeason} rounds={selected?.number === deadlineSeason ? Math.max(0, ...fixtures.map((x) => x.round)) : 0} onClose={() => setDeadlineSeason(null)} onSaved={refresh} />}
    </section>
  );
}

const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function DeadlinesDialog({ season, rounds, onClose, onSaved }: { season: number; rounds: number; onClose: () => void; onSaved: () => void }) {
  const existing = useQuery(roundDeadlinesQuery(season)).data;
  const [first, setFirst] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(6, 0, 0, 0); return toLocalInput(d); });
  // Aim to finish the league in about 3 days: 7 rounds -> 3 a day, 14 rounds -> 5 a day.
  const [perDay, setPerDay] = useState(String(rounds > 0 ? Math.ceil(rounds / 3) : 3));
  const daysToFinish = rounds > 0 && Number(perDay) >= 1 ? Math.ceil(rounds / Number(perDay)) : null;
  const [saving, setSaving] = useState(false);
  const filled = useRef(false);
  // If deadlines are already set, start from them so changing one date is quick.
  useEffect(() => {
    if (filled.current || !existing || !existing.get(1)) return;
    filled.current = true;
    setFirst(toLocalInput(new Date(existing.get(1)!)));
    const sameDay = [...existing.values()].filter((v) => v === existing.get(1)).length;
    if (sameDay > 0) setPerDay(String(sameDay));
  }, [existing]);

  async function save() {
    const n = Number(perDay);
    if (!first || Number.isNaN(new Date(first).getTime())) { toast.error("Choose when the first deadline falls."); return; }
    if (!Number.isInteger(n) || n < 1 || n > 30) { toast.error("Rounds per day must be from 1 to 30."); return; }
    setSaving(true);
    const { data, error } = await supabase.rpc("admin_set_round_deadlines", { _season: season, _first_due: new Date(first).toISOString(), _rounds_per_day: n });
    setSaving(false);
    if (error) { toast.error(friendlyError(error)); return; }
    const r = data as unknown as { rounds: number; last_due: string };
    toast.success(`Deadlines set for ${r.rounds} rounds. The last round is due ${formatDue(r.last_due)}.`);
    onSaved();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Season {season} round deadlines</DialogTitle>
          <DialogDescription>Each day's window runs from 6am to the next 6am. Players see the deadline next to their fixtures, and overdue matches are flagged here so you can forfeit them. Saving again replaces the dates.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>First deadline (set it to 6:00 am)</Label><Input type="datetime-local" value={first} onChange={(e) => setFirst(e.target.value)} className="h-11" /></div>
          <div className="space-y-1.5"><Label>Rounds per day</Label><Input type="number" min={1} max={30} value={perDay} onChange={(e) => setPerDay(e.target.value)} className="h-11" />
            <p className="text-xs text-muted-foreground">
              {daysToFinish !== null ? <>This season has <b>{rounds} rounds</b>. At {perDay} a day it finishes in <b>{daysToFinish} {daysToFinish === 1 ? "day" : "days"}</b>. </> : null}
              Rounds on the same day share one deadline; the next day's rounds are due 24 hours later.</p></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="hero" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save deadlines"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Shot = { fixture_id: string; gamer_tag: string; path: string; created_at: string };

/** Opens both players' uploaded result screenshots side by side so the organiser can compare them and enter the score. */
function ShotsButton({ shots, title }: { shots: Shot[]; title: string }) {
  const [open, setOpen] = useState(false);
  if (shots.length === 0) return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Screenshots ({shots.length}/2)</Button>
      {open && <ShotsDialog shots={shots} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShotsDialog({ shots, title, onClose }: { shots: Shot[]; title: string; onClose: () => void }) {
  const urls = useQuery({
    queryKey: ["admin-shot-urls", shots.map((x) => x.path).join("|")],
    queryFn: () => Promise.all(shots.map(async (x) => (await supabase.storage.from("match-screenshots").createSignedUrl(x.path, 600)).data?.signedUrl ?? null)),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Compare what each player uploaded, then enter the score on the match row. Tap an image to open it full size.</DialogDescription>
        </DialogHeader>
        <div className={"grid gap-4 " + (shots.length > 1 ? "sm:grid-cols-2" : "")}>
          {shots.map((x, i) => (
            <figure key={x.path} className="space-y-2">
              <figcaption className="text-sm"><b>{x.gamer_tag}</b> <span className="text-muted-foreground">· uploaded {fmtDate(x.created_at)}</span></figcaption>
              {urls.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : urls.data?.[i] ? (
                <a href={urls.data[i]!} target="_blank" rel="noreferrer"><img src={urls.data[i]!} alt={`Result screenshot from ${x.gamer_tag}`} className="w-full rounded-lg border border-border" /></a>
              ) : <p className="text-sm text-destructive">Couldn't load this image.</p>}
            </figure>
          ))}
        </div>
        {shots.length < 2 && <p className="text-sm text-muted-foreground">Only one player has uploaded so far.</p>}
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResultRow({ f, locked = false, onSave, shots = [], due }: { f: AFixture; locked?: boolean; shots?: Shot[]; due?: string | undefined; onSave: (id: string, h: string, a: string, type?: "played" | "no_show", reason?: string) => Promise<boolean> }) {
  const noShow = f.result_type === "no_show";
  const [h, setH] = useState(f.home_score?.toString() ?? "");
  const [a, setA] = useState(f.away_score?.toString() ?? "");
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"played" | "no_show">("played");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [forfeitOpen, setForfeitOpen] = useState(false);
  const [absent, setAbsent] = useState<"home" | "away">("home");
  const [note, setNote] = useState("");
  const late = f.status === "scheduled" && !!due && isPast(due);
  const num = "h-9 w-16 text-center";

  // A forfeit is a 3-0 win for the player who showed up, recorded with the reason so the history explains it.
  async function confirmForfeit() {
    const who = absent === "home" ? f.home_tag : f.away_tag;
    const reasonText = `Forfeit: ${who} did not play by the deadline.${note.trim() ? ` ${note.trim()}` : ""}`;
    setSaving(true);
    const ok = await onSave(f.id, absent === "home" ? "0" : "3", absent === "home" ? "3" : "0", "played", reasonText);
    setSaving(false);
    if (ok) { setForfeitOpen(false); setNote(""); }
  }

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
        {late && <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-bold uppercase text-destructive">Overdue</span>}
        <ShotsButton shots={shots} title={`${f.home_tag} vs ${f.away_tag}`} />
        {locked ? null : f.status === "disputed" ? <StatusBadge status="pending" className="normal-case" /> : (
          <>
            <Button size="sm" variant={f.status === "confirmed" ? "outline" : "success"} onClick={askOrSave}>{f.status === "confirmed" ? "Correct" : "Save"}</Button>
            {f.status === "scheduled" && <Button size="sm" variant={late ? "destructive" : "ghost"} onClick={() => { setAbsent("home"); setNote(""); setForfeitOpen(true); }}>Forfeit</Button>}
            <Button size="sm" variant="ghost" onClick={askNoShow}>No-show</Button>
          </>
        )}
      </div>
      {f.status === "confirmed" && f.result_type !== "no_show" && f.result_reason?.startsWith("Forfeit") && (
        <p className="mt-1 text-xs text-muted-foreground"><b className="text-foreground">Walkover 3-0.</b> {f.result_reason}</p>
      )}
      {noShow && f.status === "confirmed" && (
        <p className="mt-1 text-xs text-muted-foreground"><b className="text-foreground">Double no-show · 0 points each.</b> Reason: {f.result_reason}</p>
      )}

      <Dialog open={forfeitOpen} onOpenChange={setForfeitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Forfeit: {f.home_tag} vs {f.away_tag}</DialogTitle>
            <DialogDescription>Who did not play? The other player is awarded a 3-0 win. If neither player turned up, cancel and use No-show instead.</DialogDescription>
          </DialogHeader>
          <RadioGroup value={absent} onValueChange={(v) => setAbsent(v as "home" | "away")} className="space-y-3">
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
              <RadioGroupItem value="home" className="mt-1" />
              <span><b>{f.home_tag}</b> did not play<br /><span className="text-sm text-muted-foreground">{f.away_tag} wins 0-3.</span></span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
              <RadioGroupItem value="away" className="mt-1" />
              <span><b>{f.away_tag}</b> did not play<br /><span className="text-sm text-muted-foreground">{f.home_tag} wins 3-0.</span></span>
            </label>
          </RadioGroup>
          <div className="space-y-1.5">
            <Label>Note (optional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Opponent waited 15 minutes and sent chat screenshots" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForfeitOpen(false)} disabled={saving}>Cancel</Button>
            <Button variant="destructive" onClick={confirmForfeit} disabled={saving}>{saving ? "Saving…" : "Record forfeit"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

function DisputeCard({ d, onResolve, shots = [] }: { d: ADispute; shots?: Shot[]; onResolve: (d: ADispute, h: string, a: string, note: string, voidIt: boolean) => void }) {
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
        <ShotsButton shots={shots} title={`${d.home_tag} vs ${d.away_tag}`} />
        <Button size="sm" variant="success" onClick={() => onResolve(d, h, a, note, false)}>Confirm score</Button>
        <Button size="sm" variant="destructive" onClick={() => onResolve(d, h, a, note, true)}>Void &amp; replay</Button>
      </div>
    </div>
  );
}

type TrialCode = { code: string; label: string | null; max_uses: number; uses: number; status: "active" | "used" | "expired" | "cancelled"; expires_at: string; created_at: string; used_by: string[] };
const EXPIRY_OPTIONS = [
  { label: "24 hours", hours: 24 },
  { label: "3 days", hours: 72 },
  { label: "7 days", hours: 168 },
  { label: "14 days", hours: 336 },
  { label: "30 days", hours: 720 },
];
const fmtDate = (iso: string) => new Date(iso).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function FreeTrialAdmin() {
  const qc = useQueryClient();
  const dialogs = useDialogs();
  const [count, setCount] = useState("1");
  const [label, setLabel] = useState("");
  const [hours, setHours] = useState("168");
  const [maxUses, setMaxUses] = useState("1");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ codes: string[]; expires_at: string; max_uses: number } | null>(null);
  const list = useQuery({
    queryKey: ["admin-trials"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_trial_codes");
      if (error) throw error;
      return data as unknown as TrialCode[];
    },
  });
  const codes = list.data ?? [];
  const active = codes.filter((c) => c.status === "active").length;
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  function message(code: string, expires: string, max = 1) {
    return `Your free trial code for eFootball Arena Kenya: ${code}\nValid until ${fmtDate(expires)}. Open ${origin}/register, fill in your details and paste this code in the "M-Pesa transaction code" box. No payment needed. ${max > 1 ? `This code works for up to ${max} players, each with their own registration. First come, first served.` : "It works once."}`;
  }
  async function copy(text: string, ok = "Copied") {
    try { await navigator.clipboard.writeText(text); toast.success(ok); } catch { toast.error("Couldn't copy. Select and copy it manually."); }
  }
  async function generate() {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 50) return toast.error("Enter a quantity from 1 to 50.");
    const m = Number(maxUses);
    if (!Number.isInteger(m) || m < 1 || m > 50) return toast.error("Players per code must be from 1 to 50.");
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_create_trial_codes", { _count: n, _label: label, _hours: Number(hours), _max_uses: m });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    const r = data as unknown as { codes: { code: string }[]; expires_at: string; max_uses: number };
    setFresh({ codes: r.codes.map((c) => c.code), expires_at: r.expires_at, max_uses: r.max_uses });
    setLabel("");
    qc.invalidateQueries({ queryKey: ["admin-trials"] });
  }
  async function cancel(c: TrialCode) {
    const go = await dialogs.confirm({
      title: "Cancel this code?",
      description: `${c.code}${c.label ? ` (${c.label})` : ""} will stop working immediately. This cannot be undone.`,
      confirmLabel: "Cancel code",
      tone: "danger",
    });
    if (!go) return;
    const { error } = await supabase.rpc("admin_revoke_trial_code", { _code: c.code });
    if (error) return toast.error(friendlyError(error));
    toast.success("Code cancelled");
    qc.invalidateQueries({ queryKey: ["admin-trials"] });
  }

  const badge = (s: TrialCode["status"]) =>
    s === "active" ? "bg-primary/15 text-primary" : s === "used" ? "bg-accent/20 text-accent" : "bg-muted text-muted-foreground";

  return (
    <section className="mt-10">
      <h2 className="text-3xl font-bold uppercase">Free trial codes</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Give a code to a player. They paste it in the M-Pesa code box when registering and are confirmed straight away with KES 0 recorded. Each code works once, expires on its own, and can be cancelled while unused.
      </p>

      <div className="panel mt-4 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-[90px_130px_1fr_160px_auto] lg:items-end">
        <div className="space-y-1.5"><Label>Codes</Label><Input type="number" min={1} max={50} value={count} onChange={(e) => setCount(e.target.value)} className="h-11" /></div>
        <div className="space-y-1.5"><Label>Players per code</Label><Input type="number" min={1} max={50} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} className="h-11" /></div>
        <div className="space-y-1.5"><Label>Label (who it's for, optional)</Label><Input value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Brian, campus group" className="h-11" /></div>
        <div className="space-y-1.5">
          <Label>Expires in</Label>
          <select value={hours} onChange={(e) => setHours(e.target.value)} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm">
            {EXPIRY_OPTIONS.map((o) => <option key={o.hours} value={o.hours}>{o.label}</option>)}
          </select>
        </div>
        <Button variant="hero" className="h-11" onClick={generate} disabled={busy}>{busy ? "Generating…" : "Generate code"}</Button>
        <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-5">Players per code: <b>1</b> for one player, or up to <b>50</b> for a group code that several players can use (each registers separately, first come first served). Group codes stop working when the places are used up, when they expire, or when you cancel them.</p>
      </div>

      {fresh && (
        <div className="panel mt-4 border-primary p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-xl font-bold uppercase text-primary">New {fresh.codes.length === 1 ? "code" : `codes (${fresh.codes.length})`} · {fresh.max_uses === 1 ? "1 player each" : `${fresh.max_uses} players each`} · valid until {fmtDate(fresh.expires_at)}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => copy(fresh.codes.join("\n"), fresh.codes.length === 1 ? "Code copied" : "All codes copied")}>Copy {fresh.codes.length === 1 ? "code" : "all"}</Button>
              <Button size="sm" variant="outline" onClick={() => copy(fresh.codes.map((c) => message(c, fresh.expires_at, fresh.max_uses)).join("\n\n"), "Message copied")}>Copy WhatsApp message</Button>
              <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>Dismiss</Button>
            </div>
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {fresh.codes.map((c) => <li key={c} className="rounded-md bg-muted px-3 py-2 font-mono text-base font-bold tracking-wider">{c}</li>)}
          </ul>
        </div>
      )}

      <div className="panel mt-4 overflow-x-auto">
        <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">{active} active · {codes.length} total</div>
        {codes.length === 0 && !list.isLoading && <p className="p-4 text-sm text-muted-foreground">No codes yet.</p>}
        {list.error && <p className="p-4 text-sm text-destructive">Couldn't load the codes.</p>}
        {codes.length > 0 && (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground"><tr><th className="p-3">Code</th><th>Label</th><th>Used</th><th>Status</th><th>Expires</th><th /></tr></thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.code} className="border-t border-border">
                  <td className="p-3 font-mono font-bold tracking-wide">{c.code}</td>
                  <td className="text-muted-foreground">{c.label ?? "—"}</td>
                  <td className="text-muted-foreground"><b className="text-foreground">{c.uses}</b> of {c.max_uses}{c.used_by.length > 0 && <span className="block max-w-[220px] truncate text-xs" title={c.used_by.join(", ")}>{c.used_by.join(", ")}</span>}</td>
                  <td><span className={"rounded-full px-2 py-0.5 text-xs font-semibold capitalize " + badge(c.status)}>{c.status === "used" ? "fully used" : c.status}</span></td>
                  <td className="text-muted-foreground">{fmtDate(c.expires_at)}</td>
                  <td className="space-x-2 whitespace-nowrap pr-3 text-right">
                    {c.status === "active" && <Button size="sm" variant="outline" onClick={() => copy(message(c.code, c.expires_at, c.max_uses), "Message copied")}>Copy message</Button>}
                    {c.status === "active" && <Button size="sm" variant="destructive" onClick={() => cancel(c)}>Cancel</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
