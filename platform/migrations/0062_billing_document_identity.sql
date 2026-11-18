-- A receipt must not silently change when the customer profile is edited.
ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS buyer_snapshot jsonb;
ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS buyer_snapshot_at timestamptz;
ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS buyer_snapshot_source text
  CHECK (buyer_snapshot_source IN ('checkout','reconstructed'));

-- Historical identity is reconstructed from today's profile, never backdated.
UPDATE billing_orders o SET
  buyer_snapshot=jsonb_build_object('name',c.name,'email',c.email,'contact_person',to_jsonb(c)->>'contact_person',
    'phone',to_jsonb(c)->>'phone','address',to_jsonb(c)->>'address','voen',to_jsonb(c)->>'voen'),
  buyer_snapshot_at=now(),buyer_snapshot_source='reconstructed'
FROM customers c WHERE c.id=o.customer_id AND o.buyer_snapshot IS NULL;

CREATE OR REPLACE FUNCTION billing_capture_buyer_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.buyer_snapshot IS DISTINCT FROM OLD.buyer_snapshot
       OR NEW.buyer_snapshot_at IS DISTINCT FROM OLD.buyer_snapshot_at
       OR NEW.buyer_snapshot_source IS DISTINCT FROM OLD.buyer_snapshot_source
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
      RAISE EXCEPTION 'Billing document buyer identity is immutable';
    END IF;
  ELSE
    SELECT jsonb_build_object('name',c.name,'email',c.email,'contact_person',to_jsonb(c)->>'contact_person',
      'phone',to_jsonb(c)->>'phone','address',to_jsonb(c)->>'address','voen',to_jsonb(c)->>'voen')
      INTO NEW.buyer_snapshot FROM customers c WHERE c.id=NEW.customer_id;
    NEW.buyer_snapshot_at=now();
    NEW.buyer_snapshot_source='checkout';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS billing_buyer_identity ON billing_orders;
CREATE TRIGGER billing_buyer_identity BEFORE INSERT OR UPDATE OF buyer_snapshot,buyer_snapshot_at,buyer_snapshot_source,customer_id
  ON billing_orders FOR EACH ROW EXECUTE FUNCTION billing_capture_buyer_identity();
