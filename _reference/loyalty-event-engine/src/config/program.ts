// The loyalty program expressed as data. The engine reads tier and milestone
// rows from the database; this file is the source the seed script loads, and
// the single place to tune the program before seeding. Changing live values is
// done by editing the tier_config / milestones tables (or an admin endpoint),
// not by redeploying code.

export interface TierSpec {
  code: "bronze" | "silver" | "gold" | "platinum" | "diamond" | "founder";
  label: string;
  minMonthShipments: number;
  cashbackBps: number; // 200 = 2%
  benefits: string[];
  displayOrder: number;
}

export interface MilestoneSpec {
  code: string;
  label: string;
  triggerType: "every_n" | "at_n";
  n: number;
  rewardType: "credit" | "free_delivery" | "badge";
  rewardValueCents: number;
}

// Cash back climbs with tier, matching the doc: Bronze 2% ... Platinum 5%.
export const TIERS: TierSpec[] = [
  {
    code: "bronze",
    label: "Bronze",
    minMonthShipments: 0,
    cashbackBps: 200,
    benefits: ["Loyalty programme access", "Monthly offers", "Basic rewards"],
    displayOrder: 1,
  },
  {
    code: "silver",
    label: "Silver",
    minMonthShipments: 50,
    cashbackBps: 300,
    benefits: ["Discounted shipping rates", "Monthly delivery credits", "Exclusive promotions"],
    displayOrder: 2,
  },
  {
    code: "gold",
    label: "Gold",
    minMonthShipments: 100,
    cashbackBps: 400,
    benefits: [
      "Priority collections",
      "Dedicated support queue",
      "No public holiday surcharge",
      "One free redelivery per month",
    ],
    displayOrder: 3,
  },
  {
    code: "platinum",
    label: "Platinum",
    minMonthShipments: 200,
    cashbackBps: 500,
    benefits: [
      "Premium collection priority",
      "Guaranteed collection window",
      "Dedicated account support",
      "Early access to new features",
    ],
    displayOrder: 4,
  },
  {
    code: "diamond",
    label: "Diamond",
    minMonthShipments: 350,
    cashbackBps: 500,
    benefits: ["All Platinum benefits", "Strategic partnership opportunities"],
    displayOrder: 5,
  },
  {
    code: "founder",
    label: "Founder Circle",
    minMonthShipments: 500,
    cashbackBps: 500,
    benefits: [
      "Direct WhatsApp support",
      "Beta access",
      "Strategic meetings",
      "Route priority",
      "Exclusive pricing",
    ],
    displayOrder: 6,
  },
];

// Lifetime shipment milestones from the doc.
export const MILESTONES: MilestoneSpec[] = [
  { code: "ship_25", label: "Every 25th shipment", triggerType: "every_n", n: 25, rewardType: "credit", rewardValueCents: 5000 },
  { code: "ship_75", label: "Every 75th shipment", triggerType: "every_n", n: 75, rewardType: "credit", rewardValueCents: 10000 },
  { code: "ship_150", label: "Every 150th shipment", triggerType: "every_n", n: 150, rewardType: "credit", rewardValueCents: 20000 },
  { code: "ship_250", label: "Every 250th shipment", triggerType: "every_n", n: 250, rewardType: "credit", rewardValueCents: 35000 },
  { code: "ship_500", label: "Delicate Elite (every 500th)", triggerType: "every_n", n: 500, rewardType: "credit", rewardValueCents: 75000 },
  { code: "ship_1000_club", label: "1,000 Shipment Club", triggerType: "at_n", n: 1000, rewardType: "badge", rewardValueCents: 0 },
];

// Default rules seeded into the rules table. Accrual fires on completed
// deliveries; the webhook fan-out mirrors every event to subscribers.
export const DEFAULT_RULES = [
  {
    name: "Cash back on completed delivery",
    eventType: "delivery.completed",
    actionType: "accrue_loyalty",
    config: { flatPerShipmentCents: 0 }, // 0 = percentage-only; see accrual.ts
    priority: 10,
  },
  {
    name: "Fan out all events to webhook subscribers",
    eventType: "*",
    actionType: "send_webhook",
    config: {},
    priority: 90,
  },
];
