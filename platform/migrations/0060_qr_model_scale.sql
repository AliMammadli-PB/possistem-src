-- Legacy captures commonly inherited 28 cm from the form, without a ruler.
-- Keep geometry/history; mark only this legacy default as unverified, once.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
   AND table_name='restaurant_qr_scans' AND column_name='automatic_scale') THEN
  ALTER TABLE restaurant_qr_scans ADD COLUMN automatic_scale boolean NOT NULL DEFAULT false;
  UPDATE restaurant_qr_models m SET metadata=m.metadata || '{"scaleEstimated":true}'::jsonb
   WHERE EXISTS(SELECT 1 FROM restaurant_qr_scans s WHERE s.model_id=m.id AND s.width_cm=28);
  UPDATE restaurant_qr_scans SET automatic_scale=true WHERE width_cm=28;
 END IF;
END $$;
