/**
 * The HTML shell every outbound email is poured into.
 *
 * One layout, not one per message: the templates in `templates.ts` stay plain text that an
 * operator can edit in the console without knowing HTML, and the design lives here. Restyling
 * is this file; rewording is the console. A template somebody writes next year gets the brand
 * for free.
 *
 * Written the way email has to be written rather than the way a page is: tables for layout,
 * every style inlined, no flexbox or grid, no external stylesheet. Outlook renders with Word,
 * which understands roughly none of what a browser does. The `<style>` block carries only the
 * mobile media query, which is additive — everything still reads if a client drops it.
 */

const BRAND = {
  ink: "#0A0A0A",
  pink: "#E84A8A",
  pinkSoft: "#F7A8CE",
  pinkWash: "#FDF0F6",
  purple: "#7C5CFF",
  surface: "#F8F6F3",
  line: "#ECEAE6",
  muted: "#86817A",
  white: "#FFFFFF",
} as const;

/** Body text and headings, with the fallbacks that actually render in a mail client. */
const SANS = "'Be Vietnam Pro', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const DISPLAY = "Manrope, -apple-system, 'Segoe UI Semibold', Helvetica, Arial, sans-serif";

export interface EmailLayoutInput {
  /** Rendered subject; doubles as the heading, which is why templates have readable subjects. */
  heading: string | null;
  /** The rendered plain-text body. Paragraphs are blank-line separated. */
  body: string;
  company: {
    name: string;
    legalName: string;
    address: string | null;
    email: string | null;
    phone: string | null;
    /** Prefills the WhatsApp message, so support opens on the right subject. */
    waSubject?: string | null;
  };
  /** Absolute base URL of the portal, for the logo and links. */
  webUrl: string;
  /** What is actually being delivered, one row per parcel. Rendered as a table. */
  consignment?: ConsignmentRow[] | null;
  /**
   * The button, when the caller knows it better than the link can say.
   *
   * Normally the closing link becomes the button and its label is read off the path, which
   * works because our own URLs describe themselves. A Supabase auth email does not have a URL
   * at all until Supabase substitutes one, so the caller names the button instead.
   */
  cta?: { label: string; url: string } | null;
}

/**
 * One parcel on its way.
 *
 * Structured rather than prose because it is a table: a customer checking a confirmation is
 * scanning down a column for the one that is wrong, not reading a sentence.
 */
export interface ConsignmentRow {
  waybill: string;
  /** Where it is going — suburb, or the full address when there is no suburb. */
  destination: string;
  recipient: string | null;
  /** "1 x Xsmall Cake Box", already counted and named. */
  contents: string;
  weight: string | null;
}

export function renderEmailHtml(input: EmailLayoutInput): string {
  const { company, webUrl } = input;
  const cta = input.cta ?? findCta(input.body);
  const paragraphs = toParagraphs(input.body, cta);

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="format-detection" content="telephone=no" />
<title>${esc(input.heading ?? company.name)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<!--[if !mso]><!-->
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@700;800&amp;family=Be+Vietnam+Pro:wght@400;500;600&amp;display=swap" rel="stylesheet" />
<!--<![endif]-->
<style type="text/css">
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  a { color:${BRAND.pink}; }
  .ExternalClass, .ExternalClass * { line-height:100%; }
  @media only screen and (max-width:620px) {
    .wrap { width:100% !important; }
    .pad { padding-left:24px !important; padding-right:24px !important; }
    .hero { padding-top:32px !important; padding-bottom:32px !important; }
    .h1 { font-size:28px !important; line-height:1.2 !important; }
    .stack { display:block !important; width:100% !important; }
    .stack-gap { height:24px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:${BRAND.surface};">
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:${BRAND.surface};">${esc(preheader(input.body))}</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${BRAND.surface};">
<tr><td align="center" style="padding:24px 12px;">

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="wrap" style="width:600px; max-width:600px; background-color:${BRAND.white}; border-radius:18px; overflow:hidden;">

    <!-- Logo -->
    <tr><td align="center" style="background-color:${BRAND.white}; padding:36px 24px 8px 24px;">
      <img src="${esc(webUrl)}/images/logo.png" width="156" alt="${esc(company.name)}" style="display:block; width:156px; max-width:156px; height:auto;" />
    </td></tr>

    <!-- Heading, on the brand wash rather than a background image: a background image that
         fails to load in Outlook leaves white text on white. -->
    ${
      input.heading
        ? `<tr><td class="pad hero" style="background-color:${BRAND.pinkWash}; padding:34px 40px 34px 40px; border-top:1px solid ${BRAND.line};">
      <h1 class="h1" style="margin:0; font-family:${DISPLAY}; font-size:30px; line-height:1.18; font-weight:800; letter-spacing:-0.02em; color:${BRAND.ink};">${esc(input.heading)}</h1>
    </td></tr>`
        : ""
    }

    <!-- Body -->
    <tr><td class="pad" style="padding:34px 40px 8px 40px; font-family:${SANS}; font-size:16px; line-height:1.65; color:#2A2724;">
      ${paragraphs}
    </td></tr>

    ${consignmentTable(input.consignment ?? null)}

    ${cta ? ctaButton(cta) : ""}

    ${supportBlock(company, SANS)}

    <tr><td class="pad" style="padding:8px 40px 36px 40px;">
      <div style="height:1px; line-height:1px; font-size:0; background-color:${BRAND.line};">&nbsp;</div>
      <p style="margin:18px 0 0 0; font-family:${SANS}; font-size:13px; line-height:1.6; color:${BRAND.muted};">
        You are receiving this because of activity on your ${esc(company.name)} account.
        Choose which of these you get in
        <a href="${esc(webUrl)}/portal/notifications" style="color:${BRAND.pink}; text-decoration:underline;">your notification settings</a>.
      </p>
    </td></tr>

    <!-- Footer -->
    <tr><td class="pad" style="background-color:${BRAND.ink}; padding:30px 40px 32px 40px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td class="stack" valign="top" style="font-family:${SANS}; font-size:13px; line-height:1.7; color:#FFFFFF;">
            <div style="font-weight:600; color:#FFFFFF;">${esc(company.legalName)}</div>
            ${company.address ? `<div style="color:#B8B4AE;">${esc(company.address)}</div>` : ""}
            ${
              company.email
                ? `<div><a href="mailto:${esc(company.email)}" style="color:#B8B4AE; text-decoration:none;">${esc(company.email)}</a></div>`
                : ""
            }
            ${company.phone ? `<div style="color:#B8B4AE;">${esc(company.phone)}</div>` : ""}
          </td>
          <td class="stack-gap" style="font-size:0; line-height:0; width:24px;">&nbsp;</td>
          <td class="stack" valign="top" align="right" style="font-family:${SANS}; font-size:13px; line-height:1.7; white-space:nowrap;">
            <div><a href="${esc(webUrl)}/portal" style="color:#B8B4AE; text-decoration:none;">Portal</a></div>
            <div><a href="${esc(webUrl)}/track" style="color:#B8B4AE; text-decoration:none;">Track a delivery</a></div>
            <div><a href="${esc(webUrl)}/contact" style="color:#B8B4AE; text-decoration:none;">Contact us</a></div>
          </td>
        </tr>
      </table>
      <div style="height:1px; line-height:1px; font-size:0; background-color:#2A2724; margin:22px 0 0 0;">&nbsp;</div>
      <p style="margin:16px 0 0 0; font-family:${SANS}; font-size:12px; line-height:1.6; color:#6F6A64;">
        Same-day delivery across Gauteng, for the things that cannot wait.
      </p>
    </td></tr>

  </table>

</td></tr>
</table>
</body>
</html>`;
}

/**
 * How to reach a person.
 *
 * Taken from the shape the live platform already sends, because a customer who has had mail
 * from us before should recognise this one. WhatsApp earns its place: it is how most people
 * here actually ask a question, and prefilling the message means the first thing support sees
 * is what the mail was about rather than "hi".
 */
function supportBlock(company: EmailLayoutInput["company"], sans: string): string {
  const wa = whatsAppLink(company.phone, company.waSubject ?? null);
  if (!company.email && !company.phone) return "";
  const bits: string[] = [];
  if (company.email) {
    bits.push(
      `<a href="mailto:${esc(company.email)}" style="color:${BRAND.pink}; text-decoration:underline;">${esc(company.email)}</a>`,
    );
  }
  if (wa) {
    bits.push(
      `<a href="${esc(wa)}" style="color:${BRAND.pink}; text-decoration:underline;">WhatsApp ${esc(company.phone!)}</a>`,
    );
  } else if (company.phone) {
    bits.push(esc(company.phone));
  }
  return `<tr><td class="pad" style="padding:6px 40px 10px 40px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${BRAND.surface}; border-radius:12px;">
        <tr><td style="padding:16px 20px; font-family:${sans}; font-size:14px; line-height:1.6; color:#2A2724;">
          <strong style="color:${BRAND.ink};">Questions?</strong> Reach our support team on ${bits.join(" or ")}.
        </td></tr>
      </table>
    </td></tr>`;
}

/**
 * A wa.me link, but only to a number WhatsApp could actually be on.
 *
 * WhatsApp runs on mobiles, so a landline or a toll-free line must not become a link: it opens
 * a chat with nobody, which looks more broken than offering no link at all. That is not
 * hypothetical here -- `company.tax_profile` ships with `0800 000 000`, and 0800 is the South
 * African toll-free prefix, so a looser check happily turns the placeholder into a link.
 *
 * South African mobile numbers are 06x, 07x and 08[1-4]; 0800, 0860 and 0861 are not. Hence
 * the prefix test rather than a length test.
 */
function whatsAppLink(phone: string | null, subject: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  const subscriber = digits.startsWith("27")
    ? digits.slice(2)
    : digits.startsWith("0")
      ? digits.slice(1)
      : null;
  if (!subscriber || !/^(6\d|7[1-9]|8[1-4])\d{7}$/.test(subscriber)) return null;
  const text = subject ? `?text=${encodeURIComponent(`Hi, I need help with: ${subject}`)}` : "";
  return `https://wa.me/27${subscriber}${text}`;
}

/**
 * What is being delivered, as a table.
 *
 * Headers are dropped on a single-parcel consignment, which is most of them: a five-column
 * header above one row is a worse way to read five facts than labelling them in place. So one
 * parcel is a labelled block and several are a table, which is also how it survives a phone --
 * a five-column table at 375px is unreadable whatever the media query says.
 */
function consignmentTable(rows: ConsignmentRow[] | null): string {
  if (!rows || rows.length === 0) return "";

  const cell = `font-family:${SANS}; font-size:14px; line-height:1.55; color:#2A2724;`;
  const head = `font-family:${SANS}; font-size:11px; letter-spacing:0.06em; text-transform:uppercase; color:${BRAND.muted};`;

  const body =
    rows.length === 1
      ? labelled(rows[0]!, cell)
      : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <th align="left" style="${head} padding:0 0 8px 0;">Waybill</th>
            <th align="left" style="${head} padding:0 0 8px 12px;">To</th>
            <th align="left" style="${head} padding:0 0 8px 12px;">Contents</th>
          </tr>
          ${rows
            .map(
              (r) => `<tr>
            <td valign="top" style="${cell} padding:8px 0 0 0; border-top:1px solid ${BRAND.line};"><strong style="color:${BRAND.ink};">${esc(r.waybill)}</strong></td>
            <td valign="top" style="${cell} padding:8px 0 0 12px; border-top:1px solid ${BRAND.line};">${esc(r.destination)}${r.recipient ? `<br /><span style="color:${BRAND.muted};">${esc(r.recipient)}</span>` : ""}</td>
            <td valign="top" style="${cell} padding:8px 0 0 12px; border-top:1px solid ${BRAND.line};">${esc(r.contents)}${r.weight ? `<br /><span style="color:${BRAND.muted};">${esc(r.weight)}</span>` : ""}</td>
          </tr>`,
            )
            .join("\n          ")}
        </table>`;

  return `<tr><td class="pad" style="padding:6px 40px 10px 40px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid ${BRAND.line}; border-radius:12px;">
        <tr><td style="padding:18px 20px;">
          <div style="${head} padding:0 0 12px 0;">${rows.length === 1 ? "Your parcel" : `Your parcels (${rows.length})`}</div>
          ${body}
        </td></tr>
      </table>
    </td></tr>`;
}

/** One parcel, as labelled facts rather than a one-row table. */
function labelled(r: ConsignmentRow, cell: string): string {
  const label = `font-family:${SANS}; font-size:13px; color:${BRAND.muted};`;
  const line = (k: string, v: string) =>
    `<tr><td style="${label} padding:2px 12px 2px 0; white-space:nowrap;" valign="top">${k}</td><td style="${cell} padding:2px 0;" valign="top">${esc(v)}</td></tr>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
          ${line("Waybill", r.waybill)}
          ${line("To", r.destination)}
          ${r.recipient ? line("Recipient", r.recipient) : ""}
          ${line("Contents", r.contents)}
          ${r.weight ? line("Weight", r.weight) : ""}
        </table>`;
}

/** The same facts as text, for the plain-text part of the message. */
export function consignmentText(rows: ConsignmentRow[] | null): string {
  if (!rows || rows.length === 0) return "";
  const block = rows
    .map((r) =>
      [
        `  ${r.waybill}`,
        `    To: ${r.destination}${r.recipient ? ` (${r.recipient})` : ""}`,
        `    Contents: ${r.contents}${r.weight ? ` — ${r.weight}` : ""}`,
      ].join("\n"),
    )
    .join("\n\n");
  const title = rows.length === 1 ? "Your parcel" : `Your parcels (${rows.length})`;
  return `\n\n${title}:\n${block}`;
}

/* ── turning plain text into a page ──────────────────────────────────────── */

const URL_RE = /https?:\/\/[^\s<>"')]+/g;

/**
 * The call to action, if the copy ends in one.
 *
 * Templates say things like "Track it: https://…" or "Book your first delivery at https://…",
 * which reads correctly as text and looks unfinished as HTML — email expects a button. So the
 * last line that is a short label plus a single URL becomes the button, and is dropped from
 * the prose so the same link does not appear twice.
 *
 * Deliberately narrow: a line with more than one URL, or with real sentences around it, is
 * left alone as text. Being wrong here means a missing button, not a missing link.
 */
function findCta(body: string): { label: string; url: string } | null {
  const lines = body.trim().split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const urls = line.match(URL_RE);
    if (!urls || urls.length !== 1) return null;
    const url = urls[0]!;
    const rest = line.replace(url, "").trim();
    // "Track it:" / "Book your first delivery at" — a label, not a paragraph.
    if (rest.length > 60) return null;
    return { label: ctaLabel(url), url };
  }
  return null;
}

/**
 * Ordered, and the order matters: `/portal/bookings/<id>` contains `/book`, so a confirmed
 * booking would invite the customer to make another one instead of showing them this one.
 * Longest and most specific first.
 */
function ctaLabel(url: string): string {
  if (url.includes("/track")) return "Track your delivery";
  if (url.includes("/bookings")) return "View your booking";
  if (url.includes("/invoices")) return "View your invoice";
  if (url.includes("/wallet")) return "Top up your wallet";
  if (url.includes("/members")) return "Manage who has access";
  if (url.includes("/book")) return "Book a delivery";
  return "Open your portal";
}

/** Bulletproof-ish button: VML for Outlook, a padded anchor everywhere else. */
function ctaButton(cta: { label: string; url: string }): string {
  const href = esc(cta.url);
  return `<tr><td class="pad" align="left" style="padding:18px 40px 10px 40px;">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px; v-text-anchor:middle; width:260px;" arcsize="52%" stroke="f" fillcolor="${BRAND.pink}">
        <w:anchorlock/>
        <center style="color:#ffffff; font-family:Helvetica,Arial,sans-serif; font-size:15px; font-weight:bold;">${esc(cta.label)}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="${href}" style="display:inline-block; background-color:${BRAND.pink}; color:#FFFFFF; font-family:${SANS}; font-size:15px; font-weight:600; line-height:1; text-decoration:none; padding:16px 32px; border-radius:26px;">${esc(cta.label)}</a>
      <!--<![endif]-->
    </td></tr>`;
}

/** Blank-line separated text becomes paragraphs; bare URLs become links. */
function toParagraphs(body: string, cta: { label: string; url: string } | null): string {
  let text = body.trim();
  if (cta) {
    // Drop the line the button replaced, so the link is not offered twice.
    text = text
      .split(/\r?\n/)
      .filter((line) => !line.includes(cta.url))
      .join("\n")
      .trim();
  }
  const blocks = text.split(/\n\s*\n/).filter((b) => b.trim());
  return blocks
    .map((block) => {
      // Whatever newlines survive unwrapping were meant.
      const html = inline(esc(unwrap(block.trim()))).replace(/\r?\n/g, "<br />");
      return `<p style="margin:0 0 16px 0;">${html}</p>`;
    })
    .join("\n      ");
}

/**
 * Undo the hard wrapping, but only where it was wrapping.
 *
 * The templates are written as plain text wrapped near column 95, so rendering every newline
 * as a break leaves a ragged edge mid-sentence in a 600px email. But some newlines are real:
 *
 *   Reason: damaged in transit
 *   New balance: R 4 750,00
 *
 * has to stay two lines. A wrapped continuation starts lower-case; a line of its own starts
 * with a capital. So that is the test, rather than a length threshold that a long enough
 * `reason` would trip. A line ending in a colon is a label, and always keeps its break.
 */
function unwrap(block: string): string {
  const out: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    const prev = out[out.length - 1];
    const continues =
      prev !== undefined && !prev.trimEnd().endsWith(":") && /^[a-z0-9(]/.test(line.trim());
    if (continues) out[out.length - 1] = `${prev.trimEnd()} ${line.trim()}`;
    else out.push(line);
  }
  return out.join("\n");
}

/**
 * The two bits of markup a template author can reach for: **bold** and a bare URL.
 *
 * Not a Markdown parser. Templates are plain text that has to read correctly as plain text --
 * it is still sent that way -- so the only markup allowed is the kind that already looks like
 * emphasis when nothing renders it. `**Ready to send your first delivery?**` reads fine in a
 * text client and becomes a heading-ish line in HTML, and that is the whole feature.
 *
 * Runs after escaping, so a customer-supplied value cannot smuggle a tag in through it.
 */
function inline(escaped: string): string {
  return linkify(escaped).replace(
    /\*\*([^*\n]+)\*\*/g,
    (_m, text: string) => `<strong style="color:${BRAND.ink};">${text}</strong>`,
  );
}

function linkify(escaped: string): string {
  return escaped.replace(
    URL_RE,
    (url) => `<a href="${url}" style="color:${BRAND.pink}; text-decoration:underline;">${url}</a>`,
  );
}

/**
 * The grey line of text a client shows beside the subject. Without one it shows whatever comes
 * first in the HTML, which is the "view in browser" link or the alt text of the logo.
 */
function preheader(body: string): string {
  const first = body.trim().split(/\n\s*\n/)[0] ?? "";
  const flat = first.replace(/\s+/g, " ").trim();
  return flat.length > 140 ? `${flat.slice(0, 139)}…` : flat;
}

/** Escaping is not optional: an account name is customer-supplied and lands in the HTML. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
