import { MongoClient, type Db, type Collection } from "mongodb";
import type { InboundMessage, RankedMessage, ApprovedMessage, SentConfirmation } from "./types.js";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/yhack-agent";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (db) return db;
  client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db();

  // Create text indexes for search
  await db.collection("ranked").createIndex(
    { "inbound.from": "text", "inbound.subject": "text", gist: "text", "inbound.body": "text" },
    { background: true }
  ).catch((err) => {
    console.warn("[db] Failed to create text search index:", err.message);
  });

  await db.collection("ranked").createIndex({ "inbound.id": 1 }, { unique: true, background: true }).catch((err) => {
    console.error("[db] Failed to create unique index on ranked.inbound.id:", err.message);
  });
  await db.collection("ranked").createIndex({ rankedAt: -1 }, { background: true }).catch((err) => {
    console.warn("[db] Failed to create rankedAt index:", err.message);
  });

  console.log(`[db] Connected to MongoDB: ${MONGODB_URI.replace(/\/\/[^@]+@/, "//***@")}`);
  return db;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

export async function inboundCol(): Promise<Collection<InboundMessage>> {
  return (await getDb()).collection("inbound");
}

export async function rankedCol(): Promise<Collection<RankedMessage>> {
  return (await getDb()).collection("ranked");
}

export async function approvedCol(): Promise<Collection<ApprovedMessage>> {
  return (await getDb()).collection("approved");
}

export async function sentCol(): Promise<Collection<SentConfirmation>> {
  return (await getDb()).collection("sent");
}
