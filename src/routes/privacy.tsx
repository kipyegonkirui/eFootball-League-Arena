import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/site";
import { ORGANISER_CONTACT } from "@/lib/tournament";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Notice — eFootball Arena Kenya" },
      { name: "description", content: "What personal data we collect for the tournament, why, who sees it and your rights." },
      { property: "og:title", content: "Privacy Notice — eFootball Arena Kenya" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrivacyPage,
});

function S({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-5 md:p-6">
      <h2 className="text-2xl font-bold uppercase">{title}</h2>
      <div className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground [&_li]:ml-5 [&_li]:list-disc [&_b]:text-foreground">{children}</div>
    </section>
  );
}

function PrivacyPage() {
  return (
    <PageShell kicker="Your data" title="Privacy notice">
      <p className="mb-6 max-w-3xl text-muted-foreground">We collect only what is needed to run the tournament and verify payments. This notice follows Kenya's Data Protection Act, 2019.</p>
      <div className="grid gap-4 md:max-w-3xl">
        <S title="What we collect">
          <ul>
            <li><b>Registration:</b> full name, phone number, optional email, eFootball username, team name, platform and game mode.</li>
            <li><b>Payment:</b> M-Pesa transaction code, amount, the paying phone number and, if you upload one, a payment screenshot.</li>
            <li><b>Matches:</b> scores, disputes you raise and notes you write, and the organiser's decisions.</li>
            <li><b>Account (organisers only):</b> email and password for the admin login.</li>
          </ul>
        </S>

        <S title="Why we use it">
          <ul>
            <li>To register you, check your payment and confirm your slot.</li>
            <li>To run groups, fixtures, the league table, disputes and prize payouts, and to contact you about your matches.</li>
            <li>To let you and your next opponent reach each other on WhatsApp to arrange the match.</li>
            <li>To prevent fraud, such as duplicate registrations or reused transaction codes.</li>
          </ul>
          <p>We process this data because you ask to enter the tournament (contract) and because you consent when you tick the box on the registration form.</p>
        </S>

        <S title="What is public and what is private">
          <ul>
            <li><b>Public:</b> your eFootball username, team name, platform, group, fixtures and results.</li>
            <li><b>Private (organisers only):</b> full name, email, payment details and screenshots. Screenshots are stored in a private file store.</li>
            <li><b>Phone number:</b> organisers see it. The one other person who can see it is the player you are due to face next, so you can arrange the match on WhatsApp.</li>
            <li>Your phone number is never shown on the public site. The Check status page shows only the last 3 digits.</li>
            <li>Your next opponent gets your number only for that one upcoming match, and only after they confirm their own registration details. Once you have played, it is no longer available to them for that match, and nobody else can see it.</li>
          </ul>
        </S>

        <S title="Who we share it with">
          <ul>
            <li>We do <b>not</b> sell your data or use it for advertising.</li>
            <li>Your phone number is shared with your next opponent only, as described above.</li>
            <li>It is processed by our hosting and database provider (Supabase) and by Safaricom M-Pesa for payments and refunds.</li>
            <li>We may disclose data if required by law or to investigate fraud.</li>
          </ul>
        </S>

        <S title="How long we keep it">
          <ul>
            <li>Player details and match records: until the tournament ends plus <b>12 months</b>, then deleted or anonymised.</li>
            <li>Payment records: kept as long as accounting and tax rules require.</li>
            <li>Rejected registrations and unneeded screenshots can be deleted on request.</li>
          </ul>
        </S>

        <S title="Your rights">
          <ul>
            <li>You can ask to see, correct or delete your data, to object to its use, or to withdraw consent. Withdrawing consent means we cannot keep you in the tournament, and fees follow the refund rules.</li>
            <li>If you are unhappy with how we handle your data you can complain to the Office of the Data Protection Commissioner of Kenya (odpc.go.ke).</li>
          </ul>
        </S>

        <S title="Security">
          <p>Data is stored in a protected database with access limited to verified organisers. No system is perfectly secure, so please never share your M-Pesa PIN with anyone. We will never ask for it.</p>
        </S>

        <p className="text-sm text-muted-foreground">
          To make a request: {ORGANISER_CONTACT ? <b className="text-foreground">{ORGANISER_CONTACT}</b> : "message the organiser in your tournament group chat"}, quoting your registration reference.
        </p>
      </div>
    </PageShell>
  );
}
