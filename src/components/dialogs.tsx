import * as DialogPrimitive from "@radix-ui/react-dialog";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AlertTriangle, HelpCircle, MessageSquareText, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * App-wide replacements for window.confirm() and window.prompt().
 *
 *   const dialogs = useDialogs();
 *   if (!(await dialogs.confirm({ title: "End Season 1?", tone: "danger" }))) return;
 *   const reason = await dialogs.prompt({ title: "Reason for rejection?", minLength: 3 });
 *   if (reason === null) return; // cancelled
 */

export type DialogTone = "default" | "danger" | "success";

export type ConfirmOptions = {
  title: string;
  description?: string;
  /** Short lines shown as a list, e.g. one line per group. */
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
};

export type PromptOptions = {
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
  /** Minimum trimmed length. Defaults to 1 (required). Use 0 for an optional answer. */
  minLength?: number;
  maxLength?: number;
};

type Request =
  | { id: number; kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { id: number; kind: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void };

type Api = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
};

const Ctx = createContext<Api | null>(null);

export function useDialogs(): Api {
  const api = useContext(Ctx);
  if (!api) throw new Error("useDialogs must be used inside <DialogProvider>.");
  return api;
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [req, setReq] = useState<Request | null>(null);
  const current = useRef<Request | null>(null);
  const last = useRef<Request | null>(null);
  const counter = useRef(0);

  const settle = useCallback((value: boolean | string | null) => {
    const r = current.current;
    if (!r) return;
    current.current = null;
    setReq(null);
    if (r.kind === "confirm") r.resolve(value === true);
    else r.resolve(typeof value === "string" ? value : null);
  }, []);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        if (current.current) settle(false); // a newer dialog replaces an unanswered one
        const r: Request = { id: ++counter.current, kind: "confirm", opts, resolve };
        current.current = r;
        setReq(r);
      }),
    [settle],
  );

  const prompt = useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        if (current.current) settle(null);
        const r: Request = { id: ++counter.current, kind: "prompt", opts, resolve };
        current.current = r;
        setReq(r);
      }),
    [settle],
  );

  const api = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);
  if (req) last.current = req;
  const view = req ?? last.current;

  return (
    <Ctx.Provider value={api}>
      {children}
      {view && <DialogHost key={view.id} req={view} open={!!req} onSettle={settle} />}
    </Ctx.Provider>
  );
}

const TONE = {
  default: { bar: "bg-gradient-brand", tile: "bg-accent/15 text-accent", Icon: HelpCircle, btn: "hero" as const },
  success: { bar: "bg-gradient-brand", tile: "bg-primary/15 text-primary", Icon: Play, btn: "hero" as const },
  danger: { bar: "bg-destructive", tile: "bg-destructive/15 text-destructive", Icon: AlertTriangle, btn: "destructive" as const },
};

function DialogHost({ req, open, onSettle }: { req: Request; open: boolean; onSettle: (v: boolean | string | null) => void }) {
  const opts = req.opts;
  const tone = TONE[opts.tone ?? (req.kind === "prompt" ? "default" : "default")];
  const Icon = req.kind === "prompt" && !opts.tone ? MessageSquareText : tone.Icon;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);

  const min = req.kind === "prompt" ? (req.opts.minLength ?? 1) : 0;
  const max = req.kind === "prompt" ? (req.opts.maxLength ?? 300) : 0;
  const tooShort = req.kind === "prompt" && text.trim().length < min;
  const error = touched && tooShort ? (min <= 1 ? "This is required." : `Enter at least ${min} characters.`) : null;

  function submit() {
    if (req.kind === "confirm") return onSettle(true);
    setTouched(true);
    if (tooShort) return textRef.current?.focus();
    onSettle(text.trim());
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => { if (!o) onSettle(req.kind === "confirm" ? false : null); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            // Destructive confirmations start on Cancel so Enter can't wipe something by accident.
            if (req.kind === "prompt") textRef.current?.focus();
            else if (opts.tone === "danger") cancelRef.current?.focus();
            else (e.currentTarget as HTMLElement).querySelector<HTMLButtonElement>("[data-confirm]")?.focus();
          }}
          className="fixed left-1/2 top-1/2 z-[60] w-[calc(100vw-1.5rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-border bg-card shadow-card outline-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <div className={cn("h-1 w-full", tone.bar)} />
          <div className="bg-pitch p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", tone.tile)}>
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <DialogPrimitive.Title className="font-display text-2xl font-bold uppercase leading-tight">{opts.title}</DialogPrimitive.Title>
                <DialogPrimitive.Description className={cn("mt-1.5 text-sm text-muted-foreground", !opts.description && "sr-only")}>
                  {opts.description ?? opts.title}
                </DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close className="-mr-1 -mt-1 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Close">
                <X className="h-4 w-4" />
              </DialogPrimitive.Close>
            </div>

            {req.kind === "confirm" && req.opts.details && req.opts.details.length > 0 && (
              <ul className="mt-4 space-y-2 rounded-xl border border-border bg-background/60 p-3 text-sm">
                {req.opts.details.map((line, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className={cn("mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full", opts.tone === "danger" ? "bg-destructive" : "bg-primary")} />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            )}

            {req.kind === "prompt" && (
              <div className="mt-4 space-y-1.5">
                {req.opts.label && <label htmlFor={`dlg-${req.id}`} className="text-sm font-semibold">{req.opts.label}</label>}
                <textarea
                  id={`dlg-${req.id}`}
                  ref={textRef}
                  value={text}
                  rows={3}
                  maxLength={max}
                  placeholder={req.opts.placeholder}
                  aria-invalid={!!error}
                  aria-describedby={error ? `dlg-${req.id}-err` : undefined}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
                  className={cn(
                    "w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    error ? "border-destructive" : "border-input",
                  )}
                />
                <div className="flex items-center justify-between text-xs">
                  <span id={`dlg-${req.id}-err`} role="alert" className="text-destructive">{error}</span>
                  <span className="text-muted-foreground">{text.length}/{max}</span>
                </div>
              </div>
            )}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button ref={cancelRef} type="button" variant="outline" onClick={() => onSettle(req.kind === "confirm" ? false : null)}>
                {opts.cancelLabel ?? "Cancel"}
              </Button>
              <Button data-confirm type="button" variant={tone.btn} size={tone.btn === "hero" ? "default" : "default"} className={tone.btn === "hero" ? "text-base" : undefined} onClick={submit}>
                {opts.confirmLabel ?? (req.kind === "prompt" ? "Submit" : "Confirm")}
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
