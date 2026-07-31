# Nut King Inventory & Distribution — Odoo 19 Community / Enterprise

Technical module: `nutking_inventory_distribution`  
Release: `19.0.2.0.0` staging alpha

## Purpose

One fully branded Nut King application for managing two independent inventories and the company’s distribution workflow:

- Raw Materials inventory
- Finished Goods inventory
- Native Odoo physical inventory for each warehouse
- Trucks as mobile stock locations
- Customers, suppliers, drivers and distribution teams
- Truck loads, deliveries, returns and reconciliation
- Rapid barcode scanning and offline draft synchronization
- Management dashboards, analysis and PDF reports

There is **no Manufacturing app, BOM, production order or raw-material-to-finished-goods conversion**.

## Rapid Scan workflow

The Raw Materials and Finished Goods menus each contain **Rapid Receive** and **Rapid Issue**.

1. Scan a barcode or type/select a product.
2. Enter a quantity, batch/lot reference and expiration date when applicable.
3. Scan the same product again to increase the existing line quantity.
4. Select the operation-specific supplier, customer, reason, truck or trip.
5. Choose **Save & Review**.
6. Online: Odoo creates and opens a Nut King stock operation in **Draft**.
7. Offline: the draft is retained on the device and created in Odoo when synchronization succeeds.
8. Review the normal Nut King draft form, then confirm and process it.

Inventory is not changed by Rapid Scan alone. Stock changes only when the reviewed operation is confirmed and processed.

## Physical Inventory

Each warehouse menu contains its own **Physical Inventory** entry:

- Raw Materials → Physical Inventory
- Finished Goods → Physical Inventory

These entries use Odoo 19’s native `stock.quant` physical-inventory screen and normal Counted, Difference, Apply and history behavior. Each action is restricted to the appropriate Nut King stock location and product type. It is not a separately invented counting model.

## Offline workspace

Open `/nutking/offline` while online on an approved phone, tablet or warehouse computer. The workspace downloads the user’s permitted operational data and current balances, stores rapid-scan drafts in IndexedDB during an outage, and synchronizes them automatically when connectivity returns.

Offline balances show the last synchronized server balance adjusted by drafts still waiting on that device. Odoo remains the final authority and validates every synchronized draft.

The native Odoo Physical Inventory screen is an online backend workflow in this release; it has not been replaced by a custom offline counting engine.

## Installation / upgrade

1. Replace the complete top-level `nutking_inventory_distribution` folder in the Cloudpepper-connected GitHub repository.
2. Commit and push.
3. Redeploy/restart Odoo.
4. Update the Apps list.
5. Because earlier versions are already installed, choose **Upgrade** for **Nut King Inventory & Distribution**.
6. Sign out and sign back in, then hard-refresh the browser.
7. Complete `docs/STAGING_CHECKLIST.md` on a staging database.

Dependencies (`stock`, `contacts`, `mail`) install automatically.

## Important release boundaries

- Strict worker login redirection and complete hiding/protection of standard backend routes remain intentionally deferred until the final phase.
- Native lot/serial traceability is not active. The Nut King Batch/Lot Reference is currently an operational text reference.
- The exact supplied Nut King logo is used for the application and branded workspace.
- The package has passed static validation but still requires a live Odoo 19 / Cloudpepper upgrade test.
