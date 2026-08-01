# Nut King Inventory & Distribution — v0.5.1 Staging Checklist

## Upgrade

- [ ] Replace the complete module folder in GitHub; do not merge selected files.
- [ ] Commit, push, redeploy, and restart Odoo.
- [ ] Update the Apps List.
- [ ] Upgrade the installed Nut King module.
- [ ] Open `/nutking/reset` once while online.
- [ ] Confirm the sidebar shows **Workspace v0.5.1**.
- [ ] Press Synchronize and confirm Odoo transfers, products, contacts, locations, lots, and move history download.

## Native transfer foundation

- [ ] Open Nut King Administration → Stock Transfers.
- [ ] Confirm new Rapid Scan records are native Odoo transfers.
- [ ] Confirm states are Draft, Waiting, Ready, Done, or Cancelled.
- [ ] Confirm Legacy Operation Audit remains available only for earlier custom records.

## Rapid Scan operations

Test each operation with a small quantity:

- [ ] Receive Raw Materials.
- [ ] Issue Raw Materials.
- [ ] Receive Finished Goods.
- [ ] Issue Finished Goods to Truck.
- [ ] Search for a product after three characters.
- [ ] Scan the same barcode repeatedly and confirm one demand line increases.
- [ ] Confirm product type is restricted to the correct warehouse.
- [ ] Confirm required supplier, reason, or truck validation.
- [ ] For Finished Goods to Truck, test with no customer as General Truck Stock.
- [ ] Repeat with an Odoo customer/company selected.

## Native Odoo states and buttons

For each applicable operation:

- [ ] Draft shows Mark as Todo, Validate, and Cancel as appropriate.
- [ ] Mark as Todo moves the official transfer to Waiting/Ready according to Odoo.
- [ ] Check Availability calls Odoo reservation and refreshes the state.
- [ ] Ready shows Validate and Print.
- [ ] Validate moves the official transfer to Done.
- [ ] Done shows Return and Print.
- [ ] Cancel behaves according to Odoo's native restrictions.
- [ ] No custom Confirmed/Completed business state appears on native transfers.
- [ ] A separate sync indicator appears only for unsynchronized device actions.

## Detailed operations and availability

- [ ] Create shelf/bin locations beneath Available Raw Materials or Available Finished Goods.
- [ ] Synchronize and confirm the child locations appear offline.
- [ ] Open Detailed Operations.
- [ ] Select a source location, lot, package where applicable, and quantity.
- [ ] Confirm only the configured source location and descendants are accepted.
- [ ] Run Check Availability and validate the selected allocation online.
- [ ] Repeat offline, reconnect, and confirm Odoo revalidates it.
- [ ] Change server stock before syncing and confirm the device cannot silently override Odoo.
- [ ] Test insufficient stock and confirm the transfer remains Waiting or returns a clear error/backorder requirement.

## Product details

- [ ] Click a product while online and open the real Odoo product form.
- [ ] Review Odoo Forecasted, Incoming, Outgoing, Locations, and Moves.
- [ ] Disconnect and click the product again.
- [ ] Confirm the cached product view shows On Hand, Free to Use, Incoming, Outgoing, Forecasted, locations/lots, Used By, and recent moves.
- [ ] Confirm the offline snapshot shows its last synchronization time.

## Customers and companies

- [ ] Open Contacts & Trucks.
- [ ] Create a company while online and confirm it is a normal Odoo Contact.
- [ ] Create a customer/company offline and synchronize it.
- [ ] Confirm a queued transfer can resolve the newly synchronized contact.
- [ ] Confirm Customer Delivery requires a customer/company.
- [ ] Confirm Finished Goods to Truck allows customer/company to remain optional.

## Offline transfer replay

- [ ] Complete the first synchronization.
- [ ] Disconnect internet.
- [ ] Create a native transfer Draft.
- [ ] Queue Mark as Todo.
- [ ] Queue Check Availability.
- [ ] Save Detailed Operations.
- [ ] Queue Validate.
- [ ] Refresh the page and confirm all queued actions remain.
- [ ] Reconnect and synchronize.
- [ ] Confirm actions replay in order on one official Odoo transfer.
- [ ] Repeat synchronization and confirm no duplicate transfer or stock movement.
- [ ] Test a backorder decision when demand exceeds processed quantity.
- [ ] Review any rejected action in Offline & Sync Status.

## Returns and printing

- [ ] Validate a transfer to Done.
- [ ] Print the official Odoo transfer document.
- [ ] Use Return and confirm Odoo creates the native return transfer.
- [ ] Return a partial quantity.
- [ ] Confirm move history links the return to the original movement.

## Physical Inventory

For both warehouses:

- [ ] Open Physical Inventory from Nut King Operations.
- [ ] Confirm products are scoped to the correct inventory type.
- [ ] Confirm the warehouse root and child shelves/bins are available.
- [ ] Enter Counted Quantity and review Difference.
- [ ] Apply the count and verify Odoo inventory history.
- [ ] Repeat offline and verify conflict handling at synchronization.

## Security and roles

- [ ] Raw Materials Clerk sees only authorized raw operations.
- [ ] Finished Goods Clerk sees authorized finished operations.
- [ ] Distribution Team sees authorized truck/delivery operations.
- [ ] Supervisor can use permitted override controls.
- [ ] Workers cannot edit arbitrary native stock pickings through backend permissions.
- [ ] Settings administrator retains Nut King Administration and recovery access.

## Production gate

Do not activate final staff login redirection or backend lock-down until this checklist passes on multiple real devices, including simultaneous offline transfers, source-location allocations, returns, backorders, and physical counts.
