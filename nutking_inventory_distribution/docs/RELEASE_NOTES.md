# Nut King Inventory & Distribution — Release Notes

## 19.0.4.0.0 — Full operation lifecycle and printing

- Adds Draft, Confirmed, Completed, and Cancelled controls to the Nut King Operations workspace.
- Rapid Scan review now offers Save Draft, Confirm, and Complete without sending workers into the Odoo administration interface.
- Adds operation review actions for existing synchronized and device records.
- Adds Cancel and Return to Draft for eligible operations.
- Completed operations post official inventory through the existing Odoo stock-picking process.
- Offline completion is saved as a device action and becomes official only after successful synchronization.
- Projected device stock now reflects completed pending actions rather than unconfirmed drafts.
- Adds official Nut King PDF printing for synchronized records.
- Adds branded provisional/device printing while offline or before synchronization.
- Adds server-side print access controls and serialized print URLs.
- Retains physical inventory application from the Nut King Operations workspace.
- Updates workspace, service-worker, reset, and IndexedDB versions to v0.4.0.


## 19.0.3.3.0 — Rapid Scan review fix

- Fixed the Rapid Scan **Review Draft** error: `Cannot set properties of null (setting 'hidden')`.
- Review action buttons are now rendered before they are used and are handled through the existing delegated click listener.
- Dynamically rendered review Close buttons now work through the same delegated handler.
- Added a clear fallback error if the review-action container is ever missing from the workspace.
- Bumped all offline workspace asset paths and the service-worker cache to v0.3.3.


## 19.0.3.2.0 — Inventory product autocomplete

- Adds Odoo-style product suggestions after the first three letters or digits.
- Searches the synchronized inventory by product name, internal reference, barcode, and pack size.
- Restricts suggestions to Raw Materials or Finished Goods according to the selected operation.
- Shows projected available quantity in each suggestion.
- Supports mouse/touch selection and keyboard navigation with Up, Down, Enter, and Escape.
- Preserves one-scan barcode behaviour: an exact barcode followed by Enter immediately adds the line.
- Adds the same autocomplete experience to Physical Inventory rapid counting.
- Versions workspace assets and the service-worker cache to prevent stale browser files.

## 19.0.3.1.0 — Workspace boot and button fix

- Uses versioned JavaScript and CSS URLs to bypass stale browser/service-worker assets.
- Registers an explicitly versioned service worker.
- Adds visible startup diagnostics and reload recovery.
- Retains the full v0.3.0 offline-first workspace.

## 19.0.3.0.0 — Full offline-first worker workspace

- Replaced the worker entry point with a standalone Nut King PWA at `/nutking/`.
- Removed dependence on the standard Odoo web-client shell for worker operations.
- Added service-worker application-shell caching and an IndexedDB operational snapshot.
- Added offline navigation for dashboard, both inventories, distribution, physical inventory, operations, contacts, reports, and synchronization.
- Added projected device balances that include unsynchronized local actions.
- Added offline stock-operation, physical-inventory, distribution-trip, and workflow-action queues.
- Added idempotent server synchronization with unique external transaction IDs.
- Added server conflict checks and synchronization exception reporting.
- Added offline physical counts that apply through Odoo's native stock-quant inventory adjustment mechanism.
- Added role-filtered bootstrap data and interface navigation.
- Added a developer-only Nut King Administration application for staging and recovery.
- Changed the Nut King application root and Rapid Scan actions to open the offline-first workspace.
- Added stock-operation external references and richer synchronization logs.
- Retained the exact supplied Nut King logo and all prior Odoo 19 compatibility fixes.

## 19.0.2.0.0 — Rapid Scan and Physical Inventory

- Added Rapid Receive and Rapid Issue for both warehouses.
- Added native Raw Materials and Finished Goods Physical Inventory menus.

## Earlier fixes

- Odoo 19 location XML-ID compatibility.
- Odoo 19 contact mobile-field compatibility.
- Odoo 19 search-view compatibility.
- Non-searchable `stock.quant.available_quantity` domain removal.
- Nut King app visibility and original-logo refresh.
