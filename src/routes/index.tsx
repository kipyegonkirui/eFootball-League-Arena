import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Smartphone, ShieldCheck, Users, ArrowRight } from "lucide-react";
import heroImg from "@/assets/stadium-night.jpg";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { GroupCard, StatusBadge } from "@/components/site";
import { displayGroups, formatKes, isFull, publicTournamentQuery, useLiveTournament } from "@/lib/tournament";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "eFootball Arena Kenya — Your Next Match Starts Here" },
      { name: "description", content: "Join Kenya's eFootball tournaments. Register, pay via M-Pesa, get verified and claim your group slot." },
      { property: "og:title", content: "eFootball Arena Kenya — Your Next Match Starts Here" },
      { property: "og:description", content: "Register, pay via M-Pesa, get verified and claim your slot in a group of 8." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const STEPS = [
  { icon: ClipboardList, title: "Register", text: "Enter your gamer tag, phone and platform." },
  { icon: Smartphone, title: "Pay via M-Pesa", text: "Pay the entry fee to our Paybill/Till and submit your code." },
  { icon: ShieldCheck, title: "Payment verified", text: "An organiser checks your M-Pesa payment manually." },
  { icon: Users, title: "Get your slot", text: "You're placed in the next open group of 8." },
];

function Index() {
  useLiveTournament();
  const { data: t, isLoading, error } = useQuery(publicTournamentQuery);
  const full = t ? isFull(t) : false;
  const groups = t ? displayGroups(t) : [];

  return (
    <main>
      <section className="relative isolate overflow-hidden">
        <img src={heroImg} alt="" width={612} height={408} fetchPriority="high" className="absolute inset-0 -z-10 h-full w-full object-cover" />
        <div className="absolute inset-0 -z-10 bg-gradient-hero" />
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-20 md:pb-28 md:pt-32">
          <p className="text-xs font-bold uppercase tracking-[0.35em] text-accent">{t?.name ?? "eFootball Arena Kenya"}</p>
          <h1 className="mt-4 max-w-3xl text-6xl font-extrabold uppercase leading-[0.9] md:text-8xl">
            Your Next Match <span className="text-gradient-brand">Starts Here</span>
          </h1>
          <p className="mt-5 max-w-xl text-base text-muted-foreground md:text-lg">
            {t?.description ?? "Kenya's competitive eFootball tournament platform."}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild variant="hero" size="xl">
              <Link to="/register">
                Register for Tournament <ArrowRight />
              </Link>
            </Button>
            <div className="panel flex items-center gap-3 px-5 py-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Entry fee</span>
              {isLoading ? <Skeleton className="h-7 w-24" /> : <span className="font-display text-3xl font-bold text-primary">{t ? formatKes(t.fee_kes) : "—"}</span>}
            </div>
          </div>
          {t && (
            <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
              {!t.registration_open ? (
                <StatusBadge status="rejected" className="normal-case" />
              ) : null}
              <span className="text-muted-foreground">
                {!t.registration_open ? "Registration is closed" : full ? "All slots are full — waitlist open" : `${t.total_capacity - t.verified_count} of ${t.total_capacity} slots open`}
              </span>
            </div>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-4xl font-extrabold uppercase md:text-5xl">How it works</h2>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="panel relative p-5">
              <span className="absolute right-4 top-3 font-display text-5xl font-extrabold text-muted">{i + 1}</span>
              <s.icon className="h-7 w-7 text-primary" />
              <h3 className="mt-4 text-2xl font-bold uppercase">{s.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="bg-pitch border-y border-border/60">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.3em] text-accent">Current tournament</p>
              <h2 className="mt-2 text-4xl font-extrabold uppercase md:text-5xl">{t?.name ?? "Loading…"}</h2>
              {t?.start_date && <p className="mt-1 text-muted-foreground">Kick-off: {t.start_date}</p>}
            </div>
            <Button asChild variant="outline">
              <Link to="/league">League table &amp; fixtures</Link>
            </Button>
          </div>

          {error && <p className="mt-6 text-destructive">Couldn't load tournament info. Please refresh.</p>}

          {t && (
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Entry fee" value={formatKes(t.fee_kes)} />
              <Stat label="Confirmed players" value={`${t.verified_count}/${t.total_capacity}`} />
              <Stat label="Groups" value={`${t.max_groups} × ${t.group_capacity}`} />
              <Stat label="Prize pool" value={formatKes(t.prize.prize_pool_kes)} />
            </div>
          )}

          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {isLoading
              ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-80 rounded-xl" />)
              : groups.slice(0, 4).map((g) => <GroupCard key={g.group_number} group={g} />)}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Only players with verified payments appear here.</p>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-4xl font-bold">{value}</p>
    </div>
  );
}
