import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderEmailHtml } from "../modules/notifications/email-layout.js";

/**
 * Generate the auth emails Supabase sends, in our layout.
 *
 *   pnpm --filter @delicate/api run supabase:templates
 *
 * Supabase owns sign-up confirmation, password reset and email changes: they go out from its
 * servers, not ours, so the engine never sees them and cannot style them at send time. The
 * only way in is the dashboard, which takes pasted HTML.
 *
 * Pasted HTML rots. So these are generated from `email-layout.ts` -- the same file every
 * other message goes through -- and the answer to "we restyled, what about the auth emails"
 * is to run this again and paste the output, rather than hand-editing four copies of a
 * design until they disagree with the product.
 *
 * Supabase substitutes `{{ .ConfirmationURL }}` and `{{ .NewEmail }}` on its own servers. We
 * emit them intact: escaping does not touch braces or dots, so they survive the layout.
 */

/**
 * Kept in step with `company.tax_profile` by hand, because this runs without a database and
 * Supabase stores the result rather than reading it. Four values, changed about never.
 */
const COMPANY = {
  name: "Delicate Courier",
  legalName: "Delicate Courier (Pty) Ltd",
  address: "14 Camellia Avenue, Lynnwood Ridge, Pretoria, 0081, South Africa",
  email: "support@delicatecourier.co.za",
  phone: "+27 78 574 6727",
};

const WEB_URL = process.env["WEB_PUBLIC_URL"] ?? "https://dev.delicatecourier.co.za";

/** What Supabase swaps in for the real link. */
const CONFIRMATION_URL = "{{ .ConfirmationURL }}";

interface AuthEmail {
  /** Written as this filename, and belongs in the dashboard template of this name. */
  file: string;
  dashboard: string;
  subject: string;
  heading: string;
  /** The button. Named here because the URL is a placeholder and cannot describe itself. */
  action: string;
  body: string;
}

const EMAILS: AuthEmail[] = [
  {
    file: "confirm-signup",
    dashboard: "Confirm signup",
    subject: `Confirm your email · ${COMPANY.name}`,
    heading: "Confirm your email",
    action: "Confirm my email",
    body: `Thanks for signing up with ${COMPANY.name}.

Confirm this address and your account is ready to use. The link works once, and only in the
browser you signed up in.

If you did not create an account, ignore this email and nothing will happen.`,
  },
  {
    file: "reset-password",
    dashboard: "Reset password",
    subject: `Reset your password · ${COMPANY.name}`,
    heading: "Reset your password",
    action: "Choose a new password",
    body: `Somebody asked to reset the password on your ${COMPANY.name} account.

Follow the link below to choose a new one. It works once and expires shortly.

If that was not you, ignore this email. Your password has not changed, and nobody can change
it without this link.`,
  },
  {
    file: "magic-link",
    dashboard: "Magic Link",
    subject: `Your sign-in link · ${COMPANY.name}`,
    heading: "Your sign-in link",
    action: "Sign me in",
    body: `Here is the link you asked for. It signs you in to ${COMPANY.name} without a
password, works once, and expires shortly.

If you did not ask for it, ignore this email. Nobody can use it but you.`,
  },
  {
    file: "change-email",
    dashboard: "Change Email Address",
    subject: `Confirm your new email address · ${COMPANY.name}`,
    heading: "Confirm your new address",
    action: "Confirm this address",
    body: `You asked to change the email address on your ${COMPANY.name} account to
{{ .NewEmail }}.

Confirm it below and we will start writing to the new address -- waybills and invoices
included, so it is worth being sure.

If you did not ask for this, ignore this email and tell us. Your address stays as it is.`,
  },
];

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../supabase-emails");
mkdirSync(outDir, { recursive: true });

for (const email of EMAILS) {
  const html = renderEmailHtml({
    heading: email.heading,
    body: email.body,
    company: { ...COMPANY, waSubject: email.heading },
    webUrl: WEB_URL,
    cta: { label: email.action, url: CONFIRMATION_URL },
  });

  writeFileSync(resolve(outDir, `${email.file}.html`), html);
  console.log(`${email.dashboard.padEnd(22)} ${email.file}.html`);
  console.log(`${"".padEnd(22)} subject: ${email.subject}\n`);
}

console.log(`Written to apps/api/supabase-emails/

Paste each into Supabase -> Authentication -> Emails -> Templates, picking the template named
on the left and setting its subject to match. Re-run after any change to email-layout.ts.`);
