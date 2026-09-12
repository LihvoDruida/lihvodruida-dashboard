#!/usr/bin/env node
/**
 * Read-only production diagnostic for Discord button backing data.
 * Run inside the dashboard container: make discord-check
 * Never prints secret values.
 */
import pg from "pg";

const { Pool } = pg;
const databaseUrl = String(process.env.DATABASE_URL || "").trim();

function mark(ok) {
  return ok ? "OK" : "WARN";
}

function present(name) {
  const value = String(process.env[name] || "").trim();
  console.log(`${mark(Boolean(value))}  ${name}: ${value ? "set" : "missing"}`);
}

console.log("== Discord interaction storage ==");
present("DATABASE_URL");
present("DISCORD_GUILD_ID");
present("DISCORD_BOT_TOKEN");
present("DISCORD_PUBLIC_KEY");
present("FIREBASE_PROJECT_ID");
present("FIREBASE_CLIENT_EMAIL");
present("FIREBASE_PRIVATE_KEY");

for (const flag of [
  "FIREBASE_READS_DISABLED",
  "FIRESTORE_READS_DISABLED",
  "FIREBASE_WRITES_DISABLED",
  "FIRESTORE_WRITES_DISABLED",
  "FIREBASE_READ_ONLY_MODE",
  "FIREBASE_ECO_READ_ONLY",
]) {
  const value = String(process.env[flag] || "").trim();
  if (value) console.log(`INFO ${flag}=${value}`);
}

if (!databaseUrl) {
  console.error("FAIL DATABASE_URL is missing; cannot inspect PostgreSQL.");
  process.exitCode = 2;
} else {
  const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000 });
  try {
    await pool.query("SELECT 1");
    console.log("OK   PostgreSQL connection");

    const collections = [
      "dashboardRaids",
      "dashboardRaidPolls",
      "dashboardRosterFormations",
      "dashboardProfiles",
    ];
    const result = await pool.query(
      `SELECT collection,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE NULLIF(data->>'messageId','') IS NOT NULL)::int AS with_message,
              COUNT(*) FILTER (WHERE NULLIF(data->>'channelId','') IS NOT NULL)::int AS with_channel
         FROM documents
        WHERE collection = ANY($1::text[])
        GROUP BY collection
        ORDER BY collection`,
      [collections],
    );

    const rows = new Map(result.rows.map((row) => [row.collection, row]));
    console.log("\ncollection                     total  msg  channel");
    console.log("-------------------------------------------------");
    for (const collection of collections) {
      const row = rows.get(collection) || { total: 0, with_message: 0, with_channel: 0 };
      console.log(`${collection.padEnd(30)} ${String(row.total).padStart(5)} ${String(row.with_message).padStart(4)} ${String(row.with_channel).padStart(8)}`);
    }

    const resourceCollections = collections.slice(0, 3);
    const resourceTotal = resourceCollections.reduce((sum, name) => sum + Number(rows.get(name)?.total || 0), 0);
    if (resourceTotal === 0) {
      console.log("\nWARN PostgreSQL has zero raid/poll/roster documents.");
      if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
        console.log("INFO Legacy Firestore credentials are present: interaction read-through can recover old documents on first click.");
      } else {
        console.log("WARN Legacy Firestore credentials are absent. Old Discord messages cannot be recovered automatically if their documents were never migrated.");
      }
    }

    const duplicates = await pool.query(
      `SELECT collection, data->>'channelId' AS channel_id, data->>'messageId' AS message_id, COUNT(*)::int AS copies
         FROM documents
        WHERE collection = ANY($1::text[])
          AND NULLIF(data->>'channelId','') IS NOT NULL
          AND NULLIF(data->>'messageId','') IS NOT NULL
        GROUP BY collection, data->>'channelId', data->>'messageId'
       HAVING COUNT(*) > 1
        ORDER BY copies DESC
        LIMIT 20`,
      [resourceCollections],
    );
    console.log(`\n${duplicates.rowCount ? "WARN" : "OK"}  duplicate Discord message mappings: ${duplicates.rowCount}`);
  } catch (error) {
    console.error(`FAIL PostgreSQL diagnostic: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  } finally {
    await pool.end().catch(() => {});
  }
}
