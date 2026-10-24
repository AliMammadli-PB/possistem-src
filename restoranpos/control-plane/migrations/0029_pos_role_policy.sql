-- Staff roles and permissions the owner sets on possistem.az, pulled by the till.
--
-- Until now a role could only be changed on the till itself, which is fine for
-- one shop and useless for ten: there was no way for head office to say "no
-- waiter may void an order" once, or for an owner away from the floor to fix a
-- permission over the phone.
--
-- The website is the master copy. `version` is bumped on every write and the
-- till compares it against its own `pos.rolePolicyVersion` setting, so an
-- unchanged policy costs one small read per heartbeat and no writes.
--
-- Additive only: creates one table, touches no existing row, drops nothing.
CREATE TABLE IF NOT EXISTS pos_role_policy (
  customer_id uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  -- [{ "name": "waiter", "permissions": ["order.view", ...] }]
  roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- 'customer' when the owner edited it in their portal, 'admin' when
  -- POSSISTEM support did it for them. Shown in the portal so an owner is never
  -- surprised by a change they did not make.
  updated_by_kind text NOT NULL DEFAULT 'customer'
    CHECK (updated_by_kind IN ('customer', 'admin')),
  updated_by uuid
);
