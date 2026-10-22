// Creates the Stripe products and prices of the paid plans, in TEST mode, from `plans.ts`.
// Run with `pnpm stripe:setup` (Node runs the TypeScript directly). Safe to run again: a price
// that already has the right amount is left alone; a price whose amount changed in `plans.ts` is
// replaced by a new one that takes over the stable name (`lookup_key`) the application looks up.
// Typing the prices by hand in the dashboard is how they end up wrong, hence this script.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { APP_NAME } from "../packages/shared/src/brand.ts";
import { EXTENSION, PLANS, STRIPE_LOOKUP_KEYS } from "../packages/shared/src/plans.ts";

const webDirectory = new URL("../apps/web/", import.meta.url);
// `stripe` is a dependency of the web app, not of the repository root.
const requireFromWeb = createRequire(new URL("package.json", webDirectory));
const Stripe = requireFromWeb("stripe");

/** The key from the environment, or from `apps/web/.env.local` (the file the application reads). */
function secretKey() {
  if (process.env.STRIPE_SECRET_KEY) return process.env.STRIPE_SECRET_KEY;
  try {
    const text = readFileSync(fileURLToPath(new URL(".env.local", webDirectory)), "utf8");
    const line = text.split(/\r?\n/).find((entry) => entry.startsWith("STRIPE_SECRET_KEY="));
    return line?.slice("STRIPE_SECRET_KEY=".length).trim() ?? "";
  } catch {
    return "";
  }
}

const key = secretKey();
if (!key) {
  console.error("STRIPE_SECRET_KEY is empty: see phase-4-services.md, section A and B.");
  process.exit(1);
}
if (!key.startsWith("sk_test_")) {
  // Real keys are never used by this project: payments stay in test mode until Dao decides.
  console.error("Refusing to run: only Stripe TEST keys (sk_test_...) are accepted.");
  process.exit(1);
}

const stripe = new Stripe(key);

const catalog = [
  {
    lookupKey: STRIPE_LOOKUP_KEYS.event,
    name: `${APP_NAME} — Offre Événement`,
    description: "Album complet : originaux conservés, 12 mois de conservation.",
    amount: PLANS.event.priceCents,
  },
  {
    lookupKey: STRIPE_LOOKUP_KEYS.extension,
    name: `${APP_NAME} — Prolongation de 12 mois`,
    description: "Conservation de l'album prolongée.",
    amount: EXTENSION.priceCents,
  },
];

for (const item of catalog) {
  if (typeof item.amount !== "number")
    throw new Error(`No price in plans.ts for ${item.lookupKey}`);
  const found = await stripe.prices.list({ lookup_keys: [item.lookupKey], active: true, limit: 1 });
  const existing = found.data[0];

  if (existing && existing.unit_amount === item.amount && existing.currency === "eur") {
    console.log(`= ${item.lookupKey}: ${item.amount / 100} EUR already in place (${existing.id})`);
    continue;
  }

  // A price cannot be edited: the product stays, a new price takes the name over.
  const productId =
    typeof existing?.product === "string"
      ? existing.product
      : (
          await stripe.products.create({
            name: item.name,
            description: item.description,
            metadata: { catalog_key: item.lookupKey },
          })
        ).id;

  const price = await stripe.prices.create({
    product: productId,
    currency: "eur",
    unit_amount: item.amount,
    // Prices are shown VAT included (SPEC 13).
    tax_behavior: "inclusive",
    lookup_key: item.lookupKey,
    transfer_lookup_key: true,
  });
  console.log(
    `+ ${item.lookupKey}: ${item.amount / 100} EUR ${existing ? "replaces " + existing.id : "created"} (${price.id})`,
  );
}

console.log("Done. Check the products in the Stripe dashboard (test mode).");
