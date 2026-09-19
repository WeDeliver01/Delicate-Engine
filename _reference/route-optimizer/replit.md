# Delicate Courier — Route Optimizer

## Overview
This project is a last-mile delivery route planning application designed for Delicate Courier, focusing on optimizing delivery routes for a 3-driver fleet in the Pretoria/Tshwane area. It integrates CSV import, advanced route optimization, and comprehensive trip management. The system aims to enhance operational efficiency, reduce costs, and improve delivery timeliness through features like real-time traffic integration, dynamic driver management, historical data archiving, and an intelligent insights engine. The business vision is to provide a robust, scalable solution for dynamic urban delivery challenges, improving service reliability and customer satisfaction, and supporting a companion driver application.

## User Preferences
- Frontend visual quality is paramount
- Dark/light mode support
- Local-first architecture preferred

## System Architecture
The application features a modular architecture with a React + TypeScript frontend (Vite, shadcn/ui) and an Express.js backend providing a REST API. PostgreSQL with Drizzle ORM handles project persistence, supporting a local-first approach with `localStorage` for immediate state persistence and database synchronization for multi-user/device capabilities.

### UI/UX Decisions
The UI emphasizes visual quality with a modern design, using scenic background images with dark overlays, frosted glass styling, and support for both dark and light modes.

### Technical Implementations
- **Dynamic Driver Management**: Allows dispatchers to manage driver profiles, with changes synchronized across devices.
- **Address Autocomplete**: Utilizes Google Places API for accurate address resolution.
- **Traffic Integration**: Integrates with Google Routes API for live traffic data, providing real-time congestion and travel times, supported by a backend proxy with caching.
- **API Cost Optimization**: Implements strategies to minimize Google API costs, including server-side caching, OSRM-first routing with Google fallback, and intelligent polling.
- **Route Optimization**: Employs a simulated annealing algorithm considering time windows, express shipments, driver availability, mid-journey parcel handoffs, and manual re-routing.
- **Data Centre**: Archives detailed trip sheets to PostgreSQL, with search and export capabilities.
- **Insights Engine**: Generates categorized alerts and recommendations based on trip data.
- **Geo Disambiguation**: Resolves duplicate suburb names using postal codes and city information.
- **Vehicle Constraint Rules**: Enforces vehicle-specific rules during route optimization.
- **Client Info**: Displays `clientName` from CSV imports in the UI.
- **Driver App Backend**: A complete REST API (`/api/driver/*`) for a companion driver app, handling JWT authentication, GPS location tracking, trip sheet retrieval, stop action updates, and ETA recalculations. It supports driver-initiated stop reorder requests for dispatcher approval. Driver-app ETAs use Google Routes TRAFFIC_AWARE for the active first leg (driver → next pending stop) with a 45 s in-process cache, and blend the driver's recently-observed GPS speed (rolling 10-min EWMA of moving samples ≥ 3 km/h, clamped to 0.5×–2× the bucket) into `calcDrive` for subsequent legs. Each stop's ETA is the arrival time, not arrival + own service time.
- **CRM Client Care Integration**: Webhooks dispatch shipment status updates from driver stop actions to a CRM, with HMAC-signed payloads and zero Google API cost for ETAs. Includes a Client Care tab in the dispatcher UI for alert management, contact logging, live ETA tracking, and real-time notifications via SSE.
- **Live Driver Position Push (15s)**: A persistent background scheduler in `server/lib/driver-position-pusher.ts` runs every 15 seconds, walks every driver online in the last 10 minutes, computes the next-stop ETA (reusing the driver-app firstLeg cache to avoid extra Google calls; falls back to `calcDrive` blended with the driver's observed GPS speed), and POSTs an HMAC-signed `event: "driver_position"` payload to the configured `crm_webhook_url`. The inbound `/api/webhooks/shipment` handler recognises that event type and refreshes every active CRM alert assigned to the driver — recomputing each alert's per-recipient ETA from the new driver position to the alert's delivery coordinates — then broadcasts an SSE message so Client Care UIs update live. A dispatcher-only `POST /api/dispatch/driver-position-push/trigger` endpoint forces one push cycle for diagnostics, and the scheduler can be paused via the `driver_position_push_enabled` app setting (set to `false`) or the `DRIVER_POSITION_PUSH_DISABLE=1` env var.
- **Vehicle Logs**: Structured driver shift logging — Start Shift gate (odometer + fuel + cluster photo), Stop Evidence on arrive, Log Fuel modal with receipt, End Shift gate. Persisted as `driver_trips` / `driver_trip_stops` / `driver_trip_expenses` with OCR-ready fields. Dispatcher retrieval via `/api/vehicle-logs/trips`. Adopted API field names and a manual verification checklist live in `docs/vehicle-logs.md`. The legacy `driver_stop_events` table is retained read-only for historical audit data only — new arrive/complete/fail/skip actions are no longer double-written; arrivals with evidence live in `driver_trip_stops` and per-stop status lives in the project's `stopStatuses` JSONB.
- **PWA Driver App & Native Shell**: A separate PWA with lazy-loaded pages, JWT authentication, Leaflet-based map, and robust stop action workflow. Includes background location tracking with adaptive sampling and `navigator.sendBeacon` for robust last-position delivery. Features an optional iOS Audio Keep-Alive to prevent Safari from suspending JS timers in the background. The PWA can be wrapped in a Capacitor native iOS/Android shell for enhanced background GPS capabilities.
- **Driver Install Flow**: Dedicated /driver/install page for sideloading the Android APK and joining the iOS TestFlight.
- **Native Diagnostics Panel**: Runtime telemetry (permission status, last-fix, queue depth, battery) visible when running inside the native shell.
- **Driver Location Resilience**: Server-side logic for distinguishing stale-online from fresh-online drivers. Client-side adaptive sampling reduces battery consumption and database writes.
- **Dispatcher Live Map**: An embedded Leaflet map panel in the dispatcher's OpsTab, displaying driver locations, online/offline status, and traffic-aware ETAs to next stops, refreshing every 60 seconds. Offline drivers are shown at their last known position.
- **Dispatcher Authentication**: Session-based authentication using `express-session` with PostgreSQL storage, bcrypt for password hashing, and secure session cookies.
- **Waybill Search**: Allows searching for waybills across tabs for driver assignment management.
- **Road Condition Reporting**: Enables users to submit and manage manual traffic and road condition reports.
- **Saturday Delivery Caps**: Enforces capacity limits for Saturday deliveries per driver.
- **Client Address Book**: A database-driven client directory with CRUD operations.
- **ShipLogic Webhooks**: Receives webhook events from ShipLogic for tracking updates and address changes, with configurable settings and event logging. ShipLogic tracking events are wired into the CRM Client Care alert system, providing real-time updates and enrichment.
- **Webhook Auto-Import**: ShipLogic webhooks automatically create shipments and add them to date-based projects. New shipments are greedily assigned to the nearest active driver. Duplicate waybills update existing shipments. The dispatcher UI receives real-time SSE notifications for new webhook shipments.
- **Outbound Shipment Webhook**: Both ShipLogic status updates and driver stop actions trigger an HMAC-signed outbound webhook to a production URL with standardized payload format.
- **Inbound Shipment Webhook**: Receives the standardized payload, validates HMAC signature, and creates/updates CRM alerts with full enrichment.
- **Click-to-Call Drivers (Twilio VoIP)**: Enables dispatchers to initiate VoIP calls to drivers via Twilio Voice SDK, with call buttons integrated throughout the UI. Graceful fallback to native `tel:` links if Twilio is not configured.
- **Shipments Tab**: A comprehensive shipments table aggregating all shipments across projects. Features search, filter, pagination, and CSV export. Clicking a row opens a detail modal with full shipment data and tracking history.
- **Dispatcher Live Map Modal**: The live driver map renders in a modal dialog.
- **Driver ETA for All Stops**: The driver location endpoint computes and returns ETAs for all remaining pending stops per driver. Results are cached server-side. The Live Driver Map frontend displays a route itinerary side panel with all remaining stops, ETAs, cumulative distance, and traffic indicators.
- **ETA Drift Detection & CRM Notifications**: Automatically creates CRM notifications, broadcasts SSE alerts, and fires outbound CRM webhooks when a driver's ETA shifts significantly or exceeds a time window.
- **Stop Merge & Split**: Dispatchers can combine consecutive collection stops at the same address or split auto-grouped stops, with audit logging and locking for trips.
- **Driver Analytics Dashboard**: Provides per-driver performance analytics with KPIs, trend charts, and a paginated shipment-level table. Backed by normalized tables in PostgreSQL, with optimized aggregations and role-based access control. Includes cache for results (5s TTL when the period contains "now", 5min for closed historical windows) and CSV/XLSX/PDF export capabilities. Includes idempotent backfill and real-time synchronization of analytics data. Vehicle-log data (driver_trips + driver_trip_expenses) is joined via `drivers.driver_account_id` and contributes total distance (odometer-derived), fuel litres, fuel expense, other vehicle expenses, vehicle-expense total, cost-per-km, cost-per-delivery, and litres-per-100km KPIs in addition to a fuel/distance series on the trend chart. Driver shift end and expense logging invalidate the analytics cache so dispatcher views refresh within one polling tick. The dispatcher view auto-refreshes every 5 seconds (paused while the tab is hidden) and exposes a Fleet Leaderboard tab with sortable columns for every KPI plus dedicated CSV/XLSX/PDF exports for the leaderboard.

## Configuration
- **`PUBLIC_APP_URL`** (server) / **`VITE_PUBLIC_APP_URL`** (frontend): canonical base URL used for every public/outbound URL the app emits — Twilio TwiML `voiceUrl`, CRM webhook default (`crm_webhook_url`), and the ShipLogic Delivery URL shown in Settings. Defaults to `https://route.delicatecourier.co.za` when unset, so the live custom domain is always the source of truth regardless of which host the request came in on. On boot, any `crm_webhook_url` still pointing at a `*.replit.app` / `*.replit.dev` host is migrated to the same path on the configured base URL. Internal same-origin `/api/...` fetches remain relative.

## External Dependencies
- **ShipLogic**: Source of CSV import data and webhook events for shipments.
- **Google Places API**: Used for address autocomplete and geocoding.
- **Google Routes API**: Provides real-time traffic data and estimated travel times.
- **Twilio**: Browser-to-phone VoIP calling for dispatchers via Voice SDK.
- **PostgreSQL**: Primary database for persistent storage.
- **Drizzle ORM**: Used for database interactions.