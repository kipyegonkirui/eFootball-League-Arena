# eFootball Arena Kenya

Build a polished, production-minded full-stack website for an eFootball tournament registration business serving Kenya. Project name: eFootball Arena Kenya.

Core business rules:
- Initial registration fee is KES 100, but an authorized admin can change the fee later in settings without editing code.
- Each tournament group/bracket contains exactly 8 confirmed players. Never put a player on the confirmed registration list until their payment has been verified by an authorized admin or a trusted payment-provider callback. A submitted registration/payment request must remain "Awaiting payment verification" and must not consume a confirmed slot until verification succeeds.
- Prevent overbooking and duplicate registrations. Use server-side/database enforcement for capacity and atomic slot assignment, not just frontend checks.
- Start with a safe manual M-Pesa verification flow: display the tournament's configured Paybill/Till and account/reference instructions, let player submit phone number, M-Pesa transaction code, amount, and optional screenshot, and store as pending. Admin reviews and explicitly verifies/rejects it. Never trust a client-submitted success flag or transaction code alone. Design code so official Safaricom Daraja STK Push/callback integration can be added later, but do not pretend it is already integrated. Do not request/store M-Pesa PINs.
- When a group fills at 8 verified players, mark it full and place further paid/verified entrants into the next available group. If there are no open groups, do not accept payment or claim a slot is reserved; explain that registration is full / offer a waitlist without payment.
- Keep an auditable payment verification record (who verified, timestamp, transaction code, amount, decision/reason). Only admins can access the admin dashboard and perform verification or change settings.

UX and design:
- Make it feel like a premium, energetic esports/eFootball tournament platform, mobile-first and excellent on Android. Dark navy/near-black background, electric green and vivid cyan accents, bold typography, subtle pitch/football geometry, cards and crisp status badges. Avoid clutter.
- Landing page hero with headline "Your Next Match Starts Here", clear "Register for Tournament" CTA, how it works (Register → Pay via M-Pesa → Payment verified → Get your group/slot), current tournament details, fee prominently showing KES 100 from settings, capacity status, groups progress (0/8), and public confirmed player lists only.
- Registration form: full name/player tag, phone number, email optional, eFootball platform/console (Mobile, PlayStation, Xbox, Other), preferred game mode, M-Pesa transaction code and amount when submitting payment proof; clear terms and pending status. Do not display unverified entries publicly.
- Player-facing status lookup/dashboard via secure registration reference + phone verification or account sign-in; show pending/verified/rejected, group number, slot, next steps. Avoid leaking personal phone numbers.
- Tournament page showing groups with 8 seats each, only confirmed players and their public gamer tags, full/open group badges, and live updates when registrations are verified.
- Admin dashboard with secure admin-only access: overview cards (verified registrations, pending payments, total verified collections, open slots); pending payment queue with approve/reject and reason; confirmed players grouped by groups of 8; search/filter/export CSV; settings to edit registration fee, tournament name/description, M-Pesa Paybill/Till instructions, registration open/closed, and capacity per group fixed at 8 unless explicitly changed by admin. Keep default capacity 8.
- Responsive navigation, loading/empty/error states, validation, toast feedback, accessible contrast, and polished mobile forms.

Implementation requirements:
- Use the platform's full-stack backend/database/auth capabilities. Create persistent schema for tournament settings, registrations, groups, payment submissions, and verification audit logs; secure row-level access / server-side authorization. Do not rely on localStorage for registrations or payment state.
- Public visitors can read public tournament info and confirmed gamer tags/group status, but not pending applicants, contact details, payment proof, transaction codes, audit records, or admin settings secrets.
- Admin actions must be checked on the backend, not only by hiding UI. Never ship service-role credentials or payment secrets to the browser.
- Build a functional first version with manual M-Pesa verification, realistic empty states and demo-free data (do not fabricate real players/payments). Include setup notes for creating the first admin securely and future Daraja integration. If external credentials are required, make the UI clearly indicate that the owner must configure them; do not simulate successful payment.
- Test key flow and fix issues: applicant submission remains pending; pending users absent from public confirmed list and don't occupy a slot; admin approval assigns exactly one slot; rejection does not assign a slot; group caps at 8; fee changes reflected in the public page; non-admin cannot access admin operations.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/63638908-ab1a-441e-8817-151e7db308a8).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
