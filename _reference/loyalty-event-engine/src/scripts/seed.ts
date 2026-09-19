import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "../db/client";
import {
  tierConfig,
  milestones,
  rules,
  nodes,
  tags,
  loyaltyAccounts,
  customerUsers,
} from "../db/schema";
import { TIERS, MILESTONES, DEFAULT_RULES } from "../config/program";
import { hashPassword } from "../lib/auth";

async function seedTiers() {
  for (const t of TIERS) {
    await db
      .insert(tierConfig)
      .values({
        code: t.code,
        label: t.label,
        minMonthShipments: t.minMonthShipments,
        cashbackBps: t.cashbackBps,
        benefits: t.benefits,
        displayOrder: t.displayOrder,
      })
      .onConflictDoNothing({ target: tierConfig.code });
  }
  console.log(`Seeded ${TIERS.length} tiers`);
}

async function seedMilestones() {
  for (const m of MILESTONES) {
    await db
      .insert(milestones)
      .values({
        code: m.code,
        label: m.label,
        triggerType: m.triggerType,
        n: m.n,
        rewardType: m.rewardType,
        rewardValueCents: m.rewardValueCents,
      })
      .onConflictDoNothing({ target: milestones.code });
  }
  console.log(`Seeded ${MILESTONES.length} milestones`);
}

async function seedRules() {
  // Rules have no natural unique key; only seed if the table is empty.
  const existing = await db.select({ id: rules.id }).from(rules).limit(1);
  if (existing.length > 0) {
    console.log("Rules already present, skipping");
    return;
  }
  for (const r of DEFAULT_RULES) {
    await db.insert(rules).values({
      name: r.name,
      eventType: r.eventType,
      actionType: r.actionType,
      config: r.config,
      priority: r.priority,
    });
  }
  console.log(`Seeded ${DEFAULT_RULES.length} rules`);
}

async function seedSample() {
  const existing = await db
    .select({ id: nodes.id })
    .from(nodes)
    .where(eq(nodes.externalClientId, "3"))
    .limit(1);

  let nodeId = existing[0]?.id;
  if (!nodeId) {
    const [node] = await db
      .insert(nodes)
      .values({
        name: "Honey Bee Baker",
        externalClientId: "3", // Route Optimizer client/store id
        type: "bakery",
        contactEmail: "hello@honeybeebaker.example",
      })
      .returning({ id: nodes.id });
    nodeId = node!.id;
    console.log(`Created sample node Honey Bee Baker (${nodeId})`);
  } else {
    console.log("Sample node already exists");
  }

  await db.insert(loyaltyAccounts).values({ nodeId }).onConflictDoNothing({ target: loyaltyAccounts.nodeId });

  // Sample tag. Replace tagUid with a real NTAG 424 DNA UID before going live.
  await db
    .insert(tags)
    .values({
      tagUid: "04aabbccddee80",
      label: "HBB001",
      nodeId,
      batch: "sample",
    })
    .onConflictDoNothing({ target: tags.tagUid });

  // Sample portal login: owner@honeybeebaker.example / changeme123
  const passwordHash = await hashPassword("changeme123");
  await db
    .insert(customerUsers)
    .values({
      nodeId,
      email: "owner@honeybeebaker.example",
      passwordHash,
      displayName: "Honey Bee Baker",
      role: "owner",
    })
    .onConflictDoNothing({ target: customerUsers.email });

  console.log("Sample tag HBB001 and portal login seeded");
}

async function main() {
  await seedTiers();
  await seedMilestones();
  await seedRules();
  await seedSample();
  console.log("\nSeed complete.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
