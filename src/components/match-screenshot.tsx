import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Camera, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import type { Saved } from "@/lib/saved";
import type { MyFixture } from "@/lib/league";
import { friendlyError } from "@/lib/tournament";

type ShotState = { fixture_id: string; mine: boolean; opponent: boolean };

const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Upload a screenshot of the full-time screen for the player's next match. Players type no score: the organiser
 * compares the two screenshots and records the result. Shows whether you and your opponent have uploaded.
 * Renders nothing if the feature isn't installed yet.
 */
export function MatchScreenshotUpload({ creds, fixture }: { creds: Saved; fixture: MyFixture }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  // Key starts with "public-league" so live fixture updates refresh it automatically.
  const q = useQuery({
    queryKey: ["public-league", "shots", creds.ref, creds.phone],
    queryFn: async (): Promise<ShotState[]> => {
      const { data, error } = await supabase.rpc("my_match_screenshots", { _reference: creds.ref, _phone: creds.phone });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ShotState[];
    },
    retry: false,
    staleTime: 15_000,
  });
  if (q.isError) return null;
  const state = q.data?.find((s) => s.fixture_id === fixture.id);
  const mine = !!state?.mine;

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const ext = TYPES[file.type];
    if (!ext) { toast.error("Please choose a PNG, JPG or WebP image."); return; }
    if (file.size > MAX_BYTES) { toast.error("That image is over 5 MB. Take a smaller screenshot."); return; }
    setBusy(true);
    const path = `shots/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from("match-screenshots").upload(path, file, { contentType: file.type });
    if (up.error) { setBusy(false); toast.error("Couldn't upload the image. Check your connection and try again."); return; }
    const { error } = await supabase.rpc("submit_match_screenshot", { _reference: creds.ref, _phone: creds.phone, _fixture_id: fixture.id, _path: path });
    setBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success("Screenshot sent. The organiser will record the result.");
    qc.invalidateQueries({ queryKey: ["public-league", "shots"] });
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-background/50 p-3">
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={pick} aria-label="Choose your result screenshot" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={mine ? "outline" : "hero"} disabled={busy} onClick={() => input.current?.click()}>
          {mine ? <Check className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
          {busy ? "Uploading…" : mine ? "Screenshot sent · replace" : "Upload result screenshot"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {mine ? (state?.opponent ? "Your opponent has uploaded theirs too." : "Waiting for your opponent to upload theirs.") : state?.opponent ? "Your opponent has uploaded theirs." : "After you play, both players upload the full-time screen."}
        </span>
      </div>
      {!mine && <p className="mt-2 text-xs text-muted-foreground">Take a screenshot of the final result screen showing both players and the score. You don't type the score: the organiser compares both screenshots and records it.</p>}
    </div>
  );
}
