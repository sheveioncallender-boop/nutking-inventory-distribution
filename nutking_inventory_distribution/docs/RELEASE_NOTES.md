# Nut King Inventory & Distribution — Release Notes

## 19.0.5.0.2 — Rapid transfer usability fix

- Removed instructional helper text below the product scan field.
- Routine Raw Materials issues now follow Odoo's normal transfer flow without requiring a custom movement reason.
- Customer/company, supplier, and truck fields now use searchable Odoo-style autocomplete controls backed by synchronized records.
- Fixed Save Draft and Mark as Todo with direct, guarded handlers and visible errors.
- Product names now open the real Odoo product form while online and the cached Odoo-style product snapshot while offline.

## 19.0.5.0.1 — Odoo-native hybrid transfers

- Converts the four primary Rapid Scan warehouse operations to native Odoo `stock.picking` transfers.
- Replaces the previous parallel Draft/Confirmed/Completed workflow for new transfers with Odoo's natural Draft, Waiting, Ready, Done, and Cancelled states.
- Mirrors native actions: Mark as Todo, Check Availability, Detailed Operations, Validate, Return, Cancel, and Print.
- Keeps Rapid Scan as a faster data-entry layer rather than a separate stock engine.
- Adds dedicated Odoo operation types for raw receipts/issues, finished receipts, truck loading, customer delivery, and truck returns.
- Uses Odoo's native reservation, move-line, lot, package, validation, backorder, return, forecast, and history logic.
- Requires a truck for Finished Goods issues and allows an optional Odoo customer/company contact.
- Adds customer/company creation to the offline workspace using `res.partner`.
- Adds online links to the actual Odoo product form.
- Adds cached Odoo-style product details offline: On Hand, Free to Use, Incoming, Outgoing, Forecasted, locations/lots, Used By/reservations, and move history.
- Adds offline detailed source-location, lot, package, and quantity instructions.
- Revalidates every offline reservation/allocation against current Odoo stock during synchronization.
- Uses a separate technical synchronization indicator without inventing another business status.
- Makes child shelves/bins created below Nut King locations available to scoped offline stock details.
- Expands scoped Physical Inventory to the appropriate warehouse location tree.
- Retains legacy custom operations as audit-only records for previously created transactions.
- Updates workspace, service-worker, reset, and API versions to v0.5.1.

### Staging limitations

- A cached forecast is informational and may differ from current server stock while offline.
- Native Odoo reservation is official only after synchronization.
- Odoo may return Waiting, partial availability, a backorder dialog, or an error if server stock changed.
- Full management-report expansion is planned as the next reporting stage and is not the focus of v0.5.1.

## 19.0.4.1.0 — Button label update

- Renamed Developer View to Backend in the worker operation review.

## 19.0.4.0.0 — Full custom operation lifecycle

- Added full Draft, Confirmed, Completed, Cancelled and printing controls to the worker workspace.
- This workflow is retained only for legacy audit records after the v0.5.1 native-transfer conversion.

## Earlier releases

- v0.3.3 Rapid Scan review fix.
- v0.3.2 product autocomplete.
- v0.3.1 workspace boot/button fix.
- v0.3.0 full offline-first worker workspace.
- v0.2.0 Rapid Scan and Physical Inventory.
- Odoo 19 location, contact, search-view, quant-domain, app visibility, and original-logo fixes.

## v0.5.1 — Picking Type Compatibility Fix

- Fixes installation/upgrade on databases where an installed stock extension adds a required `restrict_put_in_pack` field to `stock.picking.type`.
- Supplies a safe default only when that field exists, preserving compatibility with Odoo 19 Community/core databases where it is absent.
- Applies to every Nut King native operation type created by the module.
