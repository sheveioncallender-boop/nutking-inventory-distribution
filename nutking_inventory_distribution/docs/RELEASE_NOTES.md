# Nut King Inventory & Distribution — Release Notes

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
