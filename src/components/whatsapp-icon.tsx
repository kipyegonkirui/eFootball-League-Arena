import { MessageCircle } from "lucide-react";

/**
 * The icon used on every WhatsApp button. It is one file on purpose: to use the official WhatsApp artwork,
 * put the SVG in /public (for example /public/whatsapp.svg) and replace the body with
 *   <img src="/whatsapp.svg" alt="" aria-hidden="true" className={className} />
 */
export function WhatsAppIcon({ className }: { className?: string }) {
  return <MessageCircle className={className} aria-hidden="true" />;
}
