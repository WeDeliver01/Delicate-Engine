import { describe, expect, it } from "vitest";
import {
  consignmentText,
  proofText,
  renderEmailHtml,
  type ConsignmentRow,
  type ProofBlock,
} from "../src/modules/notifications/email-layout.js";

const COMPANY = {
  name: "Delicate Courier",
  legalName: "Delicate Courier (Pty) Ltd",
  address: "14 Camellia Avenue, Lynnwood Ridge, Pretoria, 0081, South Africa",
  email: "accounts@delicatecourier.co.za",
  phone: "0800 000 000",
};
const WEB = "https://delicatecourier.co.za";
const html = (body: string, heading: string | null = "Subject line") =>
  renderEmailHtml({ heading, body, company: COMPANY, webUrl: WEB });

/**
 * The layout turns plain text into a branded email. Everything interesting is in that
 * conversion: a template author writes prose wrapped at column 95 and expects it to read as
 * paragraphs, except where they meant two lines, and expects their closing link to become a
 * button. Those judgements are what these tests pin down.
 */
describe("email layout", () => {
  it("joins lines that were only wrapped, not broken", () => {
    const out = html(`Hi there,

Deliveries are paid from your wallet: top it up, book, and
the amount is held until the parcel is delivered.`);
    expect(out).toContain("book, and the amount is held");
    expect(out).not.toContain("book, and<br />");
  });

  it("keeps a break the author meant", () => {
    // Two facts, not one sentence. Joining these would read as nonsense.
    // Asserted on the markup, because the preheader flattens to a single line on purpose.
    const out = html(`Reason: Damaged in transit
New balance: R 4 750,00`);
    expect(out).toContain("Reason: Damaged in transit<br />New balance: R 4 750,00");
  });

  it("does not join a long reason onto the line after it", () => {
    // The case a length threshold would get wrong: a reason long enough to look wrapped.
    const out = html(`Reason: the parcel was refused at the door and returned to our depot
New balance: R 4 750,00`);
    expect(out).toContain("our depot<br />New balance:");
  });

  it("turns a closing link into a button and stops showing it twice", () => {
    const out = html(`Your parcel is on the way.

Track it: ${WEB}/track?waybill=DCW-1`);
    expect(out).toContain("Track your delivery");
    // Once as the button's href, and not again as prose.
    expect(out).not.toContain("Track it:");
    expect(countOf(out, "DCW-1")).toBe(2); // VML for Outlook plus the anchor
  });

  it("names the button after where it goes", () => {
    expect(html(`Top up.\n\nGo to ${WEB}/portal/wallet`)).toContain("Top up your wallet");
    expect(html(`Invoice ready.\n\nSee ${WEB}/portal/invoices`)).toContain("View your invoice");
    expect(html(`Book one.\n\nStart at ${WEB}/portal/book`)).toContain("Book a delivery");
  });

  it("does not invite another booking from a booking confirmation", () => {
    // /portal/bookings/<id> contains /book, so the order of those checks is load-bearing.
    const out = html(`Confirmed.\n\nTrack it any time at ${WEB}/portal/bookings/abc`);
    expect(out).toContain("View your booking");
    expect(out).not.toContain("Book a delivery");
  });

  it("leaves a link inside a sentence as a link", () => {
    // Not a call to action: a button here would lose the sentence around it.
    const body = `We could not reach you about the delivery scheduled through ${WEB}/portal and have held it at the depot.`;
    const out = html(body);
    expect(out).toContain("have held it at the depot");
    expect(out).toContain(`<a href="${WEB}/portal"`);
  });

  it("escapes anything a customer chose", () => {
    // Account names are customer-supplied and land in the HTML.
    const out = html(`Hi <script>alert(1)</script> & co,`, `Welcome <b>you</b>`);
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&amp; co");
    expect(out).not.toContain("<b>you</b>");
  });

  it("carries the brand, the logo and the company's own details", () => {
    const out = html("Hello.");
    expect(out).toContain(`${WEB}/images/logo.png`);
    expect(out).toContain("#E84A8A");
    expect(out).toContain("Delicate Courier (Pty) Ltd");
    expect(out).toContain("14 Camellia Avenue");
    expect(out).toContain("accounts@delicatecourier.co.za");
  });

  it("gives the client a preheader rather than letting it pick one", () => {
    // Without this the inbox preview shows the logo's alt text.
    const out = html("Your booking DC-1 is confirmed for Thursday.\n\nMore detail follows.");
    expect(out).toContain("Your booking DC-1 is confirmed for Thursday.");
  });

  it("offers support by email and WhatsApp, prefilled with what the mail was about", () => {
    const out = renderEmailHtml({
      heading: "Booking DC-7 confirmed",
      body: "Hello.",
      company: { ...COMPANY, phone: "+27 78 574 6727", waSubject: "Booking DC-7 confirmed" },
      webUrl: WEB,
    });
    expect(out).toContain("https://wa.me/27785746727");
    expect(out).toContain("Booking%20DC-7%20confirmed");
    expect(out).toContain("mailto:accounts@delicatecourier.co.za");
  });

  it("does not link WhatsApp to the placeholder number", () => {
    // company.tax_profile ships with 0800 000 000. A wa.me link to that opens a chat with
    // nobody, which looks more broken than having no link at all.
    const out = renderEmailHtml({
      heading: null,
      body: "Hello.",
      company: { ...COMPANY, phone: "0800 000 000" },
      webUrl: WEB,
    });
    expect(out).not.toContain("wa.me");
    expect(out).toContain("0800 000 000");
  });

  describe("the consignment", () => {
    const parcel = {
      waybill: "DCW-0000412",
      destination: "Centurion",
      recipient: "Jane Dube",
      contents: "1 x Xsmall Cake Box",
      weight: "1.0 kg",
    };
    const withRows = (rows: ConsignmentRow[]) =>
      renderEmailHtml({
        heading: "Booking DC-7 confirmed",
        body: "Your booking is confirmed.",
        company: COMPANY,
        webUrl: WEB,
        consignment: rows,
      });

    it("labels a single parcel instead of putting a header row above it", () => {
      const out = withRows([parcel]);
      expect(out).toContain("Your parcel");
      expect(out).toContain("DCW-0000412");
      expect(out).toContain("1 x Xsmall Cake Box");
      expect(out).toContain("Jane Dube");
      expect(out).toContain("1.0 kg");
      // A five-column header above one row reads worse than labels.
      expect(out).not.toContain(">Waybill</th>");
    });

    it("uses a table once there is more than one", () => {
      const out = withRows([parcel, { ...parcel, waybill: "DCW-0000413", destination: "Menlyn" }]);
      expect(out).toContain("Your parcels (2)");
      expect(out).toContain(">Waybill</th>");
      expect(out).toContain("DCW-0000413");
      expect(out).toContain("Menlyn");
    });

    it("leaves the block out entirely when there is nothing to show", () => {
      expect(withRows([])).not.toContain("Your parcel");
      expect(html("Just words.")).not.toContain("Your parcel");
    });

    it("copes with a parcel we know little about", () => {
      const out = withRows([
        {
          waybill: "DCW-1",
          destination: "Hatfield",
          recipient: null,
          contents: "1 x parcel",
          weight: null,
        },
      ]);
      expect(out).toContain("DCW-1");
      expect(out).not.toContain("Recipient");
      expect(out).not.toContain("Weight");
    });

    it("escapes a recipient name, which is customer-supplied", () => {
      const out = withRows([{ ...parcel, recipient: '<img src=x onerror="alert(1)">' }]);
      expect(out).not.toContain('onerror="alert');
      expect(out).toContain("&lt;img");
    });

    it("says the same thing in the text part", () => {
      const text = consignmentText([parcel]);
      expect(text).toContain("DCW-0000412");
      expect(text).toContain("To: Centurion (Jane Dube)");
      expect(text).toContain("Contents: 1 x Xsmall Cake Box");
      expect(consignmentText([])).toBe("");
      expect(consignmentText(null)).toBe("");
    });
  });

  describe("an auth email Supabase will fill in", () => {
    // These are generated by `supabase:templates` and pasted into a dashboard, so the layout
    // has to carry a placeholder through untouched and let the caller name the button --
    // there is no real URL to read a label off until Supabase substitutes one.
    const CONFIRM = "{{ .ConfirmationURL }}";
    const out = () =>
      renderEmailHtml({
        heading: "Confirm your email",
        body: `Thanks for signing up.

If you did not, ignore this. {{ .NewEmail }}`,
        company: COMPANY,
        webUrl: WEB,
        cta: { label: "Confirm my email", url: CONFIRM },
      });

    it("uses the caller's button instead of guessing from the link", () => {
      expect(out()).toContain("Confirm my email");
      expect(out()).not.toContain("Open your portal");
    });

    it("leaves the placeholders for Supabase to substitute", () => {
      // Escaping must not touch braces or dots, or Supabase sees literal entities.
      expect(out()).toContain(CONFIRM);
      expect(out()).toContain("{{ .NewEmail }}");
      expect(out()).not.toContain("&#123;");
      expect(out()).not.toContain("&quot; .Confirmation");
    });
  });

  describe("proof of delivery", () => {
    const PROOF: ProofBlock = {
      receivedBy: "Jane Mokoena",
      capturedAt: "24 September 2026 at 14:05",
      photoCid: "pod",
      mapUrl: "https://www.google.com/maps/search/?api=1&query=-25.8603,28.1894",
      note: "left at the front desk",
    };
    const out = (proof: ProofBlock | null) =>
      renderEmailHtml({
        heading: "DC-260924-00001 delivered",
        body: "Hi Honey Bee,\n\nIt arrived. The proof is below.",
        company: COMPANY,
        webUrl: WEB,
        proof,
      });

    it("references the photograph as an inline attachment, never a data URI", () => {
      // Gmail and Outlook both strip a data: image, so cid is the only form that renders
      // everywhere; a hosted link would be a new public surface for someone's doorstep.
      expect(out(PROOF)).toContain('src="cid:pod"');
      expect(out(PROOF)).not.toContain("data:image");
    });

    it("links the place rather than embedding a map image", () => {
      const rendered = out(PROOF);
      expect(rendered).toContain("query=-25.8603,28.1894");
      expect(rendered).toContain("See where it was delivered");
      // A static map would be an API call and a quota for every message sent.
      expect(rendered).not.toContain("staticmap");
    });

    it("still says who signed when there is no photo and no location", () => {
      const bare = out({ ...PROOF, photoCid: null, mapUrl: null, note: null });
      expect(bare).toContain("Received by Jane Mokoena");
      expect(bare).not.toContain("cid:");
      expect(bare).not.toContain("See where it was delivered");
    });

    it("escapes what came from a driver's keyboard", () => {
      const nasty = out({ ...PROOF, receivedBy: "<script>alert(1)</script>" });
      expect(nasty).not.toContain("<script>");
      expect(nasty).toContain("&lt;script&gt;");
    });

    it("adds nothing at all without a proof", () => {
      expect(out(null)).not.toContain("Proof of delivery");
      expect(proofText(null)).toBe("");
    });

    it("carries the same facts in the text part", () => {
      const text = proofText(PROOF);
      expect(text).toContain("Received by Jane Mokoena at 24 September 2026 at 14:05.");
      expect(text).toContain("A photograph taken at the door is attached.");
      expect(text).toContain(PROOF.mapUrl!);
      expect(text).toContain("left at the front desk");
    });
  });

  it("renders without a heading", () => {
    const out = html("Just a line.", null);
    expect(out).toContain("Just a line.");
    expect(out).toContain("<body");
  });
});

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
