import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageShell, StatusBadge } from "@/components/site";
import { saveMine } from "@/lib/saved";
import { GAME_MODES, ORGANISER_WHATSAPP, PLATFORMS, formatKes, friendlyError, isFull, MPESA_SEND_NUMBER, publicTournamentQuery, whatsappLink } from "@/lib/tournament";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Register — eFootball Arena Kenya" },
      { name: "description", content: "Register for the tournament and submit your M-Pesa payment proof." },
      { property: "og:title", content: "Register — eFootball Arena Kenya" },
      { property: "og:description", content: "Sign up, pay via M-Pesa, and get verified." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RegisterPage,
});

const sel = "h-11 w-full rounded-md border border-input bg-background px-3 text-base";

function RegisterPage() {
  const { data: t } = useQuery(publicTournamentQuery);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [donePhone, setDonePhone] = useState("");
  const [trialInfo, setTrialInfo] = useState<{ group: number; slot: number } | null>(null);

  if (done)
    return (
      <PageShell kicker={trialInfo ? "Confirmed" : "Submitted"} title={trialInfo ? "You're in!" : "You're in the queue"}>
        <div className="panel max-w-lg space-y-4 p-6">
          <StatusBadge status={trialInfo ? "verified" : "pending"} />
          {trialInfo && <p className="rounded-lg bg-primary/10 p-3 text-sm"><b>Free trial confirmed.</b> You are in Group {String.fromCharCode(64 + trialInfo.group)}, slot {trialInfo.slot}. No payment is needed.</p>}
          <div>
            <p className="text-sm text-muted-foreground">Your reference</p>
            <p className="font-display text-4xl font-bold tracking-wide text-primary">{done}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => { navigator.clipboard?.writeText(done); toast.success("Reference copied"); }}>Copy reference</Button>
            <Button asChild variant="outline"><a target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`My eFootball Arena Kenya registration: ${done}. Check status: ${typeof window !== "undefined" ? window.location.origin : ""}/status?ref=${done}`)}`}>Send to my WhatsApp</a></Button>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>We saved this on this phone, so Check status opens already filled in.</li>
            <li>On another device, use this reference, your M-Pesa code or your eFootball username, together with the phone number {donePhone || "you registered with"}.</li>
            {!trialInfo && <li>Your seat is NOT reserved until an organiser verifies your M-Pesa payment.</li>}
          </ul>
          <Button asChild variant="hero"><Link to="/status" search={{ ref: done }}>Check status now</Link></Button>
        </div>
      </PageShell>
    );

  if (t && (!t.registration_open || isFull(t)))
    return <PageShell kicker="Registration" title={t.registration_open ? "Tournament full" : "Registration closed"}><Waitlist /></PageShell>;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (!f.get("terms")) return toast.error("Please accept the terms.");
    setBusy(true);
    try {
      let path: string | null = null;
      const file = f.get("screenshot") as File | null;
      if (file && file.size > 0) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        if (!["png", "jpg", "jpeg", "webp"].includes(ext)) throw new Error("Screenshot must be PNG, JPG or WEBP.");
        path = `proofs/${crypto.randomUUID()}.${ext}`;
        const up = await supabase.storage.from("payment-proofs").upload(path, file);
        if (up.error) throw up.error;
      }
      const { data, error } = await supabase.rpc("submit_registration", {
        _full_name: String(f.get("full_name")), _gamer_tag: String(f.get("gamer_tag")), _team_name: String(f.get("team_name")), _efootball_id: "", _league_format: String(f.get("league_format") || ""),
        _phone: String(f.get("phone")), _email: String(f.get("email") || ""),
        _platform: String(f.get("platform")), _game_mode: String(f.get("game_mode")),
        _transaction_code: String(f.get("code")), _amount_kes: Number(f.get("amount")),
        _payer_phone: String(f.get("payer_phone") || ""), _screenshot_path: path as string,
      });
      if (error) throw error;
      const res = data as unknown as { reference: string; status: string; free_trial?: boolean; group_number?: number; slot_number?: number };
      const reference = res.reference;
      if (res.free_trial && res.group_number && res.slot_number) setTrialInfo({ group: res.group_number, slot: res.slot_number });
      saveMine({ ref: reference, phone: String(f.get("phone")) });
      setDonePhone(String(f.get("phone")));
      setDone(reference);
      toast.success(res.free_trial ? "Free trial confirmed. You're in!" : "Submitted — awaiting payment verification");
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const payReady = true;
  return (
    <PageShell kicker={t?.season_number ? `Season ${t.season_number} sign-ups` : t?.name} title="Register">
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <form onSubmit={onSubmit} className="panel space-y-4 p-5 md:p-6">
          <F label="Full name"><Input name="full_name" required autoComplete="name" className="h-11" /></F>
          <F label="eFootball username (shown publicly, must be exactly as in the game)"><Input name="gamer_tag" required maxLength={24} className="h-11" /></F>
          <F label="Team name (shown publicly, can match other players)"><Input name="team_name" required minLength={2} maxLength={30} placeholder="e.g. Nairobi Lions FC" className="h-11" /></F>
          <F label="Phone number (WhatsApp no.)"><Input name="phone" required inputMode="tel" placeholder="0712 345 678" className="h-11" /></F>
          <F label="Email (optional)"><Input name="email" type="email" className="h-11" /></F>
          <div className="grid gap-4 sm:grid-cols-2">
            <F label="Platform"><select name="platform" className={sel} required>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select></F>
            <F label="Game mode"><select name="game_mode" className={sel} required>{GAME_MODES.map((p) => <option key={p}>{p}</option>)}</select></F>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Which league format do you prefer?</legend>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/10">
              <input type="radio" name="league_format" value="one_week" required className="mt-1" />
              <span><b>Single league</b> · everyone plays everyone once<br /><span className="text-sm text-muted-foreground">7 matches, wrapped up in about 2 to 3 days. Quick and easy to fit in.</span></span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/10">
              <input type="radio" name="league_format" value="two_week" required className="mt-1" />
              <span><b>Double league</b> · home and away<br /><span className="text-sm text-muted-foreground">14 matches, takes a few days longer. Fairer, more games.</span></span>
            </label>
            <p className="text-xs text-muted-foreground">Each group follows the choice most of its players make. If it's a tie, the double league is used.</p>
          </fieldset>
          <hr className="border-border" />
          <h2 className="text-2xl font-bold uppercase">Payment proof</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <F label="M-Pesa transaction code (or free trial code)"><Input name="code" required maxLength={24} placeholder="SJK4XXXXXX or FT-XXXX-XXXX-XXXX" autoComplete="off" className="h-11 uppercase" /></F>
            <F label="Amount paid (KES, ignore for a free trial)"><Input name="amount" type="number" inputMode="numeric" defaultValue={t?.fee_kes} className="h-11" /></F>
          </div>
          <F label="Phone that paid (if different)"><Input name="payer_phone" inputMode="tel" className="h-11" /></F>
          <F label="Screenshot (optional)"><Input name="screenshot" type="file" accept="image/png,image/jpeg,image/webp" /></F>
          <label className="flex items-start gap-2 text-sm text-muted-foreground">
            <input type="checkbox" name="terms" className="mt-1" /> <span>I have read and accept the <Link to="/rules" target="_blank" className="text-primary underline">tournament rules</Link> and <Link to="/privacy" target="_blank" className="text-primary underline">privacy notice</Link>. I understand my registration holds no seat until an organiser confirms my payment. I understand that the player I am due to face next can see my phone number, to message me on WhatsApp and arrange our match. We never ask for your M-Pesa PIN.</span>
          </label>
          <Button type="submit" variant="hero" size="xl" className="w-full" disabled={busy || !payReady}>{busy ? "Submitting…" : "Submit registration"}</Button>
        </form>
        <aside className="panel h-fit space-y-3 p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Step 1 · Pay via M-Pesa Send Money</p>
          <p className="font-display text-4xl font-bold text-primary">{t ? formatKes(t.fee_kes) : "—"}</p>
          <dl className="space-y-2 text-sm">
            <Row k="Send money to" v={MPESA_SEND_NUMBER} />
            <Row k="Amount" v={t ? String(t.fee_kes) : "—"} />
          </dl>
          <Button asChild variant="hero" className="w-full"><a href="tel:*334%23">Make payment (opens M-Pesa)</a></Button>
          <Button type="button" variant="outline" className="w-full" onClick={() => { navigator.clipboard?.writeText(MPESA_SEND_NUMBER); toast.success("Number copied"); }}>Copy number</Button>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Tap Make payment, choose Send Money.</li>
            <li>Enter {MPESA_SEND_NUMBER} and the amount, then your M-Pesa PIN on your phone.</li>
            <li>Copy the 10-character code from the confirmation SMS into the form.</li>
          </ol>
          <p className="text-xs text-muted-foreground">Your slot is confirmed only after an organiser checks the payment. We never see or ask for your PIN.</p>
          <p className="text-xs text-muted-foreground">Stuck or have a question? WhatsApp an organiser: {ORGANISER_WHATSAPP.map((o, i) => <span key={o.intl}>{i > 0 && " · "}<a href={whatsappLink(o.intl, "Hi, I need help registering for the eFootball Arena Kenya league.")} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline">{o.display}</a></span>)}</p>
          <p className="rounded-lg border border-border p-3 text-xs text-muted-foreground"><b className="text-foreground">Have a free trial code?</b> Skip the payment and paste the code in the transaction code box. You are confirmed straight away.</p>
        </aside>
      </div>
    </PageShell>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><dt className="text-muted-foreground">{k}</dt><dd className="font-bold">{v}</dd></div>;
}
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}

function Waitlist() {
  const [ok, setOk] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await supabase.rpc("join_waitlist", { _gamer_tag: String(f.get("tag")), _phone: String(f.get("phone")), _email: String(f.get("email") || "") });
    if (error) return toast.error(friendlyError(error));
    setOk(true);
  }
  if (ok) return <p className="panel max-w-lg p-6">You're on the waitlist. Don't pay anything — we'll contact you if a slot opens.</p>;
  return (
    <form onSubmit={submit} className="panel max-w-lg space-y-4 p-6">
      <p className="text-muted-foreground">No seats are available, so we are not accepting payments. Join the free waitlist instead.</p>
      <F label="Gamer tag"><Input name="tag" required className="h-11" /></F>
      <F label="Phone"><Input name="phone" required inputMode="tel" className="h-11" /></F>
      <F label="Email (optional)"><Input name="email" type="email" className="h-11" /></F>
      <Button type="submit" variant="hero" className="w-full">Join waitlist</Button>
    </form>
  );
}
