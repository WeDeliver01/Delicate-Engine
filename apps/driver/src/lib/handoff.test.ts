import { describe, expect, it } from "vitest";
import { mailtoUrl, mapsPinUrl, mapsWebUrl, navigationUrl, smsUrl, telUrl } from "./handoff.js";

const MENLYN = { lat: -25.7826, lng: 28.2755, label: "Honey Bee, Menlyn" };

describe("navigationUrl", () => {
  it("starts guidance on Android rather than dropping a pin", () => {
    expect(navigationUrl(MENLYN, "android")).toBe("google.navigation:q=-25.7826,28.2755&mode=d");
  });

  it("uses Apple Maps on iOS, with the place named", () => {
    const url = navigationUrl(MENLYN, "ios");
    expect(url).toContain("maps://?daddr=-25.7826,28.2755");
    expect(url).toContain("dirflg=d");
    expect(url).toContain("q=Honey%20Bee%2C%20Menlyn");
  });

  it("navigates to coordinates, not to the address text", () => {
    // A point we geocoded beats the same words retyped into another search engine; the driver
    // who ends up at the wrong Oak Street has lost twenty minutes.
    const url = navigationUrl({ lat: 1.5, lng: 2.5 }, "android");
    expect(url).toContain("1.5,2.5");
  });

  it("offers a web fallback and a plain pin", () => {
    expect(mapsWebUrl(MENLYN)).toContain("destination=-25.7826,28.2755");
    expect(mapsWebUrl(MENLYN)).toContain("travelmode=driving");
    expect(mapsPinUrl(MENLYN)).toContain("query=-25.7826,28.2755");
  });
});

describe("smsUrl", () => {
  it("separates the body the way each platform expects", () => {
    // Getting this wrong does not fail loudly: the composer opens empty and the driver sends
    // a blank text or gives up.
    expect(smsUrl("082 123 4567", "hi", "ios")).toBe("sms:0821234567&body=hi");
    expect(smsUrl("082 123 4567", "hi", "android")).toBe("sms:0821234567?body=hi");
  });

  it("keeps a leading + and strips everything else from the number", () => {
    expect(smsUrl("+27 (82) 123-4567", "x", "android")).toContain("sms:+27821234567");
  });

  it("escapes a message that would otherwise break the URL", () => {
    const url = smsUrl("0821234567", "10 minutes away & nearly there?", "android");
    expect(url).toContain("10%20minutes%20away%20%26%20nearly%20there%3F");
    expect(url.split("?body=")[1]).not.toContain("&");
  });
});

describe("telUrl", () => {
  it("dials digits only", () => {
    expect(telUrl("082 123 4567")).toBe("tel:0821234567");
    expect(telUrl("+27 82 123 4567")).toBe("tel:+27821234567");
  });
});

describe("mailtoUrl", () => {
  it("escapes the subject and the body", () => {
    const url = mailtoUrl("jane@example.com", "Your delivery & you", "Line one\nLine two");
    expect(url).toContain("mailto:jane@example.com");
    expect(url).toContain("subject=Your%20delivery%20%26%20you");
    expect(url).toContain("body=Line%20one%0ALine%20two");
  });
});
