# Nut King Inventory & Distribution — v0.4.0 Staging Checklist

## Upgrade

- [ ] Replace the complete module folder in GitHub.
- [ ] Commit, push, redeploy, and restart Odoo.
- [ ] Update the Apps List.
- [ ] Upgrade the installed Nut King module.
- [ ] Open `/nutking/reset` once while online.
- [ ] Confirm **Nut King Operations** opens `/nutking/`.
- [ ] Confirm **Nut King Administration** remains available only to Settings administrators.

## First device synchronization

- [ ] Open `/nutking/` while online.
- [ ] Confirm the original Nut King logo appears.
- [ ] Press Synchronize and confirm a successful timestamp.
- [ ] Confirm products, quantities, reasons, contacts, trucks, trips, and operations are cached according to the user's role.

## Full stock-operation lifecycle

Test all four Rapid Scan operations:

- [ ] Receive Raw Materials.
- [ ] Issue Raw Materials.
- [ ] Receive Finished Goods.
- [ ] Issue Finished Goods.
- [ ] Search after three characters and select a synchronized product.
- [ ] Scan the same barcode repeatedly and confirm one line increments.
- [ ] Review supplier/customer, reason, trip, truck, lot, expiration, and notes requirements.
- [ ] Save as Draft and confirm inventory is unchanged.
- [ ] Reopen the local Draft from Stock Operations.
- [ ] Edit the Draft and preserve its device identifier.
- [ ] Confirm the operation and verify inventory is still unchanged.
- [ ] Complete the operation and verify inventory changes only after successful server processing.
- [ ] Cancel an eligible Draft/Confirmed operation.
- [ ] Return a Cancelled operation to Draft.
- [ ] Confirm a Completed operation cannot be directly cancelled.
- [ ] Confirm insufficient projected/server stock is blocked.

## Online synchronized operation actions

- [ ] Open a server Draft in Nut King Operations and Confirm it.
- [ ] Complete a server Confirmed operation.
- [ ] Cancel a server Draft/Confirmed operation.
- [ ] Return a server Cancelled operation to Draft.
- [ ] Confirm the refreshed status and official reference appear without entering administration.

## Printing

- [ ] Print an official server Draft.
- [ ] Print an official Confirmed operation.
- [ ] Print an official Completed operation.
- [ ] Confirm the PDF includes the original Nut King logo, operation reference, status, products, quantities, party, truck/trip, reason, source/destination, and signatures.
- [ ] Print a local Draft/Confirmed operation and confirm it is marked as a device copy.
- [ ] Complete an operation offline, print it, and confirm it is marked provisional/waiting for synchronization.
- [ ] Synchronize and print the official server PDF.
- [ ] Confirm users cannot print another company's or unauthorized operation type.

## Offline lifecycle

- [ ] Complete an initial synchronization.
- [ ] Disconnect internet and confirm the Nut King shell remains functional.
- [ ] Create and save a Draft offline.
- [ ] Move it to Confirmed offline.
- [ ] Move it to Completed offline.
- [ ] Confirm projected stock changes only at Completed.
- [ ] Refresh and confirm the lifecycle and queue persist.
- [ ] Reconnect and synchronize.
- [ ] Confirm the official Odoo operation is created directly in the requested state.
- [ ] Repeat Synchronize and confirm no duplicate operation or stock movement.
- [ ] Queue lifecycle actions on an already synchronized operation while offline and verify they apply in order.

## Physical Inventory

For Raw Materials and Finished Goods:

- [ ] Open the count from the Operations workspace.
- [ ] Scan to increment a count.
- [ ] Enter counted quantities manually.
- [ ] Save and reopen a local count draft.
- [ ] Submit the count while offline.
- [ ] Reconnect and synchronize.
- [ ] Confirm Odoo applies the native inventory adjustment and inventory history is traceable.
- [ ] Change server stock before sync and confirm a conflict is rejected.
- [ ] Test supervisor-approved conflict handling.

## Distribution

- [ ] Create a trip online and offline.
- [ ] Load a truck and complete the stock operation.
- [ ] Depart the trip.
- [ ] Record customer deliveries offline.
- [ ] Record truck returns offline.
- [ ] Start reconciliation and close with proper variance control.

## Role testing

- [ ] Raw Materials Clerk sees only permitted operation types.
- [ ] Finished Goods Clerk sees only permitted operation types.
- [ ] Distribution Team sees permitted logistics operations.
- [ ] Supervisor can process supervisor-required reasons and physical-count conflicts.
- [ ] Management sees reports and all operational data.
- [ ] Settings administrator retains backend recovery access.

## Production gate

Do not activate the final separate staff login and `/web` lock-down until all checks pass on multiple real devices, including simultaneous offline users and official PDF printing.
