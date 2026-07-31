# Nut King Inventory & Distribution — v0.2.0 Staging Checklist

Use a staging database and keep a separate developer/system-administrator account.

## 1. Upgrade

- [ ] Replace the entire `nutking_inventory_distribution` folder in GitHub.
- [ ] Commit, push, redeploy and restart Odoo through Cloudpepper.
- [ ] Update the Apps list.
- [ ] Upgrade **Nut King Inventory & Distribution**.
- [ ] Sign out/in and hard-refresh.
- [ ] Confirm **Nut King Operations** is visible with the exact supplied logo.

## 2. Roles

- [ ] Create separate test users for Raw Materials Clerk, Finished Goods Clerk, Distribution Team, Supervisor and Management.
- [ ] Confirm Raw Materials Clerk sees its Rapid Receive, Rapid Issue and Physical Inventory menus.
- [ ] Confirm Finished Goods Clerk sees its Rapid Receive, Rapid Issue and Physical Inventory menus.
- [ ] Confirm warehouse clerks do not receive the standard Odoo Inventory application role merely to count stock.
- [ ] Confirm administrator access is retained.

## 3. Rapid Receive — Raw Materials

- [ ] Open Raw Materials → Rapid Receive.
- [ ] Scan a raw-material barcode.
- [ ] Scan it again and confirm the same line quantity increases.
- [ ] Type/select a product using its barcode, internal reference or name.
- [ ] Select a required Nut King supplier.
- [ ] Add batch/lot and expiration information where applicable.
- [ ] Choose Save & Review.
- [ ] Confirm the detailed Nut King operation opens in Draft with every line and header value.
- [ ] Confirm stock is unchanged while the record remains Draft.
- [ ] Confirm and process the record; verify Raw Materials stock increases.

## 4. Rapid Issue — Raw Materials

- [ ] Open Raw Materials → Rapid Issue.
- [ ] Select a valid raw-material movement reason.
- [ ] Confirm reasons that require notes enforce the note.
- [ ] Scan multiple products and edit a line quantity.
- [ ] Save & Review, then confirm and process.
- [ ] Verify Raw Materials stock decreases.
- [ ] Attempt to issue above available stock and confirm it is blocked.

## 5. Rapid Receive — Finished Goods

- [ ] Open Finished Goods → Rapid Receive.
- [ ] Scan only finished-good products.
- [ ] Confirm repeated scanning increments the existing line.
- [ ] Save & Review; confirm the operation opens in Draft.
- [ ] Confirm and process; verify Finished Goods stock increases independently of Raw Materials.

## 6. Rapid Issue — Finished Goods

- [ ] Open Finished Goods → Rapid Issue.
- [ ] Select the correct movement reason and optional customer where applicable.
- [ ] Save & Review, then confirm and process.
- [ ] Verify stock moves from Available Finished Goods to Issued Finished Goods.
- [ ] Attempt to issue above available stock and confirm it is blocked.

## 7. Native Physical Inventory — Raw Materials

- [ ] Open Raw Materials → Physical Inventory.
- [ ] Confirm the screen is Odoo’s normal editable Physical Inventory list.
- [ ] Confirm only the Available Raw Materials location is in scope.
- [ ] Confirm only raw-material products can be selected.
- [ ] Enter a Counted quantity and verify Difference calculates normally.
- [ ] Test Apply on one line.
- [ ] Test Apply All with an inventory reason/reference.
- [ ] Confirm Odoo creates the native inventory adjustment move and History is available.
- [ ] Confirm Finished Goods and truck balances are not changed.

## 8. Native Physical Inventory — Finished Goods

- [ ] Open Finished Goods → Physical Inventory.
- [ ] Confirm only the Available Finished Goods location is in scope.
- [ ] Confirm only finished-good products can be selected.
- [ ] Enter Counted quantities and verify Difference.
- [ ] Apply the adjustment and confirm the native stock move/history.
- [ ] Confirm Raw Materials and truck balances are not changed.

## 9. Offline Rapid Scan

- [ ] Open `/nutking/offline` online and allow the bootstrap data to download.
- [ ] Confirm raw and finished stock, customers, suppliers, trucks and trips display from the last sync.
- [ ] Disconnect the internet.
- [ ] Refresh/reopen the installed PWA and confirm the cached workspace loads.
- [ ] Create Raw Receive, Raw Issue, Finished Receive and Finished Issue drafts while offline.
- [ ] Confirm each appears in Sync Queue and survives app/browser closure.
- [ ] Confirm projected balances include that device’s waiting drafts.
- [ ] Restore internet and synchronize.
- [ ] Confirm each transaction creates exactly one Odoo Draft operation.
- [ ] Open the synchronized Draft, review, confirm and process it.
- [ ] Retry synchronization and confirm no duplicate draft or stock movement is created.

## 10. Regression

- [ ] Test truck loading, deliveries, returns and trip reconciliation.
- [ ] Verify customers, suppliers, products, staff and trucks still open correctly.
- [ ] Verify dashboards and reports.
- [ ] Print stock-operation and trip-reconciliation PDFs.
- [ ] Confirm no RPC error occurs during module upgrade or normal navigation.

## Deferred final phase

- [ ] Dedicated Nut King worker login.
- [ ] Direct role-dashboard routing.
- [ ] Complete worker backend and app-switcher lock-down.
- [ ] Registered-device administration and protected developer route.
