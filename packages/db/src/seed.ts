import { eq } from "drizzle-orm";
import { createDb } from "./client.js";
import { accounts, memberships, organizations, users } from "./schema/index.js";

/**
 * Development seed. Idempotent: re-running updates rather than duplicates.
 * User ids are fixed so dev tokens (`pnpm --filter @delicate/api run dev:token`) line up.
 */
export const SEED = {
  superAdmin: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "admin@delicatecourier.local",
    fullName: "Delicate Admin",
  },
  dispatcher: {
    id: "00000000-0000-4000-8000-000000000002",
    email: "dispatch@delicatecourier.local",
    fullName: "Dispatch Desk",
  },
  finance: {
    id: "00000000-0000-4000-8000-000000000003",
    email: "finance@delicatecourier.local",
    fullName: "Finance Desk",
  },
  customerOwner: {
    id: "00000000-0000-4000-8000-000000000010",
    email: "owner@honeybee.local",
    fullName: "Honey Bee Owner",
  },
  customerStaff: {
    id: "00000000-0000-4000-8000-000000000011",
    email: "staff@honeybee.local",
    fullName: "Honey Bee Staff",
  },
  organization: { id: "00000000-0000-4000-8000-0000000000a0", name: "Honey Bee Bakers (Pty) Ltd" },
  accounts: [
    { id: "00000000-0000-4000-8000-0000000000b1", name: "Honey Bee – Menlyn" },
    { id: "00000000-0000-4000-8000-0000000000b2", name: "Honey Bee – Centurion" },
  ],
} as const;

export async function seed(connectionString: string): Promise<void> {
  const handle = createDb(connectionString, { max: 1 });
  const { db } = handle;
  try {
    await db.transaction(async (tx) => {
      const staff = [
        { ...SEED.superAdmin, platformRole: "super_admin" as const },
        { ...SEED.dispatcher, platformRole: "dispatcher" as const },
        { ...SEED.finance, platformRole: "finance" as const },
      ];
      for (const u of staff) {
        await tx
          .insert(users)
          .values(u)
          .onConflictDoUpdate({
            target: users.id,
            set: { email: u.email, fullName: u.fullName, platformRole: u.platformRole },
          });
      }
      for (const u of [SEED.customerOwner, SEED.customerStaff]) {
        await tx
          .insert(users)
          .values({ ...u, platformRole: null })
          .onConflictDoUpdate({ target: users.id, set: { email: u.email, fullName: u.fullName } });
      }

      await tx
        .insert(organizations)
        .values(SEED.organization)
        .onConflictDoUpdate({ target: organizations.id, set: { name: SEED.organization.name } });

      for (const a of SEED.accounts) {
        await tx
          .insert(accounts)
          .values({
            id: a.id,
            name: a.name,
            organizationId: SEED.organization.id,
            type: "business",
            billingMode: "prepaid",
          })
          .onConflictDoUpdate({ target: accounts.id, set: { name: a.name } });

        await tx
          .insert(memberships)
          .values([
            { accountId: a.id, userId: SEED.customerOwner.id, role: "customer_owner" },
            { accountId: a.id, userId: SEED.customerStaff.id, role: "customer_staff" },
          ])
          .onConflictDoNothing();
      }
    });

    const count = await db.$count(accounts, eq(accounts.organizationId, SEED.organization.id));
    console.log(`seeded: ${count} accounts for ${SEED.organization.name}`);
  } finally {
    await handle.close();
  }
}

if (process.argv[1]?.endsWith("seed.ts") || process.argv[1]?.endsWith("seed.js")) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  seed(url).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
