# Nut King Inventory & Distribution — Odoo 19 Community / Enterprise

Technical module: `nutking_inventory_distribution`  
Release: `19.0.1.0.1` alpha

## Purpose

One fully branded Nut King application for managing two independent inventories and the company’s distribution workflow:

- Raw Materials inventory
- Finished Goods inventory
- Trucks as mobile stock locations
- Customers, suppliers, drivers and distribution teams
- Truck loads, deliveries, returns and reconciliation
- Barcode/offline operations
- Management dashboards, analysis and PDF reports

There is **no Manufacturing app, BOM, production order or raw-material-to-finished-goods conversion**.

## What is included

- One Nut King application icon and branded workspace
- Independent Raw Materials and Finished Goods products and locations
- Proper Odoo stock movements for every completed operation
- Mandatory reasons and server-side role/workflow validation
- Distribution trips with truck, driver, team, route and planned customers
- Per-product loaded, delivered, returned, damaged and variance reconciliation
- Product-level stock-movement analysis and stock-on-truck reporting
- Offline installable PWA with local queue, projected balances and safe re-sync
- Idempotent external transaction IDs to prevent duplicate synchronization
- Branded operational PDFs

## Installation

1. Copy the top-level `nutking_inventory_distribution` folder into the Cloudpepper custom-addons repository.
2. Deploy/restart Odoo.
3. Update the Apps list.
4. Install **Nut King Inventory & Distribution**.
5. Keep a separate developer/system-administrator account.
6. Assign test users to the Nut King roles.
7. Complete `docs/STAGING_CHECKLIST.md` on a staging database.

Dependencies (`stock`, `contacts`, `mail`) install automatically.

## Offline application

Open `/nutking/offline` while online on an approved phone, tablet or warehouse computer. Install it from the browser. It downloads the user’s permitted operations and current operational data, stores scans in IndexedDB during an outage, and synchronizes automatically after connectivity returns.

The last synchronized balance plus the device’s own queued transactions is used for an additional offline stock check. The Odoo server remains the final authority and revalidates every transaction during sync.

## Important release boundaries

- Strict worker login redirection and complete hiding/protection of standard backend routes are intentionally deferred until the final phase.
- Native lot/serial traceability is not active in this alpha. The Batch/Lot Reference field is an operational text reference.
- The package has passed static validation but still requires a live Odoo 19 Community / Enterprise/Cloudpepper staging installation.

See:

- `docs/ARCHITECTURE.md`
- `docs/RELEASE_NOTES.md`
- `docs/STAGING_CHECKLIST.md`


### 19.0.1.0.1 correction

This staging revision removes invalid Odoo stock-location XML references, adds a Nut King-owned adjustment location, improves company-safe truck location handling, and applies the supplied Nut King wordmark design to the app icon and branded interfaces.

## Odoo 19 contact compatibility

Customer and supplier mobile numbers use the module-owned `nutking_mobile` field because the Odoo 19 base `res.partner` model does not provide a standard `mobile` field.
