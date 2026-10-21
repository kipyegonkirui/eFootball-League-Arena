import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Prize, PublicGroup } from "@/lib/tournament";

export type Fixture = {
  id: string;
  group_number: number;
  round: number;
  home_id: string;
  away_id: string;
  home_score: number | null;
  away_score: number | null;
  status: "scheduled" | "confirmed" | "disputed";
  /** "no_show" = neither player showed: recorded 0-0 with NO points (unlike a genuine 0-0 draw). */
  result_type?: "played" | "no_show";
};

export type TableRow = {
  id: string;
  gamer_tag: string;
  team_name: string | null;
  group_number: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
};

export type SeasonInfo = { number: number; status: "registration" | "running" | "completed"; started_at: string | null; ended_at: string | null };
export type Winner = { place: number; gamer_tag: string; team_name: string | null; points: number; gd: number; gf: number; prize_kes: number };
export type LeagueData = { seasons: SeasonInfo[]; season: SeasonInfo; prize: Prize & { winners?: Winner[] }; groups: PublicGroup[]; fixtures: Fixture[] };

export const publicLeagueQuery = (season?: number) =>
  queryOptions({
    queryKey: ["public-league", season ?? "default"],
    queryFn: async (): Promise<LeagueData | null> => {
      const { data, error } = await supabase.rpc("get_public_league", season ? { _season: season } : {});
      if (error) throw new Error(error.message);
      return (data as unknown as LeagueData | null) ?? null;
    },
    staleTime: 10_000,
  });

export const publicFixturesQuery = queryOptions({
  queryKey: ["public-fixtures"],
  queryFn: async (): Promise<Fixture[]> => {
    const { data, error } = await supabase.rpc("get_public_fixtures");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Fixture[];
  },
  staleTime: 10_000,
});

/** Live updates whenever an admin records or resolves a result. */
export function useLiveFixtures() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel("public-fixtures")
      .on("postgres_changes", { event: "*", schema: "public", table: "fixtures" }, () => {
        qc.invalidateQueries({ queryKey: ["public-fixtures"] });
        qc.invalidateQueries({ queryKey: ["public-league"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}

export function compareRows(a: TableRow, b: TableRow) {
  return b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.gamer_tag.localeCompare(b.gamer_tag);
}

/** Standings use CONFIRMED results only: scheduled and disputed matches never move the table. */
export function buildRows(groups: PublicGroup[], fixtures: Fixture[]): TableRow[] {
  const rows = new Map<string, TableRow>();
  for (const g of groups)
    for (const p of g.players)
      rows.set(p.id, { id: p.id, gamer_tag: p.gamer_tag, team_name: p.team_name, group_number: g.group_number, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 });

  for (const f of fixtures) {
    if (f.status !== "confirmed" || f.home_score == null || f.away_score == null) continue;
    if (f.result_type === "no_show") continue; // 0-0, no points, not counted as played
    const h = rows.get(f.home_id);
    const a = rows.get(f.away_id);
    if (!h || !a) continue;
    h.played++; a.played++;
    h.gf += f.home_score; h.ga += f.away_score;
    a.gf += f.away_score; a.ga += f.home_score;
    if (f.home_score > f.away_score) { h.won++; a.lost++; h.points += 3; }
    else if (f.home_score < f.away_score) { a.won++; h.lost++; a.points += 3; }
    else { h.drawn++; a.drawn++; h.points++; a.points++; }
  }
  for (const r of rows.values()) r.gd = r.gf - r.ga;
  return [...rows.values()];
}

export function groupTable(rows: TableRow[], groupNumber: number) {
  return rows.filter((r) => r.group_number === groupNumber).sort(compareRows);
}

export function overallTable(rows: TableRow[]) {
  return [...rows].sort(compareRows);
}

/** Prizes are final only once every fixture has a confirmed result. */
export function seasonComplete(fixtures: Fixture[]) {
  return fixtures.length > 0 && fixtures.every((f) => f.status === "confirmed");
}

export const groupLetter = (n: number) => String.fromCharCode(64 + n);

/** One of a player's own fixtures, as returned by lookup_registration. */
export type MyFixture = { id: string; round: number; is_home: boolean; opponent: string; opponent_team: string | null; home_score: number | null; away_score: number | null; status: "scheduled" | "confirmed" | "disputed"; my_dispute_open: boolean };
export type MyRegistration = {
  season_number?: number | null; season_status?: string | null; reference: string; gamer_tag: string; team_name: string | null; status: string;
  group_number: number | null; slot_number: number | null; reason: string | null; phone_hint: string; fixtures: MyFixture[];
};

export type RoundDeadline = { round: number; due_at: string };

/** Round deadlines for a season, as a map of round -> ISO time. Empty if none are set (or the feature isn't installed yet). */
export const roundDeadlinesQuery = (season?: number) =>
  queryOptions({
    queryKey: ["public-league", "deadlines", season ?? "none"],
    enabled: season !== undefined,
    queryFn: async (): Promise<Map<number, string>> => {
      const { data, error } = await supabase.rpc("get_round_deadlines", { _season: season as number });
      if (error) return new Map();
      return new Map(((data ?? []) as unknown as RoundDeadline[]).map((d) => [d.round, d.due_at]));
    },
    staleTime: 30_000,
  });

/** e.g. "Sat 25 Oct, 8:00 pm" in Kenya time. */
export function formatDue(iso: string) {
  return new Date(iso).toLocaleString("en-KE", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Africa/Nairobi" });
}
export const isPast = (iso: string) => new Date(iso).getTime() < Date.now();

/** The player's next match: their earliest fixture that is still to be played. */
export function nextFixture(fixtures: MyFixture[]) {
  return [...fixtures].sort((a, b) => a.round - b.round).find((f) => f.status === "scheduled") ?? null;
}
