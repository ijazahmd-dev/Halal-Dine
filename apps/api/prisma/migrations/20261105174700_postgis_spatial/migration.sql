-- Add PostGIS spatial Point column to Restaurant table
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "location" geometry(Point, 4326);

-- Populate location from latitude and longitude if existing
UPDATE "Restaurant" 
SET "location" = ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326) 
WHERE "location" IS NULL AND "latitude" IS NOT NULL AND "longitude" IS NOT NULL;

-- Create GIST spatial index for high-speed proximity queries
CREATE INDEX IF NOT EXISTS "restaurant_location_gist_idx" ON "Restaurant" USING GIST ("location");

-- Create a trigger function to keep "location" updated automatically
CREATE OR REPLACE FUNCTION sync_restaurant_location()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_restaurant_location ON "Restaurant";
CREATE TRIGGER trg_sync_restaurant_location
BEFORE INSERT OR UPDATE OF latitude, longitude ON "Restaurant"
FOR EACH ROW
EXECUTE FUNCTION sync_restaurant_location();
