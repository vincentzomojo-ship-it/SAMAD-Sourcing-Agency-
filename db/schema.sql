CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  brand text NOT NULL DEFAULT '',
  subcategory text NOT NULL DEFAULT '',
  price numeric(12, 2) NOT NULL CHECK (price >= 0),
  old_price numeric(12, 2) NOT NULL DEFAULT 0 CHECK (old_price >= 0),
  rating numeric(3, 1) NOT NULL DEFAULT 5 CHECK (rating >= 0 AND rating <= 5),
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  image text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  badge text NOT NULL DEFAULT '',
  featured boolean NOT NULL DEFAULT true,
  is_new boolean NOT NULL DEFAULT false,
  flash_sale boolean NOT NULL DEFAULT false,
  sample_listing boolean NOT NULL DEFAULT false,
  sku text NOT NULL DEFAULT '',
  variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  extra jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS products_active_category_idx ON products (active, category);
CREATE INDEX IF NOT EXISTS products_active_brand_idx ON products (active, brand);
CREATE INDEX IF NOT EXISTS products_active_subcategory_idx ON products (active, subcategory);
CREATE INDEX IF NOT EXISTS products_created_at_idx ON products (created_at DESC);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  phone text NOT NULL DEFAULT '',
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  extra jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  customer jsonb NOT NULL DEFAULT '{}'::jsonb,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal numeric(12, 2) NOT NULL DEFAULT 0,
  shipping numeric(12, 2) NOT NULL DEFAULT 0,
  total numeric(12, 2) NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'Mobile Money',
  payment_status text NOT NULL DEFAULT 'Pending',
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  extra jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS orders_user_id_idx ON orders (user_id);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);
