import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Medal, Radio } from "lucide-react";
import { Pill, RoundResults, StandingsTable } from "@/components/league-views";
import { SeasonArchive, SeasonResultsDialog } from "@/components/season-viewer";
import { MyMatches } from "@/components/my-matches";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/site";
import { FORMAT_LABEL, formatKes, publicTournamentQuery, useLiveTournament, type Prize } from "@/lib/tournament";
import {
  buildRows, groupLetter, groupTable, overallTable, publicLeagueQuery, roundDeadlinesQuery, seasonComplete, useLiveFixtures,
  type Winner,
} from "@/lib/league";

export const Route = createFileRoute("/league")({
  head: () => ({
    meta: [
      { title: "League Table & Fixtures — eFootball Arena Kenya" },
      { name: "description", content: "Group tables, home-and-away fixtures, results and the prize pool." },
      { property: "og:title", content: "League Table & Fixtures — eFootball Arena Kenya" },
      { property: "og:description", content: "Live standings, fixtures and prizes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LeaguePage,
});

type View = "overall" | number;

function LeaguePage() {
  useLiveTournament();
  useLiveFixtures();
  const [seasonSel, setSeasonSel] = useState<number | undefined>(undefined);
  const first = useQuery(publicLeagueQuery(seasonSel));
  const tour = useQuery(publicTournamentQuery);
  // Ended seasons live under "Previous seasons". When no season is running the server falls back to the latest
  // ended one, so show the season that is open for sign-ups instead.
  const firstEnded = seasonSel === undefined && first.data?.season.status === "completed";
  const signupSeason = tour.data?.season_number ?? undefined;
  const fallback = useQuery({ ...publicLeagueQuery(signupSeason), enabled: firstEnded && signupSeason !== undefined });
  const useFallback = firstEnded && signupSeason !== undefined;
  const resolving = firstEnded && tour.isLoading;
  const lg = useFallback ? fallback : first;
  const [view, setView] = useState<View>("overall");
  const [tab, setTab] = useState<"table" | "fixtures">("table");
  const [archiveSeason, setArchiveSeason] = useState<number | null>(null);

  const data = resolving ? null : (lg.data ?? null);
  const liveSeasons = (data?.seasons ?? []).filter((s) => s.status !== "completed");
  const deadlines = useQuery(roundDeadlinesQuery(data && data.season.status === "running" ? data.season.number : undefined)).data;
  const groups = data?.groups ?? [];
  const fixtures = data?.fixtures ?? [];
  const rows = useMemo(() => buildRows(groups, fixtures), [groups, fixtures]);
  const names = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const done = seasonComplete(fixtures);
  const played = fixtures.filter((x) => x.status === "confirmed").length;
  const loading = lg.isLoading || resolving;
  const completed = data?.season.status === "completed";
  const signingUp = data?.season.status === "registration";

  return (
    <PageShell kicker={data ? `Season ${data.season.number}` : "League"} title="Table & Fixtures">
      {liveSeasons.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {liveSeasons.map((s) => (
            <Pill key={s.number} active={data!.season.number === s.number} onClick={() => { setSeasonSel(s.number); setView("overall"); }}>
              Season {s.number} · live
            </Pill>
          ))}
        </div>
      )}
      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        {completed ? <span className="rounded-full border border-border px-3 py-1 text-xs font-bold uppercase">Season ended{data?.season.ended_at ? ` · ${new Date(data.season.ended_at).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}` : ""}</span>
          : signingUp ? <span className="rounded-full border border-primary/40 px-3 py-1 text-xs font-bold uppercase text-primary">Sign-ups open</span>
          : <span className="inline-flex items-center gap-2 text-primary"><Radio className="h-4 w-4 animate-pulse" /> Live</span>}
        {fixtures.length > 0 && <span>{played} of {fixtures.length} matches played</span>}
      </div>

      {data && data.season.status !== "completed" && <MyMatches seasonNumber={data.season.number} deadlines={deadlines} />}

      {data && <Prizes prize={data.prize} final={done || completed} completed={completed} />}

      {lg.error && <p className="mt-6 text-destructive">Couldn't load the league. Please refresh.</p>}

      <div className="mt-8 flex flex-wrap gap-2">
        <Pill active={tab === "table"} onClick={() => setTab("table")}>Table</Pill>
        <Pill active={tab === "fixtures"} onClick={() => setTab("fixtures")}>Fixtures</Pill>
        <span className="mx-2 hidden w-px bg-border sm:block" />
        {tab === "table" && <Pill active={view === "overall"} onClick={() => setView("overall")}>Overall</Pill>}
        {groups.map((g) => (
          <Pill key={g.group_number} active={view === g.group_number} onClick={() => setView(g.group_number)}>
            Group {groupLetter(g.group_number)}
          </Pill>
        ))}
      </div>

      {typeof view === "number" && groups.find((g) => g.group_number === view)?.league_format && (
        <p className="mt-4 text-sm text-muted-foreground">Group {groupLetter(view)} format: <b className="text-foreground">{FORMAT_LABEL[groups.find((g) => g.group_number === view)!.league_format!]}</b>, chosen by the group's players.</p>
      )}

      <div className="mt-6">
        {loading ? <Skeleton className="h-96 rounded-xl" /> : tab === "table" ? (
          <StandingsTable rows={view === "overall" ? overallTable(rows) : groupTable(rows, view)} showGroup={view === "overall"} highlightTop={view === "overall" ? 3 : 0} />
        ) : fixtures.length === 0 ? (
          <p className="panel p-6 text-muted-foreground">Fixtures are created by the organiser once a group has all 8 players verified.</p>
        ) : (
          <RoundResults key={`${data?.season.number}-${view}`} fixtures={fixtures} names={names} group={view === "overall" ? groups[0]?.group_number ?? 1 : view} deadlines={deadlines} />
        )}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Win = 3 points, draw = 1. A match where neither player showed is recorded 0-0 with no points for either player. Ranked by points, goal difference, then goals scored. Only organiser-confirmed results count;
        disputed matches are held back until resolved. {tab === "fixtures" && view === "overall" && "Pick a group above to see its fixtures."}
      </p>

      <SeasonArchive seasons={data?.seasons ?? []} onOpen={setArchiveSeason} />
      {archiveSeason !== null && <SeasonResultsDialog key={archiveSeason} season={archiveSeason} onClose={() => setArchiveSeason(null)} />}
    </PageShell>
  );
}


function Prizes({ prize, final, completed }: { prize: Prize & { winners?: Winner[] }; final: boolean; completed: boolean }) {
  const items = [
    { place: "1st", kes: prize.first_kes, pct: prize.first_pct },
    { place: "2nd", kes: prize.second_kes, pct: prize.second_pct },
    { place: "3rd", kes: prize.third_kes, pct: prize.third_pct },
  ];
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prize pool</p>
          <p className="font-display text-5xl font-bold text-primary">{formatKes(prize.prize_pool_kes)}</p>
        </div>
        <p className="max-w-sm text-xs text-muted-foreground">
          {prize.prize_percent}% of verified entry fees, split across the overall top three. Grows as players are verified.
          {completed ? " This season has ended and the prizes are final." : final ? " Final standings decide the winners." : " Standings are provisional until every match is played."}
        </p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {items.map((i) => (
          <div key={i.place} className="panel flex items-center gap-3 p-4">
            <Medal className="h-7 w-7 text-accent" />
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">{i.place} place · {i.pct}%</p>
              <p className="font-display text-2xl font-bold">{formatKes(i.kes)}</p>
              {completed && winnerOf(prize, i.place) && <p className="text-sm font-semibold text-primary">{winnerOf(prize, i.place)!.gamer_tag}{winnerOf(prize, i.place)!.team_name ? <span className="font-normal text-muted-foreground"> · {winnerOf(prize, i.place)!.team_name}</span> : null}</p>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function winnerOf(prize: { winners?: Winner[] }, place: string) {
  return prize.winners?.find((w) => w.place === Number(place[0]));
}
