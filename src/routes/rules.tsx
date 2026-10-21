import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/site";
import { ORGANISER_CONTACT } from "@/lib/tournament";

export const Route = createFileRoute("/rules")({
  head: () => ({
    meta: [
      { title: "Tournament Rules — eFootball Arena Kenya" },
      { name: "description", content: "Match deadlines, no-shows, disconnects, score proof, refunds, tie-breaks and dispute rules." },
      { property: "og:title", content: "Tournament Rules — eFootball Arena Kenya" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RulesPage,
});

function S({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-5 md:p-6">
      <h2 className="text-2xl font-bold uppercase"><span className="mr-2 text-primary">{n}.</span>{title}</h2>
      <div className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground [&_li]:ml-5 [&_li]:list-disc [&_b]:text-foreground">{children}</div>
    </section>
  );
}

function RulesPage() {
  return (
    <PageShell kicker="Fair play" title="Tournament rules">
      <p className="mb-6 max-w-3xl text-muted-foreground">By registering you agree to these rules. The organiser's decision on any dispute is final once the process in section 5 is complete.</p>
      <div className="grid gap-4 md:max-w-3xl">
        <S n={1} title="Format">
          <ul>
            <li>32 players in 4 groups of 8. When registering, each player chooses a <b>1-week league</b> (everyone plays everyone once, 7 matches) or a <b>2-week league</b> (home and away, 14 matches).</li>
            <li>When a group is full, the organiser generates its fixtures using the choice <b>most of that group's players made</b>. If it is a tie, the 2-week league is used. Once fixtures are generated they cannot be changed.</li>
            <li>The "home" player creates the match room and invites the opponent. Match settings (time, mode, team strength) are the same for everyone and are announced before kick-off of round 1.</li>
            <li>Win = 3 points, draw = 1, loss = 0. Prizes go to the top three players in the overall table once every match is played.</li>
            <li>The competition runs in <b>seasons</b>. When a group is full the organiser can start its league without waiting for the other groups. Players who are not in a full group yet, and anyone whose payment is still being checked, <b>move to the next season automatically</b> and keep their paid entry. If you would rather not wait, ask the organiser for a refund.</li>
            <li>You must play with the eFootball username you registered with. Each username can register only once; team names may repeat, so the username identifies you. Playing through another person's account is not allowed.</li>
          </ul>
        </S>

        <S n={2} title="Match deadlines">
          <ul>
            <li>Fixtures are released in rounds, roughly <b>one round per day</b> (7 rounds in a 1-week league, 14 in a 2-week league). The organiser announces each round's date and deadline on the site and in your group chat.</li>
            <li>Agree a kick-off time with your opponent in the group chat <b>as soon as the round opens</b>. Offer at least two times that suit you.</li>
            <li>A match not played by the end of its round is handled under section 3 unless the organiser extended the deadline in writing.</li>
          </ul>
        </S>

        <S n={3} title="No-shows">
          <ul>
            <li>Wait <b>15 minutes</b> after the agreed time. If your opponent has not joined, screenshot the chat showing the agreed time and your invite, then report it to the organiser.</li>
            <li>The no-show player loses <b>3-0</b>. If both players failed to show or reply, the match is recorded <b>0-0 with 0 points for both players</b> (a genuine 0-0 draw still gives 1 point each). The organiser writes down the reason for every no-show.</li>
            <li>A player who forfeits <b>3 matches</b> without a valid reason may be removed. The entry fee is not refunded and their remaining matches are recorded as 3-0 wins for opponents.</li>
            <li>Tell your opponent and the organiser <b>before</b> kick-off if you have a genuine problem. The organiser may rearrange one match per player.</li>
          </ul>
        </S>

        <S n={4} title="Disconnects and technical problems">
          <ul>
            <li>If someone disconnects, both players screenshot the screen if possible and try to rejoin and continue <b>from the same score and minute</b>. If the game cannot resume, replay the match from 0-0 within 48 hours.</li>
            <li>If a player is <b>winning</b> when they disconnect and the opponent cannot resume, the score at disconnection stands once confirmed by the organiser.</li>
            <li>Deliberately disconnecting or quitting while losing is a forfeit: the opponent wins 3-0.</li>
            <li>Repeated disconnects may be reviewed. Bad internet is the player's responsibility. Agree a stable connection before playing.</li>
          </ul>
        </S>

        <S n={5} title="Proving and reporting scores">
          <ul>
            <li>Right after the match, <b>both players screenshot the final result screen</b> showing both usernames and the score, and keep it until the tournament ends.</li>
            <li>The winner (or either player after a draw) sends the screenshot to the organiser. Results only count once the organiser confirms them on the site.</li>
            <li>If you see a wrong result on your Check status page, press <b>Dispute</b> within <b>48 hours</b> and explain what is wrong. The match is taken out of the table until it is resolved.</li>
            <li>The organiser reviews both players' screenshots, may ask for a replay, and records a final score or voids the match for a replay. Every change is logged.</li>
            <li>Fake or edited screenshots mean immediate removal with no refund.</li>
          </ul>
        </S>

        <S n={6} title="Table order and tie-breaks">
          <ul>
            <li>Players are ranked by, in this order: <b>1) points, 2) goal difference, 3) goals scored</b>.</li>
            <li>If players are still level for a prize position, the organiser arranges a <b>one-off playoff match</b> between them.</li>
            <li>Only organiser-confirmed results count. Scheduled and disputed matches never change the table.</li>
          </ul>
        </S>

        <S n={7} title="Prizes">
          <ul>
            <li>The prize pool is a fixed percentage of verified entry fees and is shown on the site. It is split between the top three as shown there.</li>
            <li>When every match is finished the organiser ends the season, which freezes the final table and prizes. Winners are paid by M-Pesa to the phone number they registered with within <b>7 days</b> of that. Make sure it is correct.</li>
            <li>The organiser may withhold a prize if cheating or fraud is found.</li>
          </ul>
        </S>

        <S n={8} title="Payments and refunds">
          <ul>
            <li>The entry fee is paid per season. Pay the entry fee by M-Pesa Send Money to the number shown on the registration page, then enter the transaction code. <b>We never ask for your M-Pesa PIN.</b></li>
            <li>Your slot is confirmed only after an organiser verifies your payment. Registration alone does not hold a slot.</li>
            <li><b>Full refund</b> if: your payment could not be matched and your slot was never confirmed, you paid but the tournament was full (we refund or move you to the waitlist, your choice), or the organiser cancels the tournament before it starts.</li>
            <li><b>No refund</b> once your slot is confirmed and the tournament has started, or if you are removed for breaking these rules.</li>
            <li>Refunds are sent to the paying M-Pesa number within <b>7 days</b> of the request.</li>
          </ul>
        </S>

        <S n={9} title="Conduct">
          <ul>
            <li>Be respectful. Abuse, threats or harassment of players or organisers can lead to removal without refund.</li>
            <li>No cheating, match-fixing or using more than one account.</li>
            <li>The organiser may update these rules for fairness or to fix a problem. Changes are announced before the next round and never reverse results already confirmed.</li>
          </ul>
        </S>

        <p className="text-sm text-muted-foreground">
          Questions about these rules? {ORGANISER_CONTACT ? <>Contact the organiser: <b className="text-foreground">{ORGANISER_CONTACT}</b>.</> : "Ask the organiser in your group chat."}
        </p>
      </div>
    </PageShell>
  );
}
