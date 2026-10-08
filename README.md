# SAMAD Sourcing Agency — Full-Stack E-Commerce Store

A client-ready **e-commerce MVP / production foundation** for SAMAD Sourcing Agency (China → Ghana). The store has one supplier: SAMAD Sourcing Agency.

## Included
- Responsive storefront inspired by the supplied SuperMarket template
- SAMAD logo/branding and Ghana contact details
- Product catalog, search, category filtering, sorting, product details
- Shopping cart and checkout
- Customer registration/login and order history
- Admin login with expiring bearer session
- Admin dashboard: products, inventory, visibility, orders, revenue and low-stock indicators
- Product image upload from the owner's computer (JPG/PNG/WEBP, 8MB max)
- Add/edit/archive products without touching code
- Order status workflow and stock restoration when an order is cancelled
- PostgreSQL persistence for products, customers, inventory, and orders
- One-time transactional import of the existing `data/store.json` catalog

## Run locally
1. Install Node.js 18+ and PostgreSQL 14+.
2. Start PostgreSQL and create a database, for example `createdb samad_store`.
   - On macOS with Homebrew: `brew install postgresql@17`, then `brew services start postgresql@17`.
   - Homebrew's default local setup can connect over its Unix socket with your macOS account name in the URL, for example `postgresql://YOUR_MACOS_USERNAME@localhost:5432/samad_store?host=%2Ftmp`.
3. Copy `.env.example` to `.env` and set `DATABASE_URL` to a connection string for your database user. Managed services provide this URL and may require `DATABASE_SSL=true`.
4. Open a terminal in `samad-store` and run `npm install`.
5. Run `npm start`. On its first start, the app creates the database tables and imports products, customers, and orders from `data/store.json` when that file is present.
6. Open `http://localhost:3000`; the admin dashboard is at `http://localhost:3000/admin`.

The JSON file is only used for that one-time initial import. Afterward, all application data reads and writes use PostgreSQL. The import is recorded in `schema_migrations` and will not overwrite live database data on later starts. Back up PostgreSQL regularly.

For a managed PostgreSQL service, use its connection string in `DATABASE_URL`. Set `DATABASE_SSL=true` when the provider requires TLS; leave certificate verification enabled unless the provider specifically requires otherwise.

## Admin login for this packaged demo
- Email: `admin@samadsourcing.com`
- Password: `ChangeMe123!`

**Change these credentials before any public deployment.** Set `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, and a long random `SESSION_SECRET` in your environment. See `.env.example` for the hash format.

## Important production notes
This package is a strong functional client/demo foundation, but real public deployment should still use a managed database, HTTPS, automated backups, real payment-gateway credentials, transactional email/SMS/WhatsApp notifications, server-side rate limiting/WAF, and a proper cloud storage service for product images. Do not use the demo credentials in production.

## Temporary Render deployment

1. Push this folder to a private GitHub repository. Do not commit a `.env` file or real secrets.
2. In Render, create a PostgreSQL database for testing and copy its **Internal Database URL** into the web service environment variable `DATABASE_URL`.
3. Create a Render **Web Service** from the GitHub repository.
4. Build command: `npm install`
5. Start command: `npm start`
6. Add these environment variables in Render: `DATABASE_URL`, `DATABASE_SSL=true`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, and `SESSION_SECRET`.
7. Generate `ADMIN_PASSWORD_HASH` locally using the command in `.env.example`. Generate a fresh `SESSION_SECRET` with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
8. Deploy and open the Render URL. Test `/api/health`, the storefront, `/admin`, customer registration/login, product management, and orders.

### Important for this temporary test

- The Render free web service can sleep when idle, so the first request after inactivity may be slow.
- A free Render Postgres database is temporary and should not be treated as production storage.
- Product images uploaded through the current admin page are stored on the web service filesystem. Render's filesystem is ephemeral on the standard service, so uploaded images should later be moved to persistent object storage for production.
- The included `data/store.json` contains the current 511-product catalog and is imported once into PostgreSQL on first startup. It contains no users or orders in this package.
