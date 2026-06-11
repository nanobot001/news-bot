-- Add durable content intent and routing fields for editorial routing.
ALTER TABLE "Article" ADD COLUMN "intent" TEXT;
ALTER TABLE "Article" ADD COLUMN "intentConfidence" REAL;
ALTER TABLE "Article" ADD COLUMN "route" TEXT;
ALTER TABLE "Article" ADD COLUMN "routeReason" TEXT;

CREATE INDEX "Article_intent_idx" ON "Article"("intent");
CREATE INDEX "Article_route_idx" ON "Article"("route");
