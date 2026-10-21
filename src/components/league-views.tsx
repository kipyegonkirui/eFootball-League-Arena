import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDue, groupLetter, isPast, type Fixture, type TableRow } from "@/lib/league";

export function Pill({ active, onClick, children, className }: { active: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function StandingsTable({ rows, showGroup, highlightTop = 0 }: { rows: TableRow[]; showGroup: boolean; highlightTop?: number }) {
  if (rows.length === 0) return <p className="panel p-6 text-muted-foreground">No confirmed players yet.</p>;
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="p-3">#</th><th>Player</th>{showGroup && <th>Grp</th>}
            <th className="text-center">P</th><th className="text-center">W</th><th className="text-center">D</th><th className="text-center">L</th>
            <th className="text-center">GF</th><th className="text-center">GA</th><th className="text-center">GD</th><th className="pr-3 text-center">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={cn("border-t border-border", i < highlightTop && "bg-primary/5")}>
              <td className="p-3 font-display text-base font-bold text-muted-foreground">{i + 1}</td>
              <td>
                <span className="font-semibold">{r.gamer_tag}</span>
                {r.team_name && <span className="block text-xs text-muted-foreground">{r.team_name}</span>}
              </td>
              {showGroup && <td>{groupLetter(r.group_number)}</td>}
              <td className="text-center">{r.played}</td><td className="text-center">{r.won}</td><td className="text-center">{r.drawn}</td><td className="text-center">{r.lost}</td>
              <td className="text-center">{r.gf}</td><td className="text-center">{r.ga}</td>
              <td className="text-center">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
              <td className="pr-3 text-center font-display text-lg font-bold text-primary">{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Results for one group, with a picker to look at a single round or all of them. */
export function RoundResults({ fixtures, names, group, single = false, deadlines }: { fixtures: Fixture[]; names: Map<string, TableRow>; group: number; single?: boolean; deadlines?: Map<number, string> | undefined }) {
  const list = fixtures.filter((f) => f.group_number === group);
  const rounds = [...new Set(list.map((f) => f.round))].sort((a, b) => a - b);
  const [pick, setPick] = useState<number | "all">("all");
  if (list.length === 0) return <p className="panel p-6 text-muted-foreground">No fixtures for Group {groupLetter(group)} yet. They are created once the group is full.</p>;

  const active = pick !== "all" && rounds.includes(pick) ? pick : "all";
  const visible = active === "all" ? rounds : [active];
  const label = (id: string) => names.get(id)?.gamer_tag ?? "—";
  const roundDone = (r: number) => list.filter((f) => f.round === r).every((f) => f.status === "confirmed");

  return (
    <div>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2" role="group" aria-label="Choose a round">
        <Pill active={active === "all"} onClick={() => setPick("all")} className="shrink-0">All rounds</Pill>
        {rounds.map((r) => (
          <Pill key={r} active={active === r} onClick={() => setPick(r)} className="inline-flex shrink-0 items-center gap-1.5 px-3.5">
            Round {r}
            {roundDone(r) && <Check className="h-3.5 w-3.5 opacity-70" aria-label="all played" />}
          </Pill>
        ))}
      </div>

      <div className={cn("mt-3 grid gap-4", !single && active === "all" && "md:grid-cols-2")}>
        {visible.map((r) => {
          const games = list.filter((f) => f.round === r);
          const played = games.filter((f) => f.status === "confirmed").length;
          const due = deadlines?.get(r);
          const late = !!due && isPast(due) && played < games.length;
          return (
            <div key={r} className="panel overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-2">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Round {r}</p>
                <p className="text-xs text-muted-foreground">{played} of {games.length} played</p>
              </div>
              {due && <p className={cn("border-b border-border/60 px-4 py-1.5 text-xs", late ? "font-semibold text-destructive" : "text-muted-foreground")}>{played === games.length ? "Was due" : late ? "Overdue, was due" : "Play by"} {formatDue(due)}</p>}
              <ul className="divide-y divide-border/60">
                {games.map((f) => (
                  <li key={f.id} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-2.5 text-sm">
                    <span className="truncate text-right font-semibold">{label(f.home_id)}</span>
                    <span className={cn("min-w-[64px] rounded-md px-2 py-1 text-center font-display text-base font-bold", f.status === "confirmed" && f.result_type === "no_show" ? "bg-muted text-muted-foreground line-through" : f.status === "confirmed" ? "bg-primary/15 text-primary" : f.status === "disputed" ? "status-pending" : "bg-muted text-muted-foreground")}>
                      {f.status === "confirmed" ? (f.result_type === "no_show" ? "No-show" : `${f.home_score} - ${f.away_score}`) : f.status === "disputed" ? "Disputed" : "vs"}
                    </span>
                    <span className="truncate font-semibold">{label(f.away_id)}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
