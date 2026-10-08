const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATA_FILE = path.join(__dirname, 'data', 'store.json');
const SCHEMA_FILE = path.join(__dirname, 'db', 'schema.sql');
const IMPORT_NAME = 'store-json-import-v1';
const PRODUCT_FIELDS = new Set([
  'id', 'name', 'category', 'brand', 'subcategory', 'price', 'oldPrice',
  'rating', 'stock', 'image', 'description', 'badge', 'featured', 'isNew',
  'flashSale', 'sampleListing', 'sku', 'variants', 'active', 'createdAt',
  'updatedAt'
]);
const USER_FIELDS = new Set(['id', 'name', 'email', 'phone', 'password', 'createdAt']);
const ORDER_FIELDS = new Set([
  'id', 'userId', 'customer', 'items', 'subtotal', 'shipping', 'total',
  'paymentMethod', 'paymentStatus', 'notes', 'status', 'createdAt', 'updatedAt'
]);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true'
    ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : undefined
});

function extraFields(record, knownFields) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !knownFields.has(key)));
}

function dateValue(value) {
  return value ? new Date(value) : new Date();
}

function productValues(product) {
  return [
    product.id,
    product.name,
    product.category,
    product.brand || '',
    product.subcategory || '',
    Number(product.price || 0),
    Number(product.oldPrice ?? product.price ?? 0),
    Number(product.rating ?? 5),
    Number(product.stock || 0),
    product.image || '',
    product.description || '',
    product.badge || '',
    product.featured ?? true,
    product.isNew ?? false,
    product.flashSale ?? false,
    product.sampleListing ?? false,
    product.sku || '',
    JSON.stringify(product.variants || []),
    product.active !== false,
    dateValue(product.createdAt),
    dateValue(product.updatedAt || product.createdAt),
    JSON.stringify(extraFields(product, PRODUCT_FIELDS))
  ];
}

function userValues(user) {
  return [
    user.id,
    user.name,
    String(user.email).trim().toLowerCase(),
    user.phone || '',
    user.password,
    dateValue(user.createdAt),
    JSON.stringify(extraFields(user, USER_FIELDS))
  ];
}

function orderValues(order) {
  return [
    order.id,
    order.userId || null,
    JSON.stringify(order.customer || {}),
    JSON.stringify(order.items || []),
    Number(order.subtotal || 0),
    Number(order.shipping || 0),
    Number(order.total || 0),
    order.paymentMethod || 'Mobile Money',
    order.paymentStatus || 'Pending',
    order.notes || '',
    order.status || 'Pending',
    dateValue(order.createdAt),
    dateValue(order.updatedAt || order.createdAt),
    JSON.stringify(extraFields(order, ORDER_FIELDS))
  ];
}

function productFromRow(row) {
  return {
    ...row.extra,
    id: row.id,
    name: row.name,
    category: row.category,
    brand: row.brand,
    subcategory: row.subcategory,
    price: Number(row.price),
    oldPrice: Number(row.old_price),
    rating: Number(row.rating),
    stock: row.stock,
    image: row.image,
    description: row.description,
    badge: row.badge,
    featured: row.featured,
    isNew: row.is_new,
    flashSale: row.flash_sale,
    sampleListing: row.sample_listing,
    sku: row.sku,
    variants: row.variants,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function userFromRow(row) {
  return {
    ...row.extra,
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    password: row.password_hash,
    createdAt: row.created_at.toISOString()
  };
}

function orderFromRow(row) {
  return {
    ...row.extra,
    id: row.id,
    userId: row.user_id,
    customer: row.customer,
    items: row.items,
    subtotal: Number(row.subtotal),
    shipping: Number(row.shipping),
    total: Number(row.total),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

async function importLegacyStore(client) {
  if (!fs.existsSync(DATA_FILE)) return;

  const legacy = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  for (const product of legacy.products || []) {
    const values = productValues(product);
    await client.query(
      `INSERT INTO products (
        id, name, category, brand, subcategory, price, old_price, rating, stock,
        image, description, badge, featured, is_new, flash_sale, sample_listing,
        sku, variants, active, created_at, updated_at, extra
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
        $18::jsonb,$19,$20,$21,$22::jsonb
      ) ON CONFLICT (id) DO NOTHING`,
      values
    );
  }
  for (const user of legacy.users || []) {
    const values = userValues(user);
    await client.query(
      `INSERT INTO users (id, name, email, phone, password_hash, created_at, extra)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (id) DO NOTHING`,
      values
    );
  }
  for (const order of legacy.orders || []) {
    const userResult = order.userId
      ? await client.query('SELECT 1 FROM users WHERE id = $1', [order.userId])
      : null;
    const values = orderValues({
      ...order,
      userId: userResult?.rowCount ? order.userId : null
    });
    await client.query(
      `INSERT INTO orders (
        id, user_id, customer, items, subtotal, shipping, total, payment_method,
        payment_status, notes, status, created_at, updated_at, extra
      ) VALUES (
        $1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb
      ) ON CONFLICT (id) DO NOTHING`,
      values
    );
  }
}

async function initializeDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. Set it in .env before starting the store.');
  }

  await pool.query(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('samad-store-db-init'))");
    const migration = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [IMPORT_NAME]);
    if (!migration.rowCount) {
      await importLegacyStore(client);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [IMPORT_NAME]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  initializeDatabase,
  productValues,
  userValues,
  orderValues,
  productFromRow,
  userFromRow,
  orderFromRow
};
