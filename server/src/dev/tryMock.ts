// Quick manual check that MockSource works. Run with: npm run try:mock
// Optional: npm run try:mock -- fixtures/utf8   (uses the full snapshot)
import { MockSource } from "../mockSource.js";

const source = new MockSource(process.argv[2]);

const houses = await source.listHouses();
console.log("Houses:", houses);

const snapshot = await source.fetchSnapshot(113);
if (!snapshot) throw new Error("Expected a snapshot");
console.log(
  `Snapshot taken ${new Date(snapshot.takenAt * 1000).toISOString()}:`,
  `${snapshot.commodities.length} commodity listings,`,
  `${snapshot.items.length} item listings`,
);

const peacebloom = snapshot.commodities.filter((l) => l.item.id === 2447);
const minPrice = Math.min(...peacebloom.map((l) => l.unit_price));
const totalQty = peacebloom.reduce((sum, l) => sum + l.quantity, 0);
console.log(`Peacebloom: ${peacebloom.length} listings, min ${minPrice}c, ${totalQty} listed`);

console.log("Same snapshot again (should be null):", await source.fetchSnapshot(113, snapshot.takenAt));
console.log("Known item:", await source.getItem(2447));
console.log("Unknown item (should be null):", await source.getItem(999999));
