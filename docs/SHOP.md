# Ready-to-wear shop

The public homepage is the shop. Staff access the original workshop at `/staff`.
Customer shopping routes are `/products/<slug>`, `/cart`, `/checkout` and `/order`.
Shop Orders is inside Dashboard; admin product/settings controls are inside
Settings → Ready-to-wear Shop. The three mobile staff navigation icons remain.

## Prepare and launch

1. Back up PostgreSQL and the upload volume before deploying migration 09. Do not
   edit or replay historical migrations. The usual Node container, database and
   `/app/uploads` volume support the shop; no new provider credentials are needed.
2. In Settings → Ready-to-wear Shop, save the contact phone, MoMo number and account
   name, and pickup address/hours. Delivery within Ghana uses a staff-agreed quote.
3. Create products as drafts. Add title, URL name, description, category, GHS price,
   size guide and each size/colour/SKU combination. Enter physical on-hand stock.
   Save, upload PNG/JPEG/WebP photographs, then publish. Stock already allocated to
   orders cannot be removed. Fulfilment makes stale inventory edits fail.
4. Add a published piece to the bag. From Settings open **Admin test checkout**.
   Submit a test order and complete confirmation, a verified test receipt, Ready,
   and fulfilment through Shop Orders. Tests use real stock allocations: restore
   the test quantity afterward. These entries stay clearly marked TEST.
5. Reload saved shop settings and enable customer checkout. The server requires
   complete contact/payment/pickup details, a fulfilled test order, and a
   photographed, published product with available stock before opening checkout.

Do not use fake fixture details for a live shop. A new database starts with
checkout disabled and no products. Close checkout to pause new orders while
continuing existing fulfilment; hide the public collection for a full shop pause.

## Order operations

Guest orders hold chosen variants for 24 hours. Staff contact customers manually
and confirm the order before its deadline. Delivery orders require a fee in GHS,
including an explicit zero where agreed, and confirmation of the customer's
agreement. Confirmation retains the stock allocation and displays payment
instructions; it records no payment. Confirmed orders do not auto-expire.

Record actual MoMo receipts or cash at collection with amount, receipt date,
reference and notes. MoMo receipts require a reference. Receipt submissions are
idempotent and cannot exceed the unpaid balance. Delivery orders must be fully
paid before Ready; both delivery and pickup must be fully paid before dispatch or
collection. Fulfilment consumes the allocated quantity from physical stock once.

Cancellation releases unfulfilled stock once. Paid cancellations require an admin.
Admins correct incorrect receipts by appending reversals dated to the original
receipt, or record an actual externally completed refund. No control initiates
cash movement. Fulfilled orders cannot be cancelled; their receipt corrections
are blocked, while completed external refunds may still be recorded. Returns
remain a separate manual process. A refund/correction invalidates an unpaid
delivery's Ready status. Shop bookkeeping does not enter bespoke reports.

The minute maintenance job, startup maintenance and checkout/status/queue checks
release expired reservations safely across restarts. Availability also ignores
holds past their deadline before maintenance runs. Expired orders cannot receive
new receipts or be confirmed. Reconcile any late external payment with the
customer; place a fresh order with a fresh stock allocation, or return the money
outside the site. The site never assumes stock can be recovered.

## Privacy and interfaces

Private order links use `/order#<random-token>`. The fragment stays out of normal
server access logs and referrers. The status API receives the token in an
Authorization header; only its SHA-256 hash is stored in the database. Anyone
with the full private link can view that order, so customers should save it
privately. Customer accounts and automated SMS/email are not included.

Explicit `/api/shop/` endpoints serve the catalogue, public shop configuration,
published photographs, order submission and token-protected status. Admin
endpoints manage products, uploads, settings and test checkout. Staff endpoints
manage the queue and order operations. The existing generic workshop query API
never exposes shop tables; shop tables have RLS enabled with no policies for its
generic roles. Status, checkout and all shop API responses use no-store caching;
the service worker does not handle public shop page navigations or shop APIs.

Photographs are stored in the existing volume under `shop-products`, separately
from private workshop attachments. Unpublished image URLs cannot be accessed
publicly, including previously published photos. Removing metadata keeps image
bytes for later operational cleanup; no automatic permanent file deletion occurs.
Server-side validation recalculates prices and locks variants within the same
transaction as the order and stock allocation. A common transaction advisory
lock coordinates checkout, expiry, inventory edits and fulfilment in this small
shop. Requests never accept client totals, paid flags, status or expiry dates.

## Verification

`npm test` includes embedded PostgreSQL HTTP checks for shop launch, permissions,
idempotency, changed prices, last-item competition, quotes, receipts, cancellation,
expiry across handler restarts and corrections/refunds. CI also runs the same shop
suite against an empty, disposable PostgreSQL 16 service with separate connections.

For a dedicated empty test database only, set `SHOP_TEST_DATABASE_URL` (its database
name must contain `test`) and `ALLOW_DISPOSABLE_SMOKE_TEST=1`, then run
`npm run test:shop`. This suite refuses an already migrated database and never
resets or deletes existing database contents. Never point it at production.

For browser checks, start `node scripts/preview-postgres-ui.mjs` and `npm run dev`.
With Playwright available, set `ALLOW_SHOP_UI_FIXTURE=1` and run
`node scripts/check-shop-ui.mjs`. If using bundled Playwright, set
`SHOP_BROWSER_PACKAGE_JSON` to its package root's `package.json`. The script is
restricted to localhost and uses the documented fake fixture credentials. Start
a fresh fixture before repeating it. Screenshots go to `node_modules/.tmp/shop-ui`.

Check stock/payment queues after launch. Reservation maintenance errors are
reported in the server log; restart-safe API paths continue validating allocation
deadlines. Close checkout through shop settings while resolving any inventory issue.
