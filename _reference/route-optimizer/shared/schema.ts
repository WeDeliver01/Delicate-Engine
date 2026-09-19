import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, boolean, jsonb, timestamp, numeric, index, uniqueIndex, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  displayName: text("display_name"),
  email: text("email"),
  role: text("role").notNull().default("dispatcher"),
  avatarColor: text("avatar_color").notNull().default("#4a9eff"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastLoginAt: timestamp("last_login_at"),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const registerUserSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  displayName: z.string().min(1, "Display name is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
});

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).optional(),
  email: z.string().email().optional().or(z.literal("")),
  avatarColor: z.string().optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(6).optional(),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  shipments: jsonb("shipments").notNull().default(sql`'[]'::jsonb`),
  assignments: jsonb("assignments").notNull().default(sql`'{}'::jsonb`),
  tripStatuses: jsonb("trip_statuses").notNull().default(sql`'{}'::jsonb`),
  stopStatuses: jsonb("stop_statuses").notNull().default(sql`'{}'::jsonb`),
  stopNotes: jsonb("stop_notes").notNull().default(sql`'{}'::jsonb`),
  driverStopSequences: jsonb("driver_stop_sequences").notNull().default(sql`'{}'::jsonb`),
  deliveryOverrides: jsonb("delivery_overrides").notNull().default(sql`'{}'::jsonb`),
  collectionOverrides: jsonb("collection_overrides").notNull().default(sql`'{}'::jsonb`),
  stopGroupings: jsonb("stop_groupings").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertProjectSchema = createInsertSchema(projects).pick({
  name: true,
  shipments: true,
  assignments: true,
  tripStatuses: true,
  stopStatuses: true,
  stopNotes: true,
  driverStopSequences: true,
  deliveryOverrides: true,
  collectionOverrides: true,
  stopGroupings: true,
});

// Dispatcher override of a shipment's delivery window. `pinnedTime` (HH:MM)
// pins a target arrival time — the optimizer narrows the window to that
// exact minute and the driver UI shows a pin icon. When `pinnedTime` is set
// `dAfter`/`dBefore` are optional and ignored (the pin overrides both).
export const deliveryOverrideSchema = z.object({
  dAfter: z.string().optional(),
  dBefore: z.string().optional(),
  pinnedTime: z.string().optional(),
  setAt: z.string(),
  setBy: z.string().optional(),
});
export type DeliveryOverride = z.infer<typeof deliveryOverrideSchema>;
export type DeliveryOverrides = Record<string, DeliveryOverride>;

// Symmetric override for a shipment's collection window. Same semantics as
// `deliveryOverrideSchema` but for the collection (pickup) side.
export const collectionOverrideSchema = z.object({
  cAfter: z.string().optional(),
  cBefore: z.string().optional(),
  pinnedTime: z.string().optional(),
  setAt: z.string(),
  setBy: z.string().optional(),
});
export type CollectionOverride = z.infer<typeof collectionOverrideSchema>;
export type CollectionOverrides = Record<string, CollectionOverride>;

// Pinned dispatcher grouping decision: a set of shipment IDs that should be
// served as a single combined stop of the given type. Persisted per driver
// so re-optimize, webhook auto-import, and the driver app all honour the
// dispatcher's manual grouping choices.
export const stopGroupingSchema = z.object({
  ids: z.array(z.string()).min(2),
  type: z.enum(["C", "D"]),
});
export type StopGrouping = z.infer<typeof stopGroupingSchema>;
export type StopGroupings = Record<string, StopGrouping[]>;

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

export const shipmentSchema = z.object({
  id: z.string(),
  wb: z.string(),
  acc: z.string(),
  client: z.string(),
  pcs: z.number(),
  kg: z.number(),
  svc: z.string(),
  rate: z.number(),
  perish: z.boolean(),
  cSub: z.string(),
  cCity: z.string().default(""),
  cPostal: z.string().default(""),
  cAddr: z.string(),
  cAfter: z.string(),
  cBefore: z.string(),
  cLat: z.number(),
  cLng: z.number(),
  cContact: z.string(),
  cPhone: z.string(),
  cEmail: z.string(),
  iCol: z.string(),
  dSub: z.string(),
  dCity: z.string().default(""),
  dPostal: z.string().default(""),
  dAddr: z.string(),
  dAfter: z.string(),
  dBefore: z.string(),
  dLat: z.number(),
  dLng: z.number(),
  dContact: z.string(),
  dPhone: z.string(),
  dEmail: z.string(),
  iDel: z.string(),
  zone: z.string(),
  tags: z.string(),
  trackUrl: z.string(),
  status: z.string(),
  colDate: z.string(),
  delDate: z.string(),
  lDelDate: z.string(),
  created: z.string(),
  preColDriver: z.string(),
  preDelDriver: z.string(),
  parcelType: z.string().default(""),
  parcelCategory: z.string().default(""),
  clientName: z.string().default(""),
  source: z.string().default("csv"),
  origDAfter: z.string().optional(),
  origDBefore: z.string().optional(),
  origCAfter: z.string().optional(),
  origCBefore: z.string().optional(),
  pinnedDelTime: z.string().optional(),
  pinnedColTime: z.string().optional(),
  webhookEvents: z.array(z.object({
    timestamp: z.string(),
    status: z.string(),
    source: z.string().default("shiplogic"),
    message: z.string().default(""),
  })).default([]),
});

export type Shipment = z.infer<typeof shipmentSchema>;

export const driverSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  icon: z.string(),
  vehicle: z.string(),
  plate: z.string(),
  type: z.string(),
  maxParcels: z.number(),
  maxKg: z.number(),
  fuelPer100: z.number(),
  costPerKm: z.number(),
  depotLat: z.number(),
  depotLng: z.number(),
  depot: z.string(),
  shift: z.tuple([z.string(), z.string()]),
  warning: z.string().optional(),
});

export type Driver = z.infer<typeof driverSchema>;

export const stopSchema = z.object({
  seq: z.number(),
  type: z.string(),
  key: z.string(),
  wbs: z.array(z.string()),
  ids: z.array(z.string()),
  sub: z.string(),
  city: z.string().default(""),
  addr: z.string(),
  acc: z.string(),
  pcs: z.number(),
  kg: z.number(),
  win: z.string(),
  eta: z.string(),
  etaM: z.number(),
  legKm: z.number(),
  legMin: z.number(),
  svcMin: z.number(),
  fromLoc: z.string(),
  contact: z.string(),
  phone: z.string(),
  instr: z.string(),
  spx: z.boolean(),
  late: z.boolean(),
  waitMin: z.number().optional(),
  arriveM: z.number().optional(),
  lingerMin: z.number().optional(),
  slack: z.number().optional(),
  deadline: z.string().optional(),
  sid: z.string().optional(),
  lat: z.number(),
  lng: z.number(),
  status: z.string(),
  parcelType: z.string().optional(),
  parcelCategory: z.string().optional(),
  clientName: z.string().optional(),
  trafficMin: z.number().optional(),
  trafficDelayMin: z.number().optional(),
  congestionLevel: z.string().optional(),
  isLiveTraffic: z.boolean().optional(),
  // Atom shipment-id sets behind a dispatcher-grouped stop. Each inner array
  // is one original (pre-group) stop, captured so ungroup can recreate the
  // individual stops without consulting the live shipment list.
  unmergedIds: z.array(z.array(z.string())).optional(),
  // True when this stop was produced by an explicit dispatcher grouping
  // decision (vs. auto-batched by the optimizer). Used by the UI to label
  // the Ungroup affordance and by ETA/CRM paths to skip recomputation.
  grouped: z.boolean().optional(),
  // Dispatcher-overridden window awareness. When `origWin` is set the trip
  // sheet shows "REQ <origWin>" alongside the effective `win`. When
  // `pinnedTime` is set the stop has a pinned target arrival and the UI
  // renders a pin icon.
  origWin: z.string().optional(),
  pinnedTime: z.string().optional(),
});

export type Stop = z.infer<typeof stopSchema>;

export const handoffPointSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
  active: z.boolean(),
  notes: z.string().optional(),
});
export type HandoffPoint = z.infer<typeof handoffPointSchema>;

export const handoffEventSchema = z.object({
  id: z.string(),
  shipmentIds: z.array(z.string()),
  fromDriverId: z.string(),
  toDriverId: z.string(),
  pointId: z.string(),
  plannedMeetStart: z.string(),
  plannedMeetEnd: z.string(),
  status: z.string(),
  fromConfirmed: z.boolean(),
  toConfirmed: z.boolean(),
  completedAt: z.string().optional(),
  notes: z.string().optional(),
});
export type HandoffEvent = z.infer<typeof handoffEventSchema>;

export const tripArchives = pgTable("trip_archives", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  runDate: text("run_date").notNull(),
  shipmentCount: integer("shipment_count").notNull().default(0),
  driverCount: integer("driver_count").notNull().default(0),
  totalKm: numeric("total_km", { precision: 14, scale: 4 }).notNull().default("0"),
  totalRevenue: numeric("total_revenue", { precision: 14, scale: 4 }).notNull().default("0"),
  totalFuelCost: numeric("total_fuel_cost", { precision: 14, scale: 4 }).notNull().default("0"),
  totalMargin: numeric("total_margin", { precision: 14, scale: 4 }).notNull().default("0"),
  totalDeadKm: numeric("total_dead_km", { precision: 14, scale: 4 }).notNull().default("0"),
  warningCount: integer("warning_count").notNull().default(0),
  trafficCondition: text("traffic_condition").notNull().default("normal"),
  shipments: jsonb("shipments").notNull().default(sql`'[]'::jsonb`),
  assignments: jsonb("assignments").notNull().default(sql`'{}'::jsonb`),
  tripSheets: jsonb("trip_sheets").notNull().default(sql`'{}'::jsonb`),
  driverSummaries: jsonb("driver_summaries").notNull().default(sql`'[]'::jsonb`),
  handoffs: jsonb("handoffs").notNull().default(sql`'[]'::jsonb`),
  notes: text("notes").default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertTripArchiveSchema = createInsertSchema(tripArchives).omit({
  id: true,
  createdAt: true,
});

export type InsertTripArchive = z.infer<typeof insertTripArchiveSchema>;
export type TripArchive = typeof tripArchives.$inferSelect;

export const csvImports = pgTable("csv_imports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  importedAt: timestamp("imported_at").defaultNow().notNull(),
  fileName: text("file_name").default(""),
  rowCount: integer("row_count").notNull().default(0),
  newCount: integer("new_count").notNull().default(0),
  updatedCount: integer("updated_count").notNull().default(0),
  matchedCount: integer("matched_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  warnings: jsonb("warnings").notNull().default(sql`'[]'::jsonb`),
  changeLog: jsonb("change_log").notNull().default(sql`'[]'::jsonb`),
  shipmentSnapshot: jsonb("shipment_snapshot").notNull().default(sql`'[]'::jsonb`),
});

export const insertCsvImportSchema = createInsertSchema(csvImports).omit({ id: true, importedAt: true });
export type InsertCsvImport = z.infer<typeof insertCsvImportSchema>;
export type CsvImport = typeof csvImports.$inferSelect;

export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  actorType: text("actor_type").notNull().default("user"),
  previousValue: jsonb("previous_value"),
  newValue: jsonb("new_value"),
  details: text("details").default(""),
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAppSettingSchema = createInsertSchema(appSettings);
export type InsertAppSetting = z.infer<typeof insertAppSettingSchema>;
export type AppSetting = typeof appSettings.$inferSelect;

export const driverAccounts = pgTable("driver_accounts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  driverName: text("driver_name").notNull(),
  phone: text("phone").default(""),
  fleetColor: text("fleet_color").default("#4a9eff"),
  vehiclePlate: text("vehicle_plate").default(""),
  vehicleType: text("vehicle_type").default(""),
  isOnline: boolean("is_online").notNull().default(false),
  onlineSince: timestamp("online_since"),
  opsOnlinePending: boolean("ops_online_pending").notNull().default(false),
  opsOnlineRequestedAt: timestamp("ops_online_requested_at"),
  opsOnlineRequestedBy: text("ops_online_requested_by"),
  currentLat: real("current_lat"),
  currentLng: real("current_lng"),
  currentAccuracy: real("current_accuracy"),
  currentSpeed: real("current_speed"),
  currentHeading: real("current_heading"),
  locationUpdatedAt: timestamp("location_updated_at"),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDriverAccountSchema = createInsertSchema(driverAccounts).pick({
  username: true,
  passwordHash: true,
  driverName: true,
  phone: true,
  isOnline: true,
  currentLat: true,
  currentLng: true,
  currentAccuracy: true,
  currentSpeed: true,
  currentHeading: true,
  locationUpdatedAt: true,
  lastLoginAt: true,
});
export type InsertDriverAccount = z.infer<typeof insertDriverAccountSchema>;
export type DriverAccount = typeof driverAccounts.$inferSelect;

export const driverStopEvents = pgTable("driver_stop_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  driverAccountId: integer("driver_account_id").notNull(),
  projectId: text("project_id").notNull(),
  waybill: text("waybill").notNull(),
  action: text("action").notNull(),
  lat: real("lat"),
  lng: real("lng"),
  notes: text("notes").default(""),
  photoUrl: text("photo_url"),
  recipientName: text("recipient_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDriverStopEventSchema = createInsertSchema(driverStopEvents).pick({
  driverAccountId: true,
  projectId: true,
  waybill: true,
  action: true,
  lat: true,
  lng: true,
  notes: true,
  photoUrl: true,
  recipientName: true,
});
export type InsertDriverStopEvent = z.infer<typeof insertDriverStopEventSchema>;
export type DriverStopEvent = typeof driverStopEvents.$inferSelect;

export const driverLocationHistory = pgTable("driver_location_history", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  driverAccountId: integer("driver_account_id").notNull(),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  accuracy: real("accuracy"),
  speed: real("speed"),
  heading: real("heading"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDriverLocationHistorySchema = createInsertSchema(driverLocationHistory).pick({
  driverAccountId: true,
  lat: true,
  lng: true,
  accuracy: true,
  speed: true,
  heading: true,
});
export type InsertDriverLocationHistory = z.infer<typeof insertDriverLocationHistorySchema>;
export type DriverLocationHistory = typeof driverLocationHistory.$inferSelect;

export const driverPushTokens = pgTable("driver_push_tokens", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  driverAccountId: integer("driver_account_id").notNull(),
  token: text("token").notNull(),
  platform: text("platform").notNull(),
  appVersion: text("app_version").default(""),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  driverTokenUniq: uniqueIndex("driver_push_tokens_driver_token_uniq").on(t.driverAccountId, t.token),
}));

export const insertDriverPushTokenSchema = createInsertSchema(driverPushTokens).pick({
  driverAccountId: true,
  token: true,
  platform: true,
  appVersion: true,
});
export type InsertDriverPushToken = z.infer<typeof insertDriverPushTokenSchema>;
export type DriverPushToken = typeof driverPushTokens.$inferSelect;

export const driverNotifications = pgTable("driver_notifications", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  driverAccountId: integer("driver_account_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull().default(""),
  body: text("body").notNull().default(""),
  data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  driverCreated: index("driver_notifications_driver_created_idx").on(t.driverAccountId, t.createdAt),
}));

export const insertDriverNotificationSchema = createInsertSchema(driverNotifications).pick({
  driverAccountId: true,
  kind: true,
  title: true,
  body: true,
  data: true,
});
export type InsertDriverNotification = z.infer<typeof insertDriverNotificationSchema>;
export type DriverNotification = typeof driverNotifications.$inferSelect;

export const driverReorderRequests = pgTable("driver_reorder_requests", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  driverAccountId: integer("driver_account_id").notNull(),
  driverName: text("driver_name").notNull(),
  projectId: text("project_id").notNull(),
  currentOrder: jsonb("current_order").notNull().default(sql`'[]'::jsonb`),
  proposedOrder: jsonb("proposed_order").notNull().default(sql`'[]'::jsonb`),
  reason: text("reason").default(""),
  status: text("status").notNull().default("pending"),
  reviewedBy: text("reviewed_by"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
});

export const insertDriverReorderRequestSchema = createInsertSchema(driverReorderRequests).pick({
  driverAccountId: true,
  driverName: true,
  projectId: true,
  currentOrder: true,
  proposedOrder: true,
  reason: true,
});
export type InsertDriverReorderRequest = z.infer<typeof insertDriverReorderRequestSchema>;
export type DriverReorderRequest = typeof driverReorderRequests.$inferSelect;

export const clientAccounts = pgTable("client_accounts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  accountCode: text("account_code").notNull().unique(),
  clientName: text("client_name").notNull(),
  address: text("address").default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertClientAccountSchema = createInsertSchema(clientAccounts).pick({
  accountCode: true,
  clientName: true,
  address: true,
});
export type InsertClientAccount = z.infer<typeof insertClientAccountSchema>;
export type ClientAccount = typeof clientAccounts.$inferSelect;

export const webhookEvents = pgTable("webhook_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  topic: text("topic").notNull(),
  waybill: text("waybill").default(""),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  processed: boolean("processed").notNull().default(false),
  error: text("error"),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
});

export const insertWebhookEventSchema = createInsertSchema(webhookEvents).pick({
  topic: true,
  waybill: true,
  payload: true,
  processed: true,
  error: true,
});
export type InsertWebhookEvent = z.infer<typeof insertWebhookEventSchema>;
export type WebhookEvent = typeof webhookEvents.$inferSelect;

export const shipmentAlerts = pgTable("shipment_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  waybill: text("waybill").notNull(),
  recipientName: text("recipient_name").notNull().default(""),
  recipientPhone: text("recipient_phone").notNull().default(""),
  deliveryAddress: text("delivery_address").notNull().default(""),
  driverName: text("driver_name").notNull().default(""),
  driverAccountId: integer("driver_account_id"),
  shipmentStatus: text("shipment_status").notNull().default("collected"),
  etaMinutes: integer("eta_minutes"),
  driverLat: real("driver_lat"),
  driverLng: real("driver_lng"),
  deliveryLat: real("delivery_lat"),
  deliveryLng: real("delivery_lng"),
  contactStatus: text("contact_status").notNull().default("pending-contact"),
  notes: text("notes").default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertShipmentAlertSchema = createInsertSchema(shipmentAlerts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertShipmentAlert = z.infer<typeof insertShipmentAlertSchema>;
export type ShipmentAlert = typeof shipmentAlerts.$inferSelect;

export const recipientContactLogs = pgTable("recipient_contact_logs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  alertId: varchar("alert_id").notNull(),
  contactedBy: text("contacted_by").notNull(),
  contactMethod: text("contact_method").notNull(),
  outcome: text("outcome").notNull(),
  notes: text("notes").default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertRecipientContactLogSchema = createInsertSchema(recipientContactLogs).pick({
  alertId: true,
  contactedBy: true,
  contactMethod: true,
  outcome: true,
  notes: true,
});
export type InsertRecipientContactLog = z.infer<typeof insertRecipientContactLogSchema>;
export type RecipientContactLog = typeof recipientContactLogs.$inferSelect;

export const notifications = pgTable("notifications", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull().default(""),
  targetRole: text("target_role").notNull().default("client_care"),
  alertId: varchar("alert_id"),
  waybill: text("waybill").default(""),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertNotificationSchema = createInsertSchema(notifications).pick({
  type: true,
  title: true,
  message: true,
  targetRole: true,
  alertId: true,
  waybill: true,
});
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

export const driverSummarySchema = z.object({
  driverId: z.string(),
  driverName: z.string(),
  driverColor: z.string(),
  shipmentCount: z.number(),
  stopCount: z.number(),
  totalKm: z.number(),
  deadKm: z.number(),
  revenue: z.number(),
  cogs: z.number().default(0),
  fuelCost: z.number(),
  margin: z.number(),
  fuelLitres: z.number(),
  lateCount: z.number(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});
export type DriverSummary = z.infer<typeof driverSummarySchema>;

export const analyticsDrivers = pgTable("drivers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  employeeNumber: text("employee_number").default(""),
  driverAccountId: integer("driver_account_id"),
  fleetDriverId: text("fleet_driver_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uniqAccount: uniqueIndex("drivers_account_uniq").on(t.driverAccountId),
  uniqFleet: uniqueIndex("drivers_fleet_uniq").on(t.fleetDriverId),
}));

export const insertAnalyticsDriverSchema = createInsertSchema(analyticsDrivers).omit({ id: true, createdAt: true });
export type InsertAnalyticsDriver = z.infer<typeof insertAnalyticsDriverSchema>;
export type AnalyticsDriver = typeof analyticsDrivers.$inferSelect;

export const shipmentsAnalytics = pgTable("shipments_analytics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  driverId: varchar("driver_id").notNull(),
  waybill: text("waybill").notNull(),
  deliveryDate: timestamp("delivery_date", { withTimezone: true }).notNull(),
  revenue: numeric("revenue", { precision: 14, scale: 4 }).notNull().default("0"),
  cogs: numeric("cogs", { precision: 14, scale: 4 }),
  currency: text("currency").notNull().default("USD"),
  fxRateToBase: numeric("fx_rate_to_base", { precision: 14, scale: 6 }).notNull().default("1"),
  status: text("status").notNull().default("delivered"),
  routeId: text("route_id"),
  sourceProjectId: text("source_project_id"),
  sourceArchiveId: text("source_archive_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  driverDate: index("shipments_analytics_driver_date_idx").on(t.driverId, t.deliveryDate),
  uniqWb: uniqueIndex("shipments_analytics_wb_uniq").on(t.waybill, t.driverId, t.deliveryDate),
}));

export const insertShipmentAnalyticsSchema = createInsertSchema(shipmentsAnalytics).omit({ id: true, createdAt: true });
export type InsertShipmentAnalytics = z.infer<typeof insertShipmentAnalyticsSchema>;
export type ShipmentAnalytics = typeof shipmentsAnalytics.$inferSelect;

export const expenses = pgTable("expenses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  driverId: varchar("driver_id").notNull(),
  shipmentId: varchar("shipment_id"),
  expenseType: text("expense_type").notNull().default("fuel"),
  amount: numeric("amount", { precision: 14, scale: 4 }).notNull().default("0"),
  currency: text("currency").notNull().default("USD"),
  fxRateToBase: numeric("fx_rate_to_base", { precision: 14, scale: 6 }).notNull().default("1"),
  incurredAt: timestamp("incurred_at", { withTimezone: true }).notNull(),
  notes: text("notes").default(""),
  sourceArchiveId: text("source_archive_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  driverDate: index("expenses_driver_date_idx").on(t.driverId, t.incurredAt),
}));

export const insertExpenseSchema = createInsertSchema(expenses).omit({ id: true, createdAt: true });
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expenses.$inferSelect;

export const driverTrips = pgTable("driver_trips", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  driverAccountId: integer("driver_account_id").notNull(),
  vehiclePlate: text("vehicle_plate").default(""),
  vehicleType: text("vehicle_type").default(""),
  projectId: text("project_id"),
  startTime: timestamp("start_time").defaultNow().notNull(),
  endTime: timestamp("end_time"),
  startOdometer: numeric("start_odometer", { precision: 12, scale: 2 }).notNull().default("0"),
  endOdometer: numeric("end_odometer", { precision: 12, scale: 2 }),
  startFuelLevel: text("start_fuel_level").notNull().default(""),
  endFuelLevel: text("end_fuel_level"),
  startClusterPhoto: text("start_cluster_photo"),
  endClusterPhoto: text("end_cluster_photo"),
  startLat: real("start_lat"),
  startLng: real("start_lng"),
  endLat: real("end_lat"),
  endLng: real("end_lng"),
  status: text("status").notNull().default("active"),
  notes: text("notes").default(""),
  startOdometerOcr: text("start_odometer_ocr"),
  endOdometerOcr: text("end_odometer_ocr"),
  ocrRawText: text("ocr_raw_text"),
  ocrError: text("ocr_error"),
  ocrProcessedAt: timestamp("ocr_processed_at"),
}, (t) => ({
  driverStart: index("driver_trips_driver_start_idx").on(t.driverAccountId, t.startTime),
}));

export const insertDriverTripSchema = createInsertSchema(driverTrips).pick({
  driverAccountId: true,
  vehiclePlate: true,
  vehicleType: true,
  projectId: true,
  startTime: true,
  startOdometer: true,
  startFuelLevel: true,
  startClusterPhoto: true,
  startLat: true,
  startLng: true,
  status: true,
  notes: true,
});
export type InsertDriverTrip = typeof driverTrips.$inferInsert;
export type DriverTrip = typeof driverTrips.$inferSelect;

export const driverTripStops = pgTable("driver_trip_stops", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  tripId: integer("trip_id").notNull(),
  driverAccountId: integer("driver_account_id"),
  vehiclePlate: text("vehicle_plate").default(""),
  stopKey: text("stop_key").notNull(),
  waybill: text("waybill").default(""),
  stopType: text("stop_type").notNull().default("delivery"),
  arrivedAt: timestamp("arrived_at").defaultNow().notNull(),
  lat: real("lat"),
  lng: real("lng"),
  photoUrl: text("photo_url"),
  notes: text("notes").default(""),
  ocrText: text("ocr_text"),
  ocrProcessedAt: timestamp("ocr_processed_at"),
}, (t) => ({
  tripIdx: index("driver_trip_stops_trip_idx").on(t.tripId),
}));

export const insertDriverTripStopSchema = createInsertSchema(driverTripStops).pick({
  tripId: true,
  driverAccountId: true,
  vehiclePlate: true,
  stopKey: true,
  waybill: true,
  stopType: true,
  lat: true,
  lng: true,
  photoUrl: true,
  notes: true,
});
export type InsertDriverTripStop = typeof driverTripStops.$inferInsert;
export type DriverTripStop = typeof driverTripStops.$inferSelect;

export const driverTripExpenses = pgTable("driver_trip_expenses", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  tripId: integer("trip_id").notNull(),
  driverAccountId: integer("driver_account_id"),
  vehiclePlate: text("vehicle_plate").default(""),
  expenseType: text("expense_type").notNull().default("fuel"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  litres: numeric("litres", { precision: 10, scale: 2 }),
  receiptUrl: text("receipt_url"),
  incurredAt: timestamp("incurred_at").defaultNow().notNull(),
  lat: real("lat"),
  lng: real("lng"),
  notes: text("notes").default(""),
  ocrText: text("ocr_text"),
  ocrAmount: numeric("ocr_amount", { precision: 12, scale: 2 }),
  ocrLitres: numeric("ocr_litres", { precision: 10, scale: 2 }),
  ocrStation: text("ocr_station"),
  ocrDate: text("ocr_date"),
  ocrError: text("ocr_error"),
  ocrProcessedAt: timestamp("ocr_processed_at"),
}, (t) => ({
  tripIdx: index("driver_trip_expenses_trip_idx").on(t.tripId),
}));

export const insertDriverTripExpenseSchema = createInsertSchema(driverTripExpenses).pick({
  tripId: true,
  driverAccountId: true,
  vehiclePlate: true,
  expenseType: true,
  amount: true,
  litres: true,
  receiptUrl: true,
  lat: true,
  lng: true,
  notes: true,
});
export type InsertDriverTripExpense = typeof driverTripExpenses.$inferInsert;
export type DriverTripExpense = typeof driverTripExpenses.$inferSelect;
