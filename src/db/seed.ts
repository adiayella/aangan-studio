import pg from "pg";
import { env } from "../config.js";

// Public knowledge the voice agent may use. Derived from services.md and the pricing policy's APPROVED reply only.
// NEVER add pricing figures here.
export const KB: [string, string][] = [
  ["what_we_do", "Aangan Studio offers end-to-end interior design for homes and small commercial spaces across Pune and PCMC: space planning, material selection, furniture design and curation, lighting, kitchens and wardrobes, and execution supervision with our own network of contractors and vendors."],
  ["residential_scope", "Residential projects: apartments, independent houses and villas. Full home from 2BHK onwards, a full floor, or two or more rooms. A single room (bedroom or living room) qualifies when it is a complete redesign with execution. Rented apartments are fine when there are no structural changes."],
  ["commercial_scope", "Commercial projects: offices, clinics and studios up to about 3,000 sq ft. Restaurants, hotels, retail stores and gyms are not taken on."],
  ["not_offered", "We do not do architecture or structural work, decor or styling advice only, standalone furniture sourcing, standalone Vastu consultation, or projects outside our service area."],
  ["service_area", "We serve Pune city (Kothrud, Baner, Aundh, Wakad, Koregaon Park, Kalyani Nagar, Viman Nagar, Hadapsar, Magarpatta, NIBM, Kondhwa, Undri, Shivane, Warje, Erandwane, Deccan and nearby areas) and PCMC (Pimpri, Chinchwad, Pimple Saudagar, Pimple Nilakh, Ravet, Hinjewadi). We do not currently serve Talegaon, Lonavala, Nashik, Mumbai or other cities."],
  ["timelines", "The design phase takes about 3-4 weeks from the first consultation. Execution takes about 8-16 weeks depending on project size and site readiness. We cannot start execution on a project that must be ready in under 6 weeks."],
  ["consultation", "The first consultation with a designer is free and without obligation. The designer goes through the scope, materials and pricing in detail."],
  ["pricing_reply", "Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like."],
];

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("seed.ts")) {
  const c = new pg.Client({ connectionString: env("DATABASE_URL") });
  await c.connect();
  await c.query("delete from kb_entries");
  for (const [topic, content] of KB) await c.query("insert into kb_entries(topic, content) values ($1,$2)", [topic, content]);
  console.log(`seeded ${KB.length} knowledge entries`);
  await c.end();
}
