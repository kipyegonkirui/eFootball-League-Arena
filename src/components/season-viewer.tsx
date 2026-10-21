import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Medal, Trophy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill, RoundResults, StandingsTable } from "@/components/league-views";
import { cn } from "@/lib/utils";
import { FORMAT_LABEL, formatKes } from "@/lib/tournament";
import { buildRows, groupLetter, groupTable, overallTable, publicLeagueQuery, type SeasonInfo } from "@/lib/league";

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : null);

/** Past seasons as cards: champion, prize pool, and a button that opens the full results. */
export function SeasonArchive({ seasons, onOpen }: { seasons: SeasonInfo[]; onOpen: (n: number) => void }) {
  const ended = seasons.filter((s) => s.status === "completed");
  const details = useQueries({ queries: ended.map((s) => publicLeagueQuery(s.number)) });
  if (ended.length === 0) return null;

  return (
    <section className="mt-10" aria-labelledby="archive-title">
      <h2 id="archive-title" className="text-3xl font-bold uppercase">Previous seasons</h2>
      <p className="mt-1 text-sm text-muted-foreground">Final tables and every round's results, kept for anyone to look back on.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ended.map((s, i) => {
          const d = details[i]?.data;
          const champ = d?.prize.winners?.find((w) => w.place === 1);
          return (
            <div key={s.number} className="panel flex flex-col gap-3 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-display text-2xl font-bold uppercase">Season {s.number}</p>
                <p className="text-xs text-muted-foreground">{fmtDate(s.ended_at) ?? "Ended"}</p>
              </div>
              <div className="min-h-[3.25rem]">
                {details[i]?.isLoading ? (
                  <Skeleton className="h-12 w-full" />
                ) : champ ? (
                  <div className="flex items-center gap-3">
                    <Trophy className="h-6 w-6 shrink-0 text-accent" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-primary">{champ.gamer_tag}</p>
                      <p className="truncate text-xs text-muted-foreground">Champion{champ.team_name ? ` · ${champ.team_name}` : ""} · {champ.points} pts</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Results are final.</p>
                )}
              </div>
              <div className="mt-auto flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">{d ? `Prize pool ${formatKes(d.prize.prize_pool_kes)}` : ""}</p>
                <Button size="sm" variant="outline" onClick={() => onOpen(s.number)}>View results</Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Full results for one season in a custom dialog: podium, final table, and round-by-round results. */
export function SeasonResultsDialog({ season, onClose }: { season: number; onClose: () => void }) {
  const q = useQuery(publicLeagueQuery(season));
  const [tab, setTab] = useState<"table" | "rounds">("table");
  const [view, setView] = useState<"overall" | number>("overall");

  const data = q.data ?? null;
  const groups = data?.groups ?? [];
  const fixtures = data?.fixtures ?? [];
  const rows = useMemo(() => buildRows(groups, fixtures), [groups, fixtures]);
  const names = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const played = fixtures.filter((f) => f.status === "confirmed").length;
  const ended = data?.season.status === "completed";
  const winners = data?.prize.winners ?? [];
  const roundsGroup = view === "overall" ? groups[0]?.group_number ?? 1 : view;
  const fmt = typeof view === "number" ? groups.find((g) => g.group_number === view)?.league_format : null;

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-[60] flex max-h-[90vh] w-[calc(100vw-1rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-card outline-none duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="h-1 w-full shrink-0 bg-gradient-brand" />
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-pitch px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <DialogPrimitive.Title className="font-display text-3xl font-bold uppercase leading-none">Season {season} results</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-2 text-sm text-muted-foreground">
                {data
                  ? `${ended ? `Ended ${fmtDate(data.season.ended_at) ?? ""}`.trim() : "Still running"} · ${played} of ${fixtures.length} matches played · prize pool ${formatKes(data.prize.prize_pool_kes)}`
                  : "Loading the final standings…"}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Close">
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            {q.isLoading && <Skeleton className="h-72 rounded-xl" />}
            {q.error && <p className="text-destructive">Couldn't load this season. Close this and try again.</p>}
            {data && (
              <>
                {winners.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    {winners.slice(0, 3).map((w) => (
                      <div key={w.place} className={cn("panel flex items-center gap-3 p-3", w.place === 1 && "border-primary/50")}>
                        <Medal className={cn("h-7 w-7 shrink-0", w.place === 1 ? "text-primary" : "text-accent")} />
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{w.gamer_tag}</p>
                          <p className="text-xs text-muted-foreground">{w.place === 1 ? "1st" : w.place === 2 ? "2nd" : "3rd"} · {w.points} pts · {formatKes(w.prize_kes)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className={cn("flex flex-wrap gap-2", winners.length > 0 && "mt-5")}>
                  <Pill active={tab === "table"} onClick={() => setTab("table")}>Final table</Pill>
                  <Pill active={tab === "rounds"} onClick={() => setTab("rounds")}>Round results</Pill>
                  <span className="mx-1 hidden w-px bg-border sm:block" />
                  {tab === "table" && <Pill active={view === "overall"} onClick={() => setView("overall")}>Overall</Pill>}
                  {groups.map((g) => (
                    <Pill key={g.group_number} active={tab === "rounds" ? roundsGroup === g.group_number : view === g.group_number} onClick={() => setView(g.group_number)}>
                      Group {groupLetter(g.group_number)}
                    </Pill>
                  ))}
                </div>
                {fmt && <p className="mt-3 text-sm text-muted-foreground">Format: <b className="text-foreground">{FORMAT_LABEL[fmt]}</b></p>}

                <div className="mt-4">
                  {tab === "table" ? (
                    <StandingsTable rows={view === "overall" ? overallTable(rows) : groupTable(rows, view)} showGroup={view === "overall"} highlightTop={view === "overall" ? 3 : 0} />
                  ) : fixtures.length === 0 ? (
                    <p className="panel p-6 text-muted-foreground">This season has no fixtures.</p>
                  ) : (
                    <RoundResults key={roundsGroup} fixtures={fixtures} names={names} group={roundsGroup} single />
                  )}
                </div>
              </>
            )}
          </div>

          <div className="flex shrink-0 justify-end border-t border-border px-5 py-3 sm:px-6">
            <Button variant="outline" onClick={onClose}>Close</Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
