# Nut King Inventory & Distribution — v0.3.0 Staging Checklist

## Upgrade

- [ ] Replace the complete module folder in GitHub.
- [ ] Commit, push, redeploy, and restart Odoo.
- [ ] Update the Apps List.
- [ ] Upgrade the installed Nut King module.
- [ ] Sign out, sign in, and hard-refresh once.
- [ ] Confirm **Nut King Operations** opens `/nutking/`.
- [ ] Confirm **Nut King Administration** is visible only to Settings administrators.

## First device synchronization

- [ ] Open `/nutking/` while online.
- [ ] Confirm the original Nut King logo appears.
- [ ] Press Synchronize and confirm a successful timestamp.
- [ ] Confirm products, quantities, reasons, contacts, trucks, trips, and operations are cached according to the user's role.
- [ ] Install the PWA on an approved device where supported.

## Offline shell

- [ ] Disconnect internet without closing the workspace.
- [ ] Confirm there is no Odoo “Connection lost” notification.
- [ ] Navigate through every permitted page.
- [ ] Refresh `/nutking/` while offline and confirm the workspace reopens.
- [ ] Close and reopen the installed PWA while offline.
- [ ] Confirm the Offline status, last synchronization time, and pending counter are clear.

## Rapid Scan

Test online and offline for:

- [ ] Receive Raw Materials.
- [ ] Issue Raw Materials.
- [ ] Receive Finished Goods.
- [ ] Issue Finished Goods.
- [ ] Scan the same barcode repeatedly and confirm one line increments.
- [ ] Type/search a product and edit quantity.
- [ ] Verify required supplier, customer, reason, trip, truck, lot, and notes rules.
- [ ] Save a Draft and review it.
- [ ] Confirm/Process according to the user's permission.
- [ ] Confirm insufficient projected stock is blocked.

## Distribution

- [ ] Create a trip online and offline.
- [ ] Load a truck.
- [ ] Depart the trip.
- [ ] Record customer deliveries offline.
- [ ] Record truck returns offline.
- [ ] Start reconciliation.
- [ ] Test zero variance.
- [ ] Test a variance requiring supervisor handling.
- [ ] Close the trip with the correct permission.

## Physical Inventory

For Raw Materials and Finished Goods:

- [ ] Open the count from the relevant warehouse page.
- [ ] Scan to increment a count.
- [ ] Enter counted quantities manually.
- [ ] Save and reopen a local count draft.
- [ ] Submit the count while offline.
- [ ] Reconnect and synchronize.
- [ ] Confirm Odoo applies the adjustment and inventory history is traceable.
- [ ] Change server stock before sync and confirm a conflict is rejected.
- [ ] Test supervisor-approved conflict handling.
- [ ] Compare results with the native Physical Inventory menu in Nut King Administration.

## Synchronization resilience

- [ ] Queue several mixed transactions offline.
- [ ] Refresh and confirm the queue remains.
- [ ] Reconnect and confirm automatic synchronization.
- [ ] Press Synchronize repeatedly and confirm no duplicates.
- [ ] Interrupt a synchronization and retry it.
- [ ] Confirm errors stay visible and can be retried.
- [ ] Confirm successful records receive official Odoo references.

## Role testing

- [ ] Raw Materials Clerk sees only permitted inventory/actions.
- [ ] Finished Goods Clerk sees only permitted inventory/actions.
- [ ] Distribution Team sees assigned logistics functionality.
- [ ] Supervisor sees review and control functionality.
- [ ] Management sees reports and all operational data.
- [ ] Settings administrator retains backend recovery access.

## Production gate

Do not activate the final separate staff login and `/web` lock-down until all checks above pass on multiple real devices and at least two simultaneous offline users.
