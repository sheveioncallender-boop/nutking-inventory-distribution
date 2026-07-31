# Nut King Inventory & Distribution — Release Notes

## 19.0.2.0.0 — Rapid Scan and native Physical Inventory

- Added Rapid Receive and Rapid Issue actions under both Raw Materials and Finished Goods.
- Added a unified, branded rapid barcode workspace for online and offline operation.
- Barcode or typed product selection can populate lines; scanning the same product/batch repeatedly increases its quantity.
- Added operation-aware supplier, customer, movement reason, distribution trip and truck choices.
- **Save & Review** now creates an Odoo Nut King stock operation in Draft and opens the detailed review form when online.
- Offline rapid scans remain as device drafts and synchronize into Odoo as Draft operations rather than changing stock immediately.
- Added a dedicated **Issue Finished Goods** operation and controlled issued-finished-goods location.
- Added Raw Materials and Finished Goods Physical Inventory menu entries.
- Both Physical Inventory entries call Odoo 19's native `stock.quant` counting workflow, scoped to the correct Nut King location and product type.
- Native Counted, Difference, Apply, Clear and History behavior is preserved.
- Warehouse roles receive the model permissions needed for the native count without being granted the standard Inventory application role.
- Expanded offline cached views for raw stock, finished stock, customers, suppliers, trucks, trips, recent operations and the synchronization queue.
- Retained the exact original Nut King logo and all prior Odoo 19 compatibility corrections.

## 19.0.1.0.5 — Application visibility and original-logo cache fix

- Automatically grants Nut King Management access to Odoo Settings administrators during staging.
- Makes the top-level Nut King application visible to developer administrators.
- Changes the app-menu icon path so Odoo refreshes previously cached icon data.
- Uses a lossless, uncropped conversion of the exact supplied Nut King logo for the Apps catalogue.
- Removes the obsolete crown placeholder asset.

## 19.0.1.0.4

- Removed the stock search filter that used Odoo 19 `stock.quant.available_quantity`.
- `available_quantity` remains visible in stock lists and totals, but is not used in a domain because it is computed without a search method.
- Added a validation check that rejects search/action domains using known non-searchable fields.
# Release 19.0.1.0.4

- Updated all custom search views to the Odoo 19 search schema.
- Removed legacy `group expand="0" string="Group By"` wrappers.
- Added mandatory unique names to all search filters.
- Removed optional customer/supplier rank defaults that are outside the module dependency set.
- Replaced all redrawn placeholder branding with the exact original Nut King logo supplied by the client.


## 19.0.1.0.2 — Odoo 19 contact-field compatibility

- Replaced the unavailable Odoo 19 `res.partner.mobile` field with the module-owned `nutking_mobile` field.
- Updated both Nut King customer and raw-material supplier forms.
- Preserved the standard Odoo `phone` field and added a separate Nut King mobile-number field.
- Revalidated the package after the failed Enterprise installation.

## 19.0.1.0.1 — Odoo 19 location and branding correction

- Removed the invalid `stock.stock_location_locations` parent reference that blocked installation on Odoo 19.
- Removed the unsafe `stock.stock_location_inventory` dependency.
- Added a dedicated Nut King inventory-adjustment location.
- Corrected company assignment on Nut King stock operation types.
- Replaced the placeholder crown icon with branding based on the supplied original Nut King logo.
