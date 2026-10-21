import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { GroupCard, PageShell } from "@/components/site";
import { displayGroups, publicTournamentQuery, useLiveTournament } from "@/lib/tournament";

export const Route = createFileRoute("/tournament")({
  head: () => ({
    meta: [
      { title: "Tournament Groups — eFootball Arena Kenya" },
      { name: "description", content: "Live tournament groups of 8 with confirmed players only." },
      { property: "og:title", content: "Tournament Groups — eFootball Arena Kenya" },
      { property: "og:description", content: "See open and full groups and confirmed gamer tags, updated live." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TournamentPage,
});

function TournamentPage() {
  useLiveTournament();
  const { data: t, isLoading, error } = useQuery(publicTournamentQuery);
  return (
    <PageShell kicker={t?.season_number ? `Season ${t.season_number} sign-ups` : (t?.name ?? "Tournament")} title="Groups">
      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2 text-primary">
          <Radio className="h-4 w-4 animate-pulse" /> Live
        </span>
        {t && <span>{t.verified_count} of {t.total_capacity} seats confirmed</span>}
      </div>
      {error && <p className="text-destructive">Couldn't load groups. Please refresh.</p>}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-96 rounded-xl" />)
          : t && displayGroups(t).map((g) => <GroupCard key={g.group_number} group={g} />)}
      </div>
      <p className="mt-6 text-xs text-muted-foreground">
        Players appear only after an organiser verifies their M-Pesa payment. Pending registrations never hold a seat.
      </p>
    </PageShell>
  );
}
