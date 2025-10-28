WITH t AS (
  INSERT INTO tenants (name, slug)
  VALUES ('Burger Point', 'burgerpoint')
  RETURNING id
),
s AS (
  INSERT INTO stores (tenant_id, name)
  SELECT id, 'Burger Point - MG Road' FROM t
  RETURNING id, tenant_id
),
m AS (
  INSERT INTO menu_items (tenant_id, store_id, name, price_cents)
  SELECT tenant_id, id, 'Grilled Chicken Burger', 18900 FROM s
  RETURNING tenant_id, store_id
)
INSERT INTO kitchen_stations (tenant_id, store_id, name)
SELECT tenant_id, store_id, 'Grill Station' FROM m;
