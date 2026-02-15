import { Hono } from "hono";
import { db } from "ponder:api";
import * as schema from "ponder:schema";
import { eq } from "ponder";

const app = new Hono();

// Custom REST endpoint: sale by ID
app.get("/sales/:saleId", async (c) => {
  const saleId = c.req.param("saleId") as `0x${string}`;
  const result = await db
    .select()
    .from(schema.salesOnchain)
    .where(eq(schema.salesOnchain.id, saleId));
  if (result.length === 0) return c.json({ error: "Not found" }, 404);
  return c.json(result[0]);
});

// Custom REST endpoint: claims by sale
app.get("/sales/:saleId/claims", async (c) => {
  const saleId = c.req.param("saleId") as `0x${string}`;
  const result = await db
    .select()
    .from(schema.claimsOnchain)
    .where(eq(schema.claimsOnchain.saleId, saleId));
  return c.json(result);
});

// Custom REST endpoint: ticket types by sale
app.get("/sales/:saleId/ticket-types", async (c) => {
  const saleId = c.req.param("saleId") as `0x${string}`;
  const result = await db
    .select()
    .from(schema.ticketTypesOnchain)
    .where(eq(schema.ticketTypesOnchain.saleId, saleId));
  return c.json(result);
});

export default app;
