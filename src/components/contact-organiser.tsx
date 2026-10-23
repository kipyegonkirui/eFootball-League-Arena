import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { ORGANISER_WHATSAPP, whatsappLink } from "@/lib/tournament";

const GREETING = "Hi, I have a question about the eFootball Arena Kenya league.";

/**
 * Floating "chat with the organiser" button on every page. Sits bottom-left so it never overlaps the host's
 * badge in the bottom-right corner. Opens a small list of WhatsApp numbers; each link opens a chat with the greeting typed in.
 */
export function ContactOrganiser() {
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed bottom-4 left-4 z-40">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-12 items-center gap-2 rounded-full bg-[#25D366] px-4 text-sm font-bold text-black shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Chat with the organiser on WhatsApp"
          >
            <WhatsAppIcon className="h-5 w-5" />
            <span className="hidden sm:inline">Chat with organiser</span>
            <span className="sm:hidden">Chat</span>
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-72">
          <p className="font-display text-xl font-bold uppercase">Questions?</p>
          <p className="mt-1 text-sm text-muted-foreground">Message an organiser on WhatsApp about registering, payments or your matches.</p>
          <ul className="mt-3 space-y-2">
            {ORGANISER_WHATSAPP.map((o) => (
              <li key={o.intl}>
                <a
                  href={whatsappLink(o.intl, GREETING)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm font-semibold hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#25D366] text-black"><WhatsAppIcon className="h-4 w-4" /></span>
                  <span className="min-w-0"><span className="block">{o.label}</span><span className="block text-xs font-normal text-muted-foreground">{o.display}</span></span>
                </a>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}
