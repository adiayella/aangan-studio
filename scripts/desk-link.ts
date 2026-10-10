// Creates private Designer Desk links (no email/password). Links are written to a git-ignored file, never printed.
// Usage: npx tsx scripts/desk-link.ts team "Team view"
//        npx tsx scripts/desk-link.ts designer ayella.adwaith@gmail.com
//        npx tsx scripts/desk-link.ts revoke "<label>"
import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import "../src/config.js";
import { db, closeDb } from "../src/db/pool.js";
import { hashKey } from "../src/desk/api.js";

const [kind, arg] = process.argv.slice(2);
const BASE = "https://aangan-receptionist-one.vercel.app";
try {
  if (kind === "revoke") {
    const r = await db().query("update access_keys set active = false where label = $1 and active returning id", [arg]);
    console.log(`revoked ${r.rowCount} link(s) labelled "${arg}"`);
  } else {
    let designerId: string | null = null;
    let label = arg || "Team view";
    if (kind === "designer") {
      const d = (await db().query("select id, name from designers where lower(email) = lower($1) and active", [arg])).rows[0];
      if (!d) throw new Error("no active designer with that email");
      designerId = d.id;
      label = d.name;
    } else if (kind !== "team") throw new Error('usage: team <label> | designer <email> | revoke <label>');
    const key = randomBytes(32).toString("hex");
    await db().query("insert into access_keys(label, key_hash, designer_id) values ($1,$2,$3)", [label, hashKey(key), designerId]);
    appendFileSync("docs/desk-links.local.txt", `${label}  (${designerId ? "sees only this designer's leads" : "TEAM: sees every enquiry"})\n${BASE}/#key=${key}\n\n`);
    console.log(`created a private link for "${label}" and saved it in docs/desk-links.local.txt (git-ignored; not shown here)`);
  }
} finally {
  await closeDb();
}
