require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  pool,
  initializeDatabase,
  productValues,
  userValues,
  orderValues,
  productFromRow,
  userFromRow,
  orderFromRow
} = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@samadsourcing.com').toLowerCase();
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const sessions = new Map();

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function money(n) { return Number(n || 0); }
function id(prefix) { return prefix + crypto.randomBytes(6).toString('hex'); }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    if (!salt || !hash) return false;
    const test = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
  } catch {
    return false;
  }
}
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}
function verifyToken(token) {
  try {
    const [body, signature] = String(token || '').split('.');
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    if (!body || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}
function admin(req, res, next) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!verifyToken(token)) return res.status(401).json({ error: 'Admin session expired. Please sign in again.' });
  next();
}
function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, phone: user.phone || '', createdAt: user.createdAt };
}
function sanitizeProductInput(body, existing = {}) {
  return {
    name: String(body.name ?? existing.name ?? '').trim(),
    category: String(body.category ?? existing.category ?? '').trim(),
    brand: String(body.brand ?? existing.brand ?? '').trim(),
    subcategory: String(body.subcategory ?? existing.subcategory ?? '').trim(),
    price: money(body.price ?? existing.price),
    oldPrice: money(body.oldPrice ?? existing.oldPrice ?? body.price ?? existing.price),
    stock: Math.max(0, Number(body.stock ?? existing.stock ?? 0)),
    rating: Math.min(5, Math.max(0, Number(body.rating ?? existing.rating ?? 5))),
    image: String(body.image ?? existing.image ?? '').trim(),
    description: String(body.description ?? existing.description ?? '').trim(),
    badge: String(body.badge ?? existing.badge ?? '').trim(),
    featured: body.featured === undefined ? Boolean(existing.featured ?? true) : Boolean(body.featured),
    isNew: body.isNew === undefined ? Boolean(existing.isNew ?? false) : Boolean(body.isNew),
    flashSale: body.flashSale === undefined ? Boolean(existing.flashSale ?? false) : Boolean(body.flashSale),
    sampleListing: body.sampleListing === undefined ? Boolean(existing.sampleListing ?? false) : Boolean(body.sampleListing),
    sku: String(body.sku ?? existing.sku ?? '').trim(),
    variants: Array.isArray(body.variants) ? body.variants : (existing.variants || [])
  };
}
function escapeLike(value) { return value.replace(/[\\%_]/g, '\\$&'); }

app.get('/api/health', asyncRoute(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true, service: 'SAMAD Sourcing Agency Store', version: '2.0.0', database: 'postgres' });
}));

app.get('/api/products', asyncRoute(async (req, res) => {
  const conditions = ['active = true'];
  const values = [];
  const addCondition = (sql, value) => {
    values.push(value);
    conditions.push(sql.replace('?', `$${values.length}`));
  };
  const query = String(req.query.q || '').trim();
  const category = String(req.query.category || '').trim();
  const brand = String(req.query.brand || '').trim();
  const subcategory = String(req.query.subcategory || '').trim();
  const sort = String(req.query.sort || 'featured');

  if (query) addCondition(
    "(name || ' ' || category || ' ' || description || ' ' || sku) ILIKE ? ESCAPE '\\'",
    `%${escapeLike(query)}%`
  );
  if (category && category.toLowerCase() !== 'all') addCondition('category ILIKE ? ESCAPE \'\\\'', escapeLike(category));
  if (brand) addCondition('brand ILIKE ? ESCAPE \'\\\'', escapeLike(brand));
  if (subcategory) addCondition('subcategory ILIKE ? ESCAPE \'\\\'', escapeLike(subcategory));
  if (sort === 'new') conditions.push("(is_new = true OR badge = 'NEW')");
  if (sort === 'flash') conditions.push("(flash_sale = true OR badge = 'SALE')");

  const orderBy = {
    'price-asc': 'price ASC, created_at DESC',
    'price-desc': 'price DESC, created_at DESC',
    rating: 'rating DESC, created_at DESC'
  }[sort] || 'featured DESC, created_at DESC';
  const result = await pool.query(
    `SELECT * FROM products WHERE ${conditions.join(' AND ')} ORDER BY ${orderBy}`,
    values
  );
  const products = result.rows.map(productFromRow);
  res.json({ products, total: products.length });
}));

app.get('/api/products/:id', asyncRoute(async (req, res) => {
  const result = await pool.query('SELECT * FROM products WHERE id = $1 AND active = true', [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Product not found' });
  res.json(productFromRow(result.rows[0]));
}));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const { name, email, password, phone } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const user = {
    id: id('usr_'),
    name: String(name).trim(),
    email: String(email).trim().toLowerCase(),
    phone: String(phone || '').trim(),
    password: hashPassword(password),
    createdAt: new Date().toISOString()
  };
  const result = await pool.query(
    `INSERT INTO users (id, name, email, phone, password_hash, created_at, extra)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,
    userValues(user)
  );
  res.status(201).json({ message: 'Account created.', user: publicUser(userFromRow(result.rows[0])) });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body || {};
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [String(email || '').trim().toLowerCase()]);
  const user = result.rowCount ? userFromRow(result.rows[0]) : null;
  if (!user || !verifyPassword(String(password || ''), user.password)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  res.json({ message: 'Login successful.', user: publicUser(user) });
}));

app.get('/api/auth/orders/:userId', asyncRoute(async (req, res) => {
  const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [req.params.userId]);
  if (!userResult.rowCount) return res.status(404).json({ error: 'Customer not found.' });
  const result = await pool.query(
    "SELECT * FROM orders WHERE lower(customer->>'email') = $1 ORDER BY created_at DESC",
    [userResult.rows[0].email.toLowerCase()]
  );
  res.json({ orders: result.rows.map(orderFromRow) });
}));

app.post('/api/orders', asyncRoute(async (req, res) => {
  const { customer, items, paymentMethod, notes, userId } = req.body || {};
  if (!customer?.name || !customer?.phone || !customer?.address) {
    return res.status(400).json({ error: 'Name, phone and delivery address are required.' });
  }
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Your cart is empty.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (userId) {
      const userResult = await client.query('SELECT id FROM users WHERE id = $1', [userId]);
      if (!userResult.rowCount) throw new HttpError(400, 'Customer account not found.');
    }

    const quantities = new Map();
    for (const item of items) {
      const quantity = Number(item.quantity || 1);
      if (!Number.isInteger(quantity) || quantity < 1) throw new HttpError(400, 'Product quantities must be whole numbers greater than zero.');
      quantities.set(item.productId, (quantities.get(item.productId) || 0) + quantity);
    }

    const locked = await client.query(
      'SELECT * FROM products WHERE id = ANY($1::text[]) AND active = true ORDER BY id FOR UPDATE',
      [[...quantities.keys()]]
    );
    const products = new Map(locked.rows.map(row => [row.id, productFromRow(row)]));
    const normalizedItems = [];
    for (const item of items) {
      const product = products.get(item.productId);
      if (!product) throw new HttpError(400, `Product ${item.productId} is unavailable.`);
      const quantity = Number(item.quantity || 1);
      if (quantities.get(item.productId) > product.stock) {
        throw new HttpError(400, `Only ${product.stock} of ${product.name} are currently available.`);
      }
      normalizedItems.push({
        productId: product.id,
        name: product.name,
        price: product.price,
        quantity,
        image: product.image,
        sku: product.sku || ''
      });
    }

    const subtotal = normalizedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const shipping = subtotal >= 1000 ? 0 : 40;
    const now = new Date().toISOString();
    const order = {
      id: id('SAM_'),
      userId: userId || null,
      customer,
      items: normalizedItems,
      subtotal,
      shipping,
      total: subtotal + shipping,
      paymentMethod: paymentMethod || 'Mobile Money',
      paymentStatus: 'Pending',
      notes: String(notes || ''),
      status: 'Pending',
      createdAt: now,
      updatedAt: now
    };

    for (const [productId, quantity] of quantities) {
      await client.query('UPDATE products SET stock = stock - $2, updated_at = now() WHERE id = $1', [productId, quantity]);
    }
    const values = orderValues(order);
    const saved = await client.query(
      `INSERT INTO orders (
        id, user_id, customer, items, subtotal, shipping, total, payment_method,
        payment_status, notes, status, created_at, updated_at, extra
      ) VALUES (
        $1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb
      ) RETURNING *`,
      values
    );
    await client.query('COMMIT');
    const savedOrder = orderFromRow(saved.rows[0]);
    res.status(201).json({
      message: 'Order placed successfully.',
      order: { id: savedOrder.id, total: savedOrder.total, status: savedOrder.status }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/admin/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (email !== ADMIN_EMAIL || !verifyPassword(password, ADMIN_PASSWORD_HASH)) {
    return res.status(401).json({ error: 'Invalid admin email or password.' });
  }
  const token = signToken({ sub: ADMIN_EMAIL, role: 'admin', exp: Date.now() + 8 * 60 * 60 * 1000 });
  sessions.set(token, true);
  res.json({ token, expiresIn: 28800, admin: { email: ADMIN_EMAIL } });
});

app.post('/api/admin/logout', admin, (req, res) => {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  sessions.delete(token);
  res.json({ ok: true });
});

app.get('/api/admin/summary', admin, asyncRoute(async (req, res) => {
  const result = await pool.query(`
    SELECT
      (SELECT count(*) FROM products) AS products,
      (SELECT count(*) FROM products WHERE active = true) AS active_products,
      (SELECT count(*) FROM orders) AS orders,
      (SELECT count(*) FROM users) AS customers,
      (SELECT coalesce(sum(total), 0) FROM orders WHERE status <> 'Cancelled') AS revenue,
      (SELECT count(*) FROM orders WHERE status = 'Pending') AS pending,
      (SELECT count(*) FROM products WHERE stock <= 5) AS low_stock
  `);
  const summary = result.rows[0];
  res.json({
    products: Number(summary.products),
    activeProducts: Number(summary.active_products),
    orders: Number(summary.orders),
    customers: Number(summary.customers),
    revenue: Number(summary.revenue),
    pending: Number(summary.pending),
    lowStock: Number(summary.low_stock)
  });
}));

app.get('/api/admin/orders', admin, asyncRoute(async (req, res) => {
  const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
  res.json({ orders: result.rows.map(orderFromRow) });
}));

app.get('/api/admin/products', admin, asyncRoute(async (req, res) => {
  const result = await pool.query('SELECT * FROM products ORDER BY created_at DESC, id');
  res.json({ products: result.rows.map(productFromRow) });
}));

app.post('/api/admin/uploads', admin, (req, res) => {
  const { data, filename } = req.body || {};
  if (typeof data !== 'string' || !data.startsWith('data:image/')) return res.status(400).json({ error: 'Please upload a valid image.' });
  const match = data.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: 'Only PNG, JPG and WEBP images are supported.' });
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'Image must be 8MB or smaller.' });
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const safe = String(filename || 'product').replace(/[^a-z0-9_-]/gi, '-').slice(0, 50);
  const file = `${Date.now()}-${safe}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), buffer);
  res.status(201).json({ url: `/uploads/${file}` });
});

app.post('/api/admin/products', admin, asyncRoute(async (req, res) => {
  const data = sanitizeProductInput(req.body || {});
  if (!data.name || !data.category || data.price <= 0) {
    return res.status(400).json({ error: 'Name, category and a price greater than zero are required.' });
  }
  const now = new Date().toISOString();
  const product = { id: id('p'), ...data, active: true, createdAt: now, updatedAt: now };
  const values = productValues(product);
  const result = await pool.query(
    `INSERT INTO products (
      id, name, category, brand, subcategory, price, old_price, rating, stock,
      image, description, badge, featured, is_new, flash_sale, sample_listing,
      sku, variants, active, created_at, updated_at, extra
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
      $18::jsonb,$19,$20,$21,$22::jsonb
    ) RETURNING *`,
    values
  );
  res.status(201).json(productFromRow(result.rows[0]));
}));

app.put('/api/admin/products/:id', admin, asyncRoute(async (req, res) => {
  const existingResult = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
  if (!existingResult.rowCount) return res.status(404).json({ error: 'Product not found.' });
  const existing = productFromRow(existingResult.rows[0]);
  const product = {
    ...existing,
    ...sanitizeProductInput(req.body || {}, existing),
    updatedAt: new Date().toISOString()
  };
  const values = productValues(product);
  const result = await pool.query(
    `UPDATE products SET
      name=$2, category=$3, brand=$4, subcategory=$5, price=$6, old_price=$7,
      rating=$8, stock=$9, image=$10, description=$11, badge=$12, featured=$13,
      is_new=$14, flash_sale=$15, sample_listing=$16, sku=$17, variants=$18::jsonb,
      active=$19, created_at=$20, updated_at=$21, extra=$22::jsonb
     WHERE id=$1 RETURNING *`,
    values
  );
  res.json(productFromRow(result.rows[0]));
}));

app.patch('/api/admin/products/:id/status', admin, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'UPDATE products SET active = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [req.params.id, req.body.active !== false]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Product not found.' });
  res.json(productFromRow(result.rows[0]));
}));

app.delete('/api/admin/products/:id', admin, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'UPDATE products SET active = false, updated_at = now() WHERE id = $1 RETURNING id',
    [req.params.id]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Product not found.' });
  res.json({ message: 'Product archived.' });
}));

app.patch('/api/admin/orders/:id', admin, asyncRoute(async (req, res) => {
  const allowed = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ error: 'Invalid order status.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!existing.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found.' });
    }
    const order = orderFromRow(existing.rows[0]);
    if (order.status !== 'Cancelled' && req.body.status === 'Cancelled') {
      for (const item of order.items) {
        await client.query(
          'UPDATE products SET stock = stock + $2, updated_at = now() WHERE id = $1',
          [item.productId, item.quantity]
        );
      }
    }
    const result = await client.query(
      `UPDATE orders SET status = $2, payment_status = coalesce($3, payment_status),
       updated_at = now() WHERE id = $1 RETURNING *`,
      [req.params.id, req.body.status, req.body.paymentStatus || null]
    );
    await client.query('COMMIT');
    res.json(orderFromRow(result.rows[0]));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.code === '23505' && error.constraint === 'users_email_key') {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
  console.error('Request failed:', error);
  res.status(500).json({ error: 'The request could not be completed.' });
});

async function start() {
  if (!ADMIN_PASSWORD_HASH) throw new Error('ADMIN_PASSWORD_HASH is required. Set it in Render environment variables.');
  if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required. Set it in Render environment variables.');
  await initializeDatabase();
  app.listen(PORT, () => console.log(`SAMAD Store running at http://localhost:${PORT} (PostgreSQL)`));
}

start().catch(async error => {
  console.error('Unable to start SAMAD Store:', error.message);
  await pool.end();
  process.exitCode = 1;
});

process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
