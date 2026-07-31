# Nut King Inventory & Distribution — Staging Checklist

Use a new Odoo 19 Community / Enterprise staging database. Do not test first on a live production database.

## 1. Installation

- [ ] Add the module folder to the Cloudpepper custom-addons repository.
- [ ] Deploy/restart the Odoo service.
- [ ] Update the Apps list.
- [ ] Install **Nut King Inventory & Distribution**.
- [ ] Confirm the original Nut King wordmark app icon and dashboard load without an RPC error.
- [ ] Confirm Inventory, Contacts and Mail dependencies install automatically on Odoo 19 Community or Enterprise.

## 2. Developer safeguard

- [ ] Keep one separate administrator account in `base.group_system`.
- [ ] Do not activate strict staff login redirection yet.
- [ ] Confirm the administrator can still open Settings, Inventory and Technical menus.
- [ ] Create separate test users for every Nut King role; never test role permissions using the administrator account.

## 3. Master data

- [ ] Create at least two Raw Material products with unique barcodes.
- [ ] Create at least three Finished Good products with unique barcodes.
- [ ] Use a consistent distribution unit of measure for finished goods (normally cases) so truck totals are meaningful.
- [ ] Create one supplier and two distribution customers.
- [ ] Create a driver, distribution team members, warehouse clerks and supervisor staff records.
- [ ] Create two trucks and confirm each receives its own Nut King stock location.
- [ ] Review movement reasons and supervisor-required reasons.

## 4. Raw Materials workflow

- [ ] Receive raw material from a supplier and confirm stock increases.
- [ ] Issue raw material with a mandatory reason and confirm stock decreases.
- [ ] Test supplier return, damaged material and expired material.
- [ ] Attempt an issue larger than available stock and confirm it is blocked.
- [ ] Attempt a raw-material operation with a finished-good product and confirm it is blocked.
- [ ] Confirm the generated Odoo transfer is linked to the Nut King operation.

## 5. Finished Goods workflow

- [ ] Add finished goods independently; confirm no raw-material movement is created.
- [ ] Record warehouse damage and confirm stock moves to the damaged location.
- [ ] Test a customer return and confirm it enters the Customer Returns location, not saleable stock.
- [ ] Attempt a finished-goods operation with a raw-material product and confirm it is blocked.

## 6. Distribution workflow

- [ ] Create a trip with truck, driver, team, route and planned customers.
- [ ] Confirm the same truck cannot be assigned to two open trips.
- [ ] Load the truck and confirm stock moves from Finished Goods to that truck.
- [ ] Confirm departure is blocked until a completed load exists.
- [ ] Depart the trip and record deliveries to specific customers.
- [ ] Record unsold truck returns.
- [ ] Start reconciliation and verify loaded, delivered, returned, damaged and variance quantities by product.
- [ ] Confirm a trip with unexplained variance cannot close without supervisor approval.
- [ ] Confirm the truck becomes Available after trip closure.

## 7. Role and security tests

- [ ] Raw Materials Clerk cannot process finished-goods or distribution operations.
- [ ] Finished Goods Clerk cannot process raw-material issues.
- [ ] Distribution user cannot perform supervisor adjustments.
- [ ] Supervisor can approve required reasons and trip variances.
- [ ] Management can access reports and configuration.
- [ ] Users see only Nut King products and Nut King-generated stock records through the custom app.
- [ ] Company record rules are respected if the database contains more than one company.

## 8. Offline/PWA tests

- [ ] Open `/nutking/offline` while online and install the app on an approved device.
- [ ] Confirm only operations permitted by the logged-in role are displayed.
- [ ] Scan a valid product barcode online.
- [ ] Turn off Wi-Fi/mobile data and record multiple transactions.
- [ ] Refresh the normal page and confirm the cached app reopens.
- [ ] Confirm queued transactions remain after closing and reopening the installed PWA.
- [ ] Confirm the device blocks stock-outs above its last synchronized balance plus queued scans.
- [ ] Restore internet and confirm transactions synchronize once only.
- [ ] Retry synchronization and confirm duplicate stock movements are not created.
- [ ] Create a deliberate server conflict and confirm it appears in Offline Synchronization for supervisor review.
- [ ] Test two offline devices against the same stock and confirm server conflict handling.
- [ ] Test the actual USB/Bluetooth scanners that Nut King will use.

## 9. Reports and documents

- [ ] Verify Raw Materials, Finished Goods and Stock on Trucks reports.
- [ ] Verify Stock Movement Analysis by product, operation and month.
- [ ] Verify Distribution Performance graph and pivot.
- [ ] Print a Stock Operation document.
- [ ] Print a Trip Reconciliation document.
- [ ] Confirm logo, company information, page breaks and quantities render correctly in PDF.

## 10. Deferred final phase

Only after all tests pass:

- [ ] Build and activate the dedicated Nut King staff login.
- [ ] Redirect workers directly to their role dashboard.
- [ ] Remove standard app switcher/backend navigation from worker sessions.
- [ ] Add server-side route protection for workers.
- [ ] Verify the protected developer administration route and account.
- [ ] Complete production backup, recovery and device-registration procedures.
