const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const OUT = path.join(process.cwd(), "exports", "DelicateCourier-RouteOptimizer-Overview.pdf");
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const COLORS = {
  ink: "#1a1d24",
  sub: "#5b6472",
  brand: "#e8590c",
  brandSoft: "#fff1e8",
  line: "#e3e6ea",
  panel: "#f6f7f9",
  accent: "#0b7285",
  white: "#ffffff",
};

const doc = new PDFDocument({
  size: "A4",
  margins: { top: 64, bottom: 64, left: 56, right: 56 },
  bufferPages: true,
  info: {
    Title: "Delicate Courier — Route Optimizer: Build Overview",
    Author: "Delicate Courier",
    Subject: "Capabilities & Technical Stack Overview",
  },
});

doc.pipe(fs.createWriteStream(OUT));

const PAGE_W = doc.page.width;
const PAGE_H = doc.page.height;
const ML = doc.page.margins.left;
const MR = doc.page.margins.right;
const CONTENT_W = PAGE_W - ML - MR;

function ensureSpace(h) {
  if (doc.y + h > PAGE_H - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function sectionHeading(num, title) {
  ensureSpace(54);
  doc.moveDown(0.6);
  const y = doc.y;
  doc.save();
  doc.roundedRect(ML, y, 26, 26, 6).fill(COLORS.brand);
  doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(13).text(String(num), ML, y + 6, {
    width: 26,
    align: "center",
  });
  doc.restore();
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(16).text(title, ML + 38, y + 4);
  doc.moveTo(ML, y + 32).lineTo(ML + CONTENT_W, y + 32).lineWidth(1).strokeColor(COLORS.line).stroke();
  doc.y = y + 44;
  doc.fillColor(COLORS.ink);
}

function subHeading(title) {
  ensureSpace(28);
  doc.moveDown(0.4);
  doc.fillColor(COLORS.accent).font("Helvetica-Bold").fontSize(11.5).text(title);
  doc.moveDown(0.2);
  doc.fillColor(COLORS.ink);
}

function bullet(label, desc) {
  ensureSpace(20);
  const startY = doc.y;
  doc.save();
  doc.circle(ML + 3, startY + 6, 2.2).fill(COLORS.brand);
  doc.restore();
  doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.ink);
  const labelText = label ? `${label}` : "";
  if (desc) {
    doc.text(labelText + "  ", ML + 14, startY, { continued: true, width: CONTENT_W - 14 });
    doc.font("Helvetica").fillColor(COLORS.sub).text(desc, { width: CONTENT_W - 14 });
  } else {
    doc.font("Helvetica").fillColor(COLORS.sub).text(labelText, ML + 14, startY, { width: CONTENT_W - 14 });
  }
  doc.moveDown(0.35);
  doc.fillColor(COLORS.ink);
}

function paragraph(text) {
  ensureSpace(24);
  doc.font("Helvetica").fontSize(10).fillColor(COLORS.sub).text(text, ML, doc.y, {
    width: CONTENT_W,
    align: "left",
    lineGap: 2,
  });
  doc.moveDown(0.5);
  doc.fillColor(COLORS.ink);
}

function pill(text, x, y) {
  doc.font("Helvetica-Bold").fontSize(8.5);
  const w = doc.widthOfString(text) + 16;
  doc.roundedRect(x, y, w, 18, 9).fill(COLORS.brandSoft);
  doc.fillColor(COLORS.brand).text(text, x + 8, y + 4.5);
  doc.fillColor(COLORS.ink);
  return w;
}

function pillRow(items) {
  let x = ML;
  let y = doc.y;
  const gap = 6;
  for (const it of items) {
    doc.font("Helvetica-Bold").fontSize(8.5);
    const w = doc.widthOfString(it) + 16;
    if (x + w > ML + CONTENT_W) {
      x = ML;
      y += 24;
    }
    pill(it, x, y);
    x += w + gap;
  }
  doc.y = y + 28;
}

// ---------- COVER ----------
doc.save();
doc.rect(0, 0, PAGE_W, PAGE_H).fill("#11151c");
doc.rect(0, 0, PAGE_W, 8).fill(COLORS.brand);
doc.restore();

doc.fillColor("#ff922b").font("Helvetica-Bold").fontSize(13).text("DELICATE COURIER", ML, 150, {
  characterSpacing: 3,
});
doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(40).text("Route Optimizer", ML, 178, {
  width: CONTENT_W,
});
doc.fillColor("#c2c8d0").font("Helvetica").fontSize(15).text(
  "Last-Mile Delivery Planning & Live Dispatch Platform",
  ML,
  236,
  { width: CONTENT_W }
);

doc.moveTo(ML, 286).lineTo(ML + 80, 286).lineWidth(3).strokeColor(COLORS.brand).stroke();

doc.fillColor("#9aa3af").font("Helvetica").fontSize(11).text(
  "A comprehensive build overview covering operational capabilities, the driver companion app, real-time integrations, and the full technical stack.",
  ML,
  308,
  { width: CONTENT_W - 60, lineGap: 4 }
);

const today = new Date().toLocaleDateString("en-ZA", { year: "numeric", month: "long", day: "numeric" });
doc.fillColor("#6b7280").font("Helvetica").fontSize(9.5).text(`Generated ${today}`, ML, PAGE_H - 90);
doc.fillColor("#6b7280").text("Pretoria / Tshwane · 3-driver fleet operations", ML, PAGE_H - 74);

// ---------- BODY ----------
doc.addPage();

sectionHeading(1, "What This Build Is");
paragraph(
  "Delicate Courier's Route Optimizer is a last-mile delivery planning and live dispatch platform built for a 3-driver fleet operating across the Pretoria / Tshwane area. It takes raw shipment data, optimizes it into efficient driver routes, and then tracks those routes live as drivers execute them in the field."
);
paragraph(
  "The platform spans two connected experiences: a dispatcher web console for planning, monitoring, and customer care, and a companion driver app (installable PWA with an optional native iOS/Android shell) that drivers use on the road. The two halves stay in sync in real time, so a dispatcher always sees where every driver is and what their updated arrival times are."
);

sectionHeading(2, "Core Capabilities");

subHeading("Shipment Intake & Import");
bullet("CSV & Excel import:", "Drag-and-drop ShipLogic CSV files or Excel (.xlsx) workbooks, with automatic delimiter detection (comma, semicolon, tab, pipe) and a live preview before committing.");
bullet("Webhook auto-import:", "ShipLogic webhooks automatically create shipments, add them to date-based projects, and greedily assign each one to the nearest active driver. Duplicate waybills update the existing shipment.");
bullet("Address resolution:", "Google Places autocomplete and geocoding, plus geo-disambiguation that resolves duplicate suburb names using postal codes and city information.");

subHeading("Route Optimization");
bullet("Simulated annealing optimizer:", "Considers delivery time windows, express shipments, driver availability, mid-journey parcel handoffs, and manual re-routing.");
bullet("Vehicle constraint rules:", "Enforces vehicle-specific limits during optimization, including Saturday delivery capacity caps per driver.");
bullet("Stop merge & split:", "Combine consecutive collection stops at the same address, or split auto-grouped stops, with audit logging and trip locking.");

subHeading("Live Dispatch & Tracking");
bullet("Dispatcher live map:", "An embedded Leaflet map showing driver locations, online/offline status, and traffic-aware ETAs to the next stop. Offline drivers appear at their last known position.");
bullet("Live position push (every 15s):", "A background scheduler walks every recently-online driver, computes the next-stop ETA, and pushes signed position updates so customer-facing ETAs stay current.");
bullet("Live ETAs for all stops:", "ETAs are computed for every remaining pending stop per driver, with a route itinerary side panel showing cumulative distance and traffic indicators.");
bullet("ETA drift detection:", "When a driver's ETA shifts significantly or a time window is at risk, the system raises CRM notifications and fires outbound alerts automatically.");

subHeading("Driver Companion App");
bullet("Installable PWA + native shell:", "Lazy-loaded pages, JWT authentication, a Leaflet map, and a robust stop-action workflow (arrive, complete, fail, skip). Can be wrapped in a Capacitor native iOS/Android shell for stronger background GPS.");
bullet("Background location tracking:", "Adaptive GPS sampling to conserve battery, with sendBeacon for reliable last-position delivery and an optional iOS audio keep-alive.");
bullet("Vehicle logs / shift workflow:", "Structured shift logging — start-shift gate (odometer, fuel, cluster photo), per-stop arrival evidence, fuel logging with receipts, and an end-shift gate.");
bullet("Driver install flow & diagnostics:", "A dedicated install page for the Android APK and iOS TestFlight, plus a native diagnostics panel showing permissions, last fix, queue depth, and battery.");

subHeading("Customer Care & CRM");
bullet("Client Care tab:", "Alert management, contact logging, live ETA tracking, and real-time notifications via server-sent events (SSE).");
bullet("CRM webhooks:", "HMAC-signed shipment status updates dispatched from driver stop actions, with ETAs computed at zero Google API cost.");
bullet("Click-to-call drivers:", "Dispatchers place VoIP calls to drivers via the Twilio Voice SDK, with graceful fallback to native phone links.");

subHeading("Analytics & Data");
bullet("Driver analytics dashboard:", "Per-driver KPIs, trend charts, and a paginated shipment-level table, with a Fleet Leaderboard and CSV / XLSX / PDF exports.");
bullet("Vehicle-cost KPIs:", "Fuel litres, fuel and vehicle expense, cost-per-km, cost-per-delivery, and litres-per-100km, derived from shift and expense logs.");
bullet("Data centre:", "Detailed trip sheets archived to PostgreSQL with search and export.");
bullet("Insights engine:", "Categorized alerts and recommendations generated from trip data.");

subHeading("Operations Support");
bullet("Dynamic driver management:", "Dispatchers manage driver profiles with changes synced across devices.");
bullet("Road condition reporting:", "Submit and manage manual traffic and road-condition reports.");
bullet("Client address book:", "A database-driven client directory with full CRUD.");
bullet("Shipments tab:", "An aggregated table across all projects with search, filter, pagination, CSV export, and a detail modal with tracking history.");
bullet("Waybill search & secure access:", "Cross-tab waybill search, plus session-based dispatcher authentication with bcrypt-hashed passwords.");

sectionHeading(3, "How a Shipment Flows Through the System");
paragraph("1.  Shipments arrive via CSV/Excel upload or an automatic ShipLogic webhook.");
paragraph("2.  Addresses are geocoded and disambiguated, then bundled into a date-based project.");
paragraph("3.  The optimizer sequences stops across the fleet, respecting time windows, vehicle rules, and capacity caps.");
paragraph("4.  Drivers receive their trip sheets in the companion app and begin their shift (odometer + fuel + photo).");
paragraph("5.  As drivers move, live GPS drives traffic-aware ETAs; dispatchers monitor the live map and Client Care tab.");
paragraph("6.  Stop actions push signed status + ETA updates to the CRM, keeping customers informed at near-zero API cost.");
paragraph("7.  Completed trips are archived; analytics and cost KPIs update for dispatcher review and export.");

sectionHeading(4, "Technical Stack");

subHeading("Frontend");
pillRow(["React", "TypeScript", "Vite", "shadcn/ui", "Tailwind CSS", "wouter", "TanStack Query", "Leaflet", "PWA", "Capacitor"]);
bullet("Architecture:", "Local-first — localStorage for immediate state persistence, synced to the database for multi-user / multi-device use. Dark and light mode throughout, with a strong emphasis on visual quality.");

subHeading("Backend");
pillRow(["Node.js", "Express.js", "REST API", "Server-Sent Events", "express-session", "JWT", "bcrypt", "HMAC signing"]);
bullet("Design:", "A thin REST API focused on persistence and external API calls, with a dedicated /api/driver/* surface for the companion app and signed inbound/outbound webhooks.");

subHeading("Data");
pillRow(["PostgreSQL", "Drizzle ORM", "drizzle-zod", "Zod validation"]);
bullet("Persistence:", "PostgreSQL via Drizzle ORM, with normalized tables for trips, stops, expenses, and analytics, and JSONB for per-stop status.");

subHeading("External Integrations");
pillRow(["Google Routes API", "Google Places API", "ShipLogic", "Twilio Voice", "exceljs", "pdfkit"]);
bullet("Cost optimization:", "Server-side caching, OSRM-first routing with Google fallback, traffic-aware Google calls limited to the active first leg (45s cache), and intelligent polling keep external API spend low.");

subHeading("Deployment & Configuration");
bullet("Hosting:", "Runs on Replit with a single Express + Vite dev workflow; published to a custom domain (route.delicatecourier.co.za).");
bullet("Canonical URLs:", "A configurable public base URL drives every outbound URL (Twilio voice callbacks, CRM webhooks, ShipLogic delivery links), so the live domain is always the source of truth.");

doc.moveDown(1);
ensureSpace(60);
doc.save();
doc.roundedRect(ML, doc.y, CONTENT_W, 48, 8).fill(COLORS.panel);
doc.fillColor(COLORS.sub).font("Helvetica-Oblique").fontSize(9.5).text(
  "This overview reflects the current build of the Delicate Courier Route Optimizer. Capabilities continue to evolve; refer to the in-app project documentation for the latest detail.",
  ML + 14,
  doc.y + 12,
  { width: CONTENT_W - 28, lineGap: 2 }
);
doc.restore();

// ---------- FOOTERS ----------
const range = doc.bufferedPageRange();
for (let i = 1; i < range.count; i++) {
  doc.switchToPage(i);
  doc.save();
  doc.moveTo(ML, PAGE_H - 44).lineTo(ML + CONTENT_W, PAGE_H - 44).lineWidth(0.5).strokeColor(COLORS.line).stroke();
  doc.fillColor(COLORS.sub).font("Helvetica").fontSize(8).text(
    "Delicate Courier — Route Optimizer",
    ML,
    PAGE_H - 38,
    { width: CONTENT_W / 2, align: "left" }
  );
  doc.fillColor(COLORS.sub).font("Helvetica").fontSize(8).text(
    `Page ${i} of ${range.count - 1}`,
    ML + CONTENT_W / 2,
    PAGE_H - 38,
    { width: CONTENT_W / 2, align: "right" }
  );
  doc.restore();
}

doc.end();
console.log("PDF written to", OUT);
