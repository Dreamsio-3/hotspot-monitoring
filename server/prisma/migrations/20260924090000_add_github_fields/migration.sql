-- Add nullable GitHub metadata so existing hotspots remain readable.
ALTER TABLE "Hotspot" ADD COLUMN "eventType" TEXT;
ALTER TABLE "Hotspot" ADD COLUMN "repoFullName" TEXT;
ALTER TABLE "Hotspot" ADD COLUMN "starCount" INTEGER;
ALTER TABLE "Hotspot" ADD COLUMN "forkCount" INTEGER;
ALTER TABLE "Hotspot" ADD COLUMN "watcherCount" INTEGER;
ALTER TABLE "Hotspot" ADD COLUMN "language" TEXT;
ALTER TABLE "Hotspot" ADD COLUMN "releaseTagName" TEXT;
ALTER TABLE "Hotspot" ADD COLUMN "releaseIsPrerelease" BOOLEAN;
ALTER TABLE "Hotspot" ADD COLUMN "pushedAt" DATETIME;
