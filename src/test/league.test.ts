import { describe, expect, it } from "vitest";
import { buildRows, groupTable, overallTable, seasonComplete, type Fixture } from "@/lib/league";
import type { PublicGroup } from "@/lib/tournament";

const players = ["a", "b", "c"].map((id, i) => ({ id, slot: i + 1, gamer_tag: id.toUpperCase(), team_name: null, platform: "Mobile" }));
const groups: PublicGroup[] = [{ group_number: 1, capacity: 3, is_full: true, players }];
const fx = (id: string, h: string, a: string, hs: number | null, as: number | null, status: Fixture["status"]): Fixture =>
  ({ id, group_number: 1, round: 1, home_id: h, away_id: a, home_score: hs, away_score: as, status });

describe("league standings", () => {
  it("awards 3/1/0 points and ranks by points, goal difference, goals for", () => {
    const rows = buildRows(groups, [fx("1", "a", "b", 3, 0, "confirmed"), fx("2", "b", "c", 1, 1, "confirmed"), fx("3", "c", "a", 0, 0, "confirmed")]);
    const t = groupTable(rows, 1);
    expect(t.map((r) => [r.gamer_tag, r.points, r.gd])).toEqual([["A", 4, 3], ["C", 2, 0], ["B", 1, -3]]);
  });

  it("ignores scheduled and disputed matches", () => {
    const rows = buildRows(groups, [fx("1", "a", "b", 5, 0, "disputed"), fx("2", "a", "c", null, null, "scheduled")]);
    expect(overallTable(rows).every((r) => r.played === 0 && r.points === 0)).toBe(true);
  });

  it("records a double no-show as 0-0 with no points and not played, unlike a real 0-0 draw", () => {
    const rows = buildRows(groups, [
      { ...fx("1", "a", "b", 0, 0, "confirmed"), result_type: "no_show" },
      fx("2", "a", "c", 0, 0, "confirmed"),
    ]);
    const get = (id: string) => rows.find((r) => r.id === id)!;
    expect([get("a").points, get("a").played]).toEqual([1, 1]);
    expect([get("b").points, get("b").played]).toEqual([0, 0]);
    expect([get("c").points, get("c").played]).toEqual([1, 1]);
  });

  it("is complete only when every fixture is confirmed", () => {
    expect(seasonComplete([])).toBe(false);
    expect(seasonComplete([fx("1", "a", "b", 1, 0, "confirmed"), fx("2", "b", "c", null, null, "scheduled")])).toBe(false);
    expect(seasonComplete([fx("1", "a", "b", 1, 0, "confirmed")])).toBe(true);
  });
});
