import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PublicPlayer = { id: string; slot: number; gamer_tag: string; team_name: string | null; platform: string };
export type Prize = {
  collected_kes: number; prize_percent: number; prize_pool_kes: number;
  first_pct: number; second_pct: number; third_pct: number;
  first_kes: number; second_kes: number; third_kes: number;
};
export type LeagueFormat = "one_week" | "two_week";
export const FORMAT_LABEL: Record<LeagueFormat, string> = { one_week: "Single league (7 matches)", two_week: "Double league (14 matches, home & away)" };

export type PublicGroup = {
  league_format?: LeagueFormat | null;
  group_number: number;
  capacity: number;
  is_full: boolean;
  players: PublicPlayer[];
};
export type PublicTournament = {
  name: string;
  description: string;
  fee_kes: number;
  mpesa_paybill: string | null;
  mpesa_till: string | null;
  mpesa_account_reference: string | null;
  payment_instructions: string | null;
  registration_open: boolean;
  group_capacity: number;
  max_groups: number;
  start_date: string | null;
  verified_count: number;
  total_capacity: number;
  season_number: number | null;
  prize: Prize;
  groups: PublicGroup[];
};

/** Fixed M-Pesa Send Money recipient. */
/** Public contact for rules/privacy questions. Add your email or WhatsApp number here. */
export const ORGANISER_CONTACT = "WhatsApp 0707 266 509 or 0758 399 598";

/** Organisers' WhatsApp numbers shown on the "Chat with organiser" button. `intl` is the number without + or spaces. */
export const ORGANISER_WHATSAPP = [
  { label: "Organiser 1", display: "0707 266 509", intl: "254707266509" },
  { label: "Organiser 2", display: "0758 399 598", intl: "254758399598" },
] as const;
export const whatsappLink = (intl: string, text: string) => `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;

export const MPESA_SEND_NUMBER = "0707266509";
export const MPESA_SEND_NUMBER_INTL = "254707266509";

export const PLATFORMS = ["Mobile", "PlayStation", "Xbox", "Other"] as const;
export const GAME_MODES = ["Dream Team (1v1)", "Authentic Teams (1v1)", "Co-op", "Any"] as const;

export const publicTournamentQuery = queryOptions({
  queryKey: ["public-tournament"],
  queryFn: async (): Promise<PublicTournament> => {
    const { data, error } = await supabase.rpc("get_public_tournament");
    if (error) throw new Error(error.message);
    return data as unknown as PublicTournament;
  },
  staleTime: 10_000,
});

/** Full list of groups to render: existing groups plus not-yet-created empty ones up to max_groups. */
export function displayGroups(t: PublicTournament): PublicGroup[] {
  const out: PublicGroup[] = [...t.groups];
  for (let n = 1; n <= t.max_groups; n++) {
    if (!out.some((g) => g.group_number === n)) {
      out.push({ group_number: n, capacity: t.group_capacity, is_full: false, players: [] });
    }
  }
  return out.sort((a, b) => a.group_number - b.group_number);
}

export function hasPaymentDetails(t: PublicTournament) {
  return Boolean(t.mpesa_paybill || t.mpesa_till);
}

export function isFull(t: PublicTournament) {
  return t.verified_count >= t.total_capacity;
}

/** Live updates: group counters change only when an admin verifies a player. */
export function useLiveTournament() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel("public-groups")
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_groups" }, () => {
        qc.invalidateQueries({ queryKey: ["public-tournament"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}

export function formatKes(n: number) {
  return `KES ${n.toLocaleString("en-KE")}`;
}

export function friendlyError(e: unknown) {
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Something went wrong.";
  return msg.replace(/^.*?ERROR:\s*/, "");
}
