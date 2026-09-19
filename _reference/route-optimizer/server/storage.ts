import {
  type User, type InsertUser,
  type Project, type InsertProject,
  type TripArchive, type InsertTripArchive,
  type CsvImport, type InsertCsvImport,
  type AuditLog, type InsertAuditLog,
  type AppSetting,
  type DriverAccount, type InsertDriverAccount,
  type DriverStopEvent, type InsertDriverStopEvent,
  type DriverLocationHistory, type InsertDriverLocationHistory,
  type DriverPushToken, type InsertDriverPushToken,
  type DriverNotification, type InsertDriverNotification,
  type DriverReorderRequest, type InsertDriverReorderRequest,
  type ClientAccount, type InsertClientAccount,
  type WebhookEvent, type InsertWebhookEvent,
  type ShipmentAlert, type InsertShipmentAlert,
  type RecipientContactLog, type InsertRecipientContactLog,
  type Notification, type InsertNotification,
  type DriverTrip, type InsertDriverTrip,
  type DriverTripStop, type InsertDriverTripStop,
  type DriverTripExpense, type InsertDriverTripExpense,
  users, projects, tripArchives, csvImports, auditLogs, appSettings,
  driverAccounts, driverStopEvents, driverLocationHistory, driverPushTokens, driverNotifications, driverReorderRequests,
  clientAccounts, webhookEvents,
  shipmentAlerts, recipientContactLogs, notifications,
  driverTrips, driverTripStops, driverTripExpenses
} from "@shared/schema";
import { db } from "./db";
import { eq, ne, desc, ilike, sql, and, gt, lt, inArray, isNull, type SQL } from "drizzle-orm";

export type DriverAccountUpdate = Partial<{
  username: string;
  passwordHash: string;
  driverName: string;
  phone: string | null;
  fleetColor: string | null;
  vehiclePlate: string | null;
  vehicleType: string | null;
  isOnline: boolean;
  onlineSince: Date | null;
  opsOnlinePending: boolean;
  opsOnlineRequestedAt: Date | null;
  opsOnlineRequestedBy: string | null;
  currentLat: number | null;
  currentLng: number | null;
  currentAccuracy: number | null;
  currentSpeed: number | null;
  currentHeading: number | null;
  locationUpdatedAt: Date | null;
  lastLoginAt: Date | null;
}>;

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, data: Partial<Pick<User, "displayName" | "email" | "avatarColor" | "password" | "lastLoginAt">>): Promise<User | undefined>;
  updateUserRole(id: string, role: string): Promise<User | undefined>;
  listUsers(): Promise<User[]>;
  getProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  getProjectByName(name: string): Promise<Project | undefined>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: string, project: Partial<InsertProject>): Promise<Project | undefined>;
  deleteProject(id: string): Promise<void>;
  listArchives(search?: string): Promise<TripArchive[]>;
  getArchive(id: string): Promise<TripArchive | undefined>;
  createArchive(archive: InsertTripArchive): Promise<TripArchive>;
  deleteArchive(id: string): Promise<void>;
  listCsvImports(limit?: number): Promise<CsvImport[]>;
  getCsvImport(id: string): Promise<CsvImport | undefined>;
  createCsvImport(record: InsertCsvImport): Promise<CsvImport>;
  listAuditLogs(entityId?: string, limit?: number): Promise<AuditLog[]>;
  createAuditLog(entry: InsertAuditLog): Promise<AuditLog>;
  getAppSetting(key: string): Promise<AppSetting | undefined>;
  upsertAppSetting(key: string, value: unknown): Promise<AppSetting>;
  getDriverAccountByUsername(username: string): Promise<DriverAccount | undefined>;
  getDriverAccount(id: number): Promise<DriverAccount | undefined>;
  createDriverAccount(account: InsertDriverAccount): Promise<DriverAccount>;
  updateDriverAccount(id: number, data: DriverAccountUpdate): Promise<DriverAccount | undefined>;
  getOnlineDrivers(sinceMinutes?: number): Promise<DriverAccount[]>;
  getAllDriverAccounts(): Promise<DriverAccount[]>;
  setDriverOffline(id: number): Promise<void>;
  setDriverOnline(id: number): Promise<DriverAccount | undefined>;
  requestDriverOnline(id: number, requestedBy: string): Promise<DriverAccount | undefined>;
  clearOpsOnlineRequest(id: number): Promise<void>;
  autoOfflineStaleDrivers(staleMinutes?: number): Promise<number>;
  deleteDriverAccount(id: number): Promise<void>;
  createStopEvent(event: InsertDriverStopEvent): Promise<DriverStopEvent>;
  getStopEvents(driverAccountId: number, projectId: string): Promise<DriverStopEvent[]>;
  createLocationHistory(entry: InsertDriverLocationHistory): Promise<DriverLocationHistory>;
  cleanupOldLocationHistory(daysOld?: number): Promise<number>;
  upsertDriverPushToken(token: InsertDriverPushToken): Promise<DriverPushToken>;
  removeDriverPushToken(driverAccountId: number, token: string): Promise<void>;
  removeDriverPushTokensByValue(token: string): Promise<void>;
  listDriverPushTokens(driverAccountId: number): Promise<DriverPushToken[]>;
  createDriverNotification(notification: InsertDriverNotification): Promise<DriverNotification>;
  listDriverNotifications(driverAccountId: number, limit?: number): Promise<DriverNotification[]>;
  getDriverUnreadNotificationCount(driverAccountId: number): Promise<number>;
  markDriverNotificationRead(id: number, driverAccountId: number): Promise<DriverNotification | undefined>;
  markAllDriverNotificationsRead(driverAccountId: number): Promise<void>;
  pruneOldDriverNotifications(daysOld?: number): Promise<number>;
  getDriverAccountByName(driverName: string): Promise<DriverAccount | undefined>;
  createReorderRequest(req: InsertDriverReorderRequest): Promise<DriverReorderRequest>;
  getReorderRequest(id: number): Promise<DriverReorderRequest | undefined>;
  getPendingReorderRequests(projectId?: string): Promise<DriverReorderRequest[]>;
  getDriverPendingReorder(driverAccountId: number, projectId: string): Promise<DriverReorderRequest | undefined>;
  getDriverLatestReorder(driverAccountId: number, projectId: string): Promise<DriverReorderRequest | undefined>;
  getRecentReorderRequests(projectId?: string, limit?: number): Promise<DriverReorderRequest[]>;
  updateReorderRequestStatus(id: number, status: string, reviewedBy: string, reviewNote?: string): Promise<DriverReorderRequest | undefined>;
  listClientAccounts(): Promise<ClientAccount[]>;
  getClientAccountByCode(accountCode: string): Promise<ClientAccount | undefined>;
  createClientAccount(account: InsertClientAccount): Promise<ClientAccount>;
  updateClientAccount(id: number, data: Partial<Pick<ClientAccount, "clientName" | "address" | "accountCode">>): Promise<ClientAccount | undefined>;
  deleteClientAccount(id: number): Promise<void>;
  createWebhookEvent(event: InsertWebhookEvent): Promise<WebhookEvent>;
  listWebhookEvents(limit?: number): Promise<WebhookEvent[]>;
  createShipmentAlert(alert: InsertShipmentAlert): Promise<ShipmentAlert>;
  getShipmentAlert(id: string): Promise<ShipmentAlert | undefined>;
  listShipmentAlerts(contactStatus?: string, limit?: number): Promise<ShipmentAlert[]>;
  updateShipmentAlert(id: string, data: Partial<Pick<ShipmentAlert, "contactStatus" | "shipmentStatus" | "etaMinutes" | "driverLat" | "driverLng" | "notes" | "recipientName" | "recipientPhone" | "deliveryAddress" | "driverName" | "driverAccountId" | "deliveryLat" | "deliveryLng">>): Promise<ShipmentAlert | undefined>;
  getActiveAlertByWaybill(waybill: string): Promise<ShipmentAlert | undefined>;
  getLatestAlertByWaybill(waybill: string): Promise<ShipmentAlert | undefined>;
  deleteShipmentAlert(id: string): Promise<boolean>;
  createContactLog(log: InsertRecipientContactLog): Promise<RecipientContactLog>;
  getContactLogsByAlert(alertId: string): Promise<RecipientContactLog[]>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  getUnreadCount(targetRole?: string): Promise<number>;
  markNotificationRead(id: number): Promise<void>;
  markAllNotificationsRead(targetRole?: string): Promise<void>;
  listNotifications(limit?: number, targetRole?: string): Promise<Notification[]>;
  listNotificationsByWaybill(waybill: string): Promise<Notification[]>;
  createDriverTrip(trip: InsertDriverTrip): Promise<DriverTrip>;
  getActiveDriverTrip(driverAccountId: number): Promise<DriverTrip | undefined>;
  getDriverTrip(id: number): Promise<DriverTrip | undefined>;
  closeDriverTrip(id: number, data: {
    endTime: Date;
    endOdometer: string;
    endFuelLevel: string;
    endClusterPhoto?: string | null;
    endLat?: number | null;
    endLng?: number | null;
    notes?: string;
  }): Promise<DriverTrip | undefined>;
  listDriverTrips(opts?: { driverAccountId?: number; limit?: number; status?: string; from?: Date; to?: Date }): Promise<DriverTrip[]>;
  createDriverTripStop(stop: InsertDriverTripStop): Promise<DriverTripStop>;
  listDriverTripStops(tripId: number): Promise<DriverTripStop[]>;
  listDriverTripStopsBatch(tripIds: number[]): Promise<DriverTripStop[]>;
  createDriverTripExpense(expense: InsertDriverTripExpense): Promise<DriverTripExpense>;
  listDriverTripExpenses(tripId: number): Promise<DriverTripExpense[]>;
  listDriverTripExpensesBatch(tripIds: number[]): Promise<DriverTripExpense[]>;
  getTripDetail(id: number): Promise<{ trip: DriverTrip; stops: DriverTripStop[]; expenses: DriverTripExpense[] } | undefined>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(id: string, data: Partial<Pick<User, "displayName" | "email" | "avatarColor" | "password" | "lastLoginAt">>): Promise<User | undefined> {
    const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return updated || undefined;
  }

  async updateUserRole(id: string, role: string): Promise<User | undefined> {
    const [updated] = await db.update(users).set({ role }).where(eq(users.id, id)).returning();
    return updated || undefined;
  }

  async listUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  async getProjects(): Promise<Project[]> {
    return db.select().from(projects);
  }

  async getProject(id: string): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project || undefined;
  }

  async getProjectByName(name: string): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.name, name));
    return project || undefined;
  }

  async createProject(project: InsertProject): Promise<Project> {
    const [created] = await db.insert(projects).values(project).returning();
    return created;
  }

  async updateProject(id: string, project: Partial<InsertProject>): Promise<Project | undefined> {
    const [updated] = await db
      .update(projects)
      .set({ ...project, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteProject(id: string): Promise<void> {
    await db.delete(projects).where(eq(projects.id, id));
  }

  async listArchives(search?: string): Promise<TripArchive[]> {
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      return db.select().from(tripArchives)
        .where(ilike(tripArchives.name, term))
        .orderBy(desc(tripArchives.createdAt));
    }
    return db.select().from(tripArchives).orderBy(desc(tripArchives.createdAt));
  }

  async getArchive(id: string): Promise<TripArchive | undefined> {
    const [archive] = await db.select().from(tripArchives).where(eq(tripArchives.id, id));
    return archive || undefined;
  }

  async createArchive(archive: InsertTripArchive): Promise<TripArchive> {
    const [created] = await db.insert(tripArchives).values(archive).returning();
    return created;
  }

  async deleteArchive(id: string): Promise<void> {
    await db.delete(tripArchives).where(eq(tripArchives.id, id));
  }

  async listCsvImports(limit = 50): Promise<CsvImport[]> {
    return db.select().from(csvImports)
      .orderBy(desc(csvImports.importedAt))
      .limit(limit);
  }

  async getCsvImport(id: string): Promise<CsvImport | undefined> {
    const [record] = await db.select().from(csvImports).where(eq(csvImports.id, id));
    return record || undefined;
  }

  async createCsvImport(record: InsertCsvImport): Promise<CsvImport> {
    const [created] = await db.insert(csvImports).values(record).returning();
    return created;
  }

  async listAuditLogs(entityId?: string, limit = 200): Promise<AuditLog[]> {
    if (entityId) {
      return db.select().from(auditLogs)
        .where(eq(auditLogs.entityId, entityId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit);
    }
    return db.select().from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }

  async createAuditLog(entry: InsertAuditLog): Promise<AuditLog> {
    const [created] = await db.insert(auditLogs).values(entry).returning();
    return created;
  }

  async getAppSetting(key: string): Promise<AppSetting | undefined> {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
    return row || undefined;
  }

  async upsertAppSetting(key: string, value: unknown): Promise<AppSetting> {
    const [row] = await db
      .insert(appSettings)
      .values({ key, value: value as any, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: value as any, updatedAt: new Date() } })
      .returning();
    return row;
  }

  async getDriverAccountByUsername(username: string): Promise<DriverAccount | undefined> {
    const [row] = await db.select().from(driverAccounts).where(eq(driverAccounts.username, username));
    return row || undefined;
  }

  async getDriverAccount(id: number): Promise<DriverAccount | undefined> {
    const [row] = await db.select().from(driverAccounts).where(eq(driverAccounts.id, id));
    return row || undefined;
  }

  async createDriverAccount(account: InsertDriverAccount): Promise<DriverAccount> {
    const [row] = await db.insert(driverAccounts).values(account).returning();
    return row;
  }

  async updateDriverAccount(id: number, data: DriverAccountUpdate): Promise<DriverAccount | undefined> {
    const [row] = await db.update(driverAccounts).set(data).where(eq(driverAccounts.id, id)).returning();
    return row || undefined;
  }

  async getAllDriverAccounts(): Promise<DriverAccount[]> {
    return db.select().from(driverAccounts);
  }

  async getOnlineDrivers(sinceMinutes = 10): Promise<DriverAccount[]> {
    const cutoff = new Date(Date.now() - sinceMinutes * 60 * 1000);
    return db.select().from(driverAccounts)
      .where(and(
        eq(driverAccounts.isOnline, true),
        gt(driverAccounts.locationUpdatedAt, cutoff)
      ));
  }

  async setDriverOffline(id: number): Promise<void> {
    await db.update(driverAccounts).set({
      isOnline: false,
      onlineSince: null,
      opsOnlinePending: false,
      opsOnlineRequestedAt: null,
      opsOnlineRequestedBy: null,
    }).where(eq(driverAccounts.id, id));
  }

  async setDriverOnline(id: number): Promise<DriverAccount | undefined> {
    const existing = await this.getDriverAccount(id);
    if (!existing) return undefined;
    const [updated] = await db.update(driverAccounts).set({
      isOnline: true,
      // Preserve the original online timestamp if already online.
      onlineSince: existing.isOnline && existing.onlineSince ? existing.onlineSince : new Date(),
      opsOnlinePending: false,
      opsOnlineRequestedAt: null,
      opsOnlineRequestedBy: null,
    }).where(eq(driverAccounts.id, id)).returning();
    return updated;
  }

  async requestDriverOnline(id: number, requestedBy: string): Promise<DriverAccount | undefined> {
    const [updated] = await db.update(driverAccounts).set({
      opsOnlinePending: true,
      opsOnlineRequestedAt: new Date(),
      opsOnlineRequestedBy: requestedBy,
    }).where(eq(driverAccounts.id, id)).returning();
    return updated;
  }

  async clearOpsOnlineRequest(id: number): Promise<void> {
    await db.update(driverAccounts).set({
      opsOnlinePending: false,
      opsOnlineRequestedAt: null,
      opsOnlineRequestedBy: null,
    }).where(eq(driverAccounts.id, id));
  }

  async autoOfflineStaleDrivers(staleMinutes = 10): Promise<number> {
    const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);
    const result = await db.update(driverAccounts)
      .set({ isOnline: false })
      .where(and(
        eq(driverAccounts.isOnline, true),
        lt(driverAccounts.locationUpdatedAt, cutoff)
      ))
      .returning();
    return result.length;
  }

  async deleteDriverAccount(id: number): Promise<void> {
    await db.delete(driverAccounts).where(eq(driverAccounts.id, id));
  }

  async createStopEvent(event: InsertDriverStopEvent): Promise<DriverStopEvent> {
    const [row] = await db.insert(driverStopEvents).values(event).returning();
    return row;
  }

  async getStopEvents(driverAccountId: number, projectId: string): Promise<DriverStopEvent[]> {
    return db.select().from(driverStopEvents)
      .where(and(
        eq(driverStopEvents.driverAccountId, driverAccountId),
        eq(driverStopEvents.projectId, projectId)
      ))
      .orderBy(desc(driverStopEvents.createdAt));
  }

  async createLocationHistory(entry: InsertDriverLocationHistory): Promise<DriverLocationHistory> {
    const [row] = await db.insert(driverLocationHistory).values(entry).returning();
    return row;
  }

  async cleanupOldLocationHistory(daysOld = 30): Promise<number> {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    const result = await db.delete(driverLocationHistory)
      .where(lt(driverLocationHistory.createdAt, cutoff))
      .returning();
    return result.length;
  }

  async upsertDriverPushToken(token: InsertDriverPushToken): Promise<DriverPushToken> {
    const [row] = await db.insert(driverPushTokens)
      .values({ ...token, lastSeenAt: new Date() })
      .onConflictDoUpdate({
        target: [driverPushTokens.driverAccountId, driverPushTokens.token],
        set: {
          platform: token.platform,
          appVersion: token.appVersion ?? "",
          lastSeenAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async removeDriverPushToken(driverAccountId: number, token: string): Promise<void> {
    await db.delete(driverPushTokens)
      .where(and(
        eq(driverPushTokens.driverAccountId, driverAccountId),
        eq(driverPushTokens.token, token),
      ));
  }

  async removeDriverPushTokensByValue(token: string): Promise<void> {
    await db.delete(driverPushTokens).where(eq(driverPushTokens.token, token));
  }

  async listDriverPushTokens(driverAccountId: number): Promise<DriverPushToken[]> {
    return db.select().from(driverPushTokens)
      .where(eq(driverPushTokens.driverAccountId, driverAccountId));
  }

  async createDriverNotification(notification: InsertDriverNotification): Promise<DriverNotification> {
    const [row] = await db.insert(driverNotifications).values(notification).returning();
    return row;
  }

  async listDriverNotifications(driverAccountId: number, limit = 50): Promise<DriverNotification[]> {
    return db.select().from(driverNotifications)
      .where(eq(driverNotifications.driverAccountId, driverAccountId))
      .orderBy(desc(driverNotifications.createdAt))
      .limit(limit);
  }

  async getDriverUnreadNotificationCount(driverAccountId: number): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` })
      .from(driverNotifications)
      .where(and(
        eq(driverNotifications.driverAccountId, driverAccountId),
        sql`${driverNotifications.readAt} IS NULL`,
      ));
    return result[0]?.count || 0;
  }

  async markDriverNotificationRead(id: number, driverAccountId: number): Promise<DriverNotification | undefined> {
    // Scope by driver to prevent one driver marking another driver's row read.
    const [row] = await db.update(driverNotifications)
      .set({ readAt: new Date() })
      .where(and(
        eq(driverNotifications.id, id),
        eq(driverNotifications.driverAccountId, driverAccountId),
      ))
      .returning();
    return row || undefined;
  }

  async markAllDriverNotificationsRead(driverAccountId: number): Promise<void> {
    await db.update(driverNotifications)
      .set({ readAt: new Date() })
      .where(and(
        eq(driverNotifications.driverAccountId, driverAccountId),
        sql`${driverNotifications.readAt} IS NULL`,
      ));
  }

  async pruneOldDriverNotifications(daysOld = 14): Promise<number> {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    const result = await db.delete(driverNotifications)
      .where(lt(driverNotifications.createdAt, cutoff))
      .returning();
    return result.length;
  }

  async getDriverAccountByName(driverName: string): Promise<DriverAccount | undefined> {
    const normalized = driverName.trim();
    if (!normalized) return undefined;
    // DB-level case-insensitive exact match against trimmed driver_name.
    // Avoids loading every driver row just to find one — matters as the
    // fleet grows and as push triggers fire on every project PATCH.
    const rows = await db.select().from(driverAccounts)
      .where(sql`lower(trim(${driverAccounts.driverName})) = ${normalized.toLowerCase()}`)
      .limit(1);
    return rows[0];
  }

  async createReorderRequest(req: InsertDriverReorderRequest): Promise<DriverReorderRequest> {
    const [row] = await db.insert(driverReorderRequests).values(req).returning();
    return row;
  }

  async getReorderRequest(id: number): Promise<DriverReorderRequest | undefined> {
    const [row] = await db.select().from(driverReorderRequests).where(eq(driverReorderRequests.id, id));
    return row || undefined;
  }

  async getPendingReorderRequests(projectId?: string): Promise<DriverReorderRequest[]> {
    if (projectId) {
      return db.select().from(driverReorderRequests)
        .where(and(
          eq(driverReorderRequests.status, "pending"),
          eq(driverReorderRequests.projectId, projectId)
        ))
        .orderBy(desc(driverReorderRequests.createdAt));
    }
    return db.select().from(driverReorderRequests)
      .where(eq(driverReorderRequests.status, "pending"))
      .orderBy(desc(driverReorderRequests.createdAt));
  }

  async getDriverPendingReorder(driverAccountId: number, projectId: string): Promise<DriverReorderRequest | undefined> {
    const [row] = await db.select().from(driverReorderRequests)
      .where(and(
        eq(driverReorderRequests.driverAccountId, driverAccountId),
        eq(driverReorderRequests.projectId, projectId),
        eq(driverReorderRequests.status, "pending")
      ));
    return row || undefined;
  }

  async getDriverLatestReorder(driverAccountId: number, projectId: string): Promise<DriverReorderRequest | undefined> {
    const [row] = await db.select().from(driverReorderRequests)
      .where(and(
        eq(driverReorderRequests.driverAccountId, driverAccountId),
        eq(driverReorderRequests.projectId, projectId)
      ))
      .orderBy(desc(driverReorderRequests.createdAt))
      .limit(1);
    return row || undefined;
  }

  async getRecentReorderRequests(projectId?: string, limit = 20): Promise<DriverReorderRequest[]> {
    if (projectId) {
      return db.select().from(driverReorderRequests)
        .where(eq(driverReorderRequests.projectId, projectId))
        .orderBy(desc(driverReorderRequests.createdAt))
        .limit(limit);
    }
    return db.select().from(driverReorderRequests)
      .orderBy(desc(driverReorderRequests.createdAt))
      .limit(limit);
  }

  async updateReorderRequestStatus(id: number, status: string, reviewedBy: string, reviewNote?: string): Promise<DriverReorderRequest | undefined> {
    const [row] = await db.update(driverReorderRequests)
      .set({ status, reviewedBy, reviewNote: reviewNote || null, reviewedAt: new Date() })
      .where(eq(driverReorderRequests.id, id))
      .returning();
    return row || undefined;
  }

  async listClientAccounts(): Promise<ClientAccount[]> {
    return db.select().from(clientAccounts).orderBy(clientAccounts.clientName);
  }

  async getClientAccountByCode(accountCode: string): Promise<ClientAccount | undefined> {
    const [row] = await db.select().from(clientAccounts).where(eq(clientAccounts.accountCode, accountCode));
    return row || undefined;
  }

  async createClientAccount(account: InsertClientAccount): Promise<ClientAccount> {
    const [row] = await db.insert(clientAccounts).values(account).returning();
    return row;
  }

  async updateClientAccount(id: number, data: Partial<Pick<ClientAccount, "clientName" | "address" | "accountCode">>): Promise<ClientAccount | undefined> {
    const [row] = await db.update(clientAccounts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(clientAccounts.id, id))
      .returning();
    return row || undefined;
  }

  async deleteClientAccount(id: number): Promise<void> {
    await db.delete(clientAccounts).where(eq(clientAccounts.id, id));
  }

  async createWebhookEvent(event: InsertWebhookEvent): Promise<WebhookEvent> {
    const [row] = await db.insert(webhookEvents).values(event).returning();
    return row;
  }

  async listWebhookEvents(limit = 50): Promise<WebhookEvent[]> {
    return db.select().from(webhookEvents)
      .orderBy(desc(webhookEvents.receivedAt))
      .limit(limit);
  }

  async createShipmentAlert(alert: InsertShipmentAlert): Promise<ShipmentAlert> {
    const [row] = await db.insert(shipmentAlerts).values(alert).returning();
    return row;
  }

  async getShipmentAlert(id: string): Promise<ShipmentAlert | undefined> {
    const [row] = await db.select().from(shipmentAlerts).where(eq(shipmentAlerts.id, id));
    return row || undefined;
  }

  async listShipmentAlerts(contactStatus?: string, limit = 100): Promise<ShipmentAlert[]> {
    if (contactStatus && contactStatus !== "all") {
      return db.select().from(shipmentAlerts)
        .where(eq(shipmentAlerts.contactStatus, contactStatus))
        .orderBy(desc(shipmentAlerts.createdAt))
        .limit(limit);
    }
    return db.select().from(shipmentAlerts)
      .orderBy(desc(shipmentAlerts.createdAt))
      .limit(limit);
  }

  async updateShipmentAlert(id: string, data: Partial<Pick<ShipmentAlert, "contactStatus" | "shipmentStatus" | "etaMinutes" | "driverLat" | "driverLng" | "notes" | "recipientName" | "recipientPhone" | "deliveryAddress" | "driverName" | "driverAccountId" | "deliveryLat" | "deliveryLng">>): Promise<ShipmentAlert | undefined> {
    const [row] = await db.update(shipmentAlerts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(shipmentAlerts.id, id))
      .returning();
    return row || undefined;
  }

  async getActiveAlertByWaybill(waybill: string): Promise<ShipmentAlert | undefined> {
    const [row] = await db.select().from(shipmentAlerts)
      .where(and(
        eq(shipmentAlerts.waybill, waybill),
        ne(shipmentAlerts.shipmentStatus, "delivered"),
        ne(shipmentAlerts.shipmentStatus, "failed")
      ))
      .orderBy(desc(shipmentAlerts.createdAt))
      .limit(1);
    return row || undefined;
  }

  async getLatestAlertByWaybill(waybill: string): Promise<ShipmentAlert | undefined> {
    const [row] = await db.select().from(shipmentAlerts)
      .where(eq(shipmentAlerts.waybill, waybill))
      .orderBy(desc(shipmentAlerts.createdAt))
      .limit(1);
    return row || undefined;
  }

  async deleteShipmentAlert(id: string): Promise<boolean> {
    await db.delete(recipientContactLogs).where(eq(recipientContactLogs.alertId, id));
    await db.delete(notifications).where(eq(notifications.alertId, id));
    const rows = await db.delete(shipmentAlerts).where(eq(shipmentAlerts.id, id)).returning();
    return rows.length > 0;
  }

  async createContactLog(log: InsertRecipientContactLog): Promise<RecipientContactLog> {
    const [row] = await db.insert(recipientContactLogs).values(log).returning();
    return row;
  }

  async getContactLogsByAlert(alertId: string): Promise<RecipientContactLog[]> {
    return db.select().from(recipientContactLogs)
      .where(eq(recipientContactLogs.alertId, alertId))
      .orderBy(desc(recipientContactLogs.createdAt));
  }

  async createNotification(notification: InsertNotification): Promise<Notification> {
    const [row] = await db.insert(notifications).values(notification).returning();
    return row;
  }

  async getUnreadCount(targetRole = "client_care"): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(
        eq(notifications.read, false),
        eq(notifications.targetRole, targetRole)
      ));
    return result[0]?.count || 0;
  }

  async markNotificationRead(id: number): Promise<void> {
    await db.update(notifications)
      .set({ read: true })
      .where(eq(notifications.id, id));
  }

  async markAllNotificationsRead(targetRole = "client_care"): Promise<void> {
    await db.update(notifications)
      .set({ read: true })
      .where(and(
        eq(notifications.read, false),
        eq(notifications.targetRole, targetRole)
      ));
  }

  async listNotifications(limit = 50, targetRole = "client_care"): Promise<Notification[]> {
    return db.select().from(notifications)
      .where(eq(notifications.targetRole, targetRole))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  async listNotificationsByWaybill(waybill: string): Promise<Notification[]> {
    return db.select().from(notifications)
      .where(eq(notifications.waybill, waybill))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
  }

  async createDriverTrip(trip: InsertDriverTrip): Promise<DriverTrip> {
    const [row] = await db.insert(driverTrips).values(trip).returning();
    return row;
  }

  async getActiveDriverTrip(driverAccountId: number): Promise<DriverTrip | undefined> {
    const [row] = await db.select().from(driverTrips)
      .where(and(eq(driverTrips.driverAccountId, driverAccountId), eq(driverTrips.status, "active")))
      .orderBy(desc(driverTrips.startTime))
      .limit(1);
    return row || undefined;
  }

  async getDriverTrip(id: number): Promise<DriverTrip | undefined> {
    const [row] = await db.select().from(driverTrips).where(eq(driverTrips.id, id)).limit(1);
    return row || undefined;
  }

  async closeDriverTrip(id: number, data: {
    endTime: Date;
    endOdometer: string;
    endFuelLevel: string;
    endClusterPhoto?: string | null;
    endLat?: number | null;
    endLng?: number | null;
    notes?: string;
  }): Promise<DriverTrip | undefined> {
    const [row] = await db.update(driverTrips)
      .set({
        endTime: data.endTime,
        endOdometer: data.endOdometer,
        endFuelLevel: data.endFuelLevel,
        endClusterPhoto: data.endClusterPhoto ?? null,
        endLat: data.endLat ?? null,
        endLng: data.endLng ?? null,
        notes: data.notes ?? "",
        status: "closed",
      })
      .where(eq(driverTrips.id, id))
      .returning();
    return row || undefined;
  }

  async listDriverTrips(opts: { driverAccountId?: number; limit?: number; status?: string; from?: Date; to?: Date } = {}): Promise<DriverTrip[]> {
    const conds: SQL[] = [];
    if (opts.driverAccountId != null) conds.push(eq(driverTrips.driverAccountId, opts.driverAccountId));
    if (opts.status) conds.push(eq(driverTrips.status, opts.status));
    if (opts.from) conds.push(gt(driverTrips.startTime, opts.from));
    if (opts.to) conds.push(lt(driverTrips.startTime, opts.to));
    const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
    const q = db.select().from(driverTrips);
    const filtered = where ? q.where(where) : q;
    return filtered.orderBy(desc(driverTrips.startTime)).limit(opts.limit ?? 100);
  }

  async createDriverTripStop(stop: InsertDriverTripStop): Promise<DriverTripStop> {
    const [row] = await db.insert(driverTripStops).values(stop).returning();
    return row;
  }

  async listDriverTripStops(tripId: number): Promise<DriverTripStop[]> {
    return db.select().from(driverTripStops)
      .where(eq(driverTripStops.tripId, tripId))
      .orderBy(driverTripStops.arrivedAt);
  }

  async listDriverTripStopsBatch(tripIds: number[]): Promise<DriverTripStop[]> {
    if (tripIds.length === 0) return [];
    return db.select().from(driverTripStops)
      .where(inArray(driverTripStops.tripId, tripIds))
      .orderBy(driverTripStops.arrivedAt);
  }

  async createDriverTripExpense(expense: InsertDriverTripExpense): Promise<DriverTripExpense> {
    const [row] = await db.insert(driverTripExpenses).values(expense).returning();
    return row;
  }

  async getTripDetail(id: number): Promise<{ trip: DriverTrip; stops: DriverTripStop[]; expenses: DriverTripExpense[] } | undefined> {
    const trip = await this.getDriverTrip(id);
    if (!trip) return undefined;
    const [stops, expenses] = await Promise.all([
      this.listDriverTripStops(id),
      this.listDriverTripExpenses(id),
    ]);
    return { trip, stops, expenses };
  }

  async listDriverTripExpenses(tripId: number): Promise<DriverTripExpense[]> {
    return db.select().from(driverTripExpenses)
      .where(eq(driverTripExpenses.tripId, tripId))
      .orderBy(driverTripExpenses.incurredAt);
  }

  async listDriverTripExpensesBatch(tripIds: number[]): Promise<DriverTripExpense[]> {
    if (tripIds.length === 0) return [];
    return db.select().from(driverTripExpenses)
      .where(inArray(driverTripExpenses.tripId, tripIds))
      .orderBy(driverTripExpenses.incurredAt);
  }
}

export const storage = new DatabaseStorage();
