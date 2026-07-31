# Architecture

## User-facing application

All daily work is performed inside **Nut King Inventory & Distribution**. Standard Odoo models remain the reliable engine underneath, but Nut King menus, forms, rules and reports control the workflow.

## Core dependencies

- `stock`: products, quantities, stock locations, transfers and stock history.
- `contacts`: suppliers and distribution customers.
- `mail`: audit chatter and activities.

No `mrp`, `fleet` or `hr` application dependency is required. Trucks and staff are purpose-built Nut King models inside this module.

## Inventory paths

Raw Materials:

`Supplier → Available Raw Materials → Issued / Supplier / Damaged / Expired`

Finished Goods:

`Independent Stock Entry → Available Finished Goods → Truck → Customer or Return`

The two inventories do not create or consume each other.

## Offline path

`Installed PWA → IndexedDB queue → /nutking/api/sync → Nut King operation → Odoo stock transfer`

Each queued transaction has a unique external ID. The server accepts that ID once, validates the transaction, creates the proper movement, and returns a processing result. Rejected transactions remain visible for correction/supervisor review.

## Security phases

Phase 1 (this release): role groups, ACLs, record rules, server checks and custom menus.

Final phase (after staging): dedicated branded login, direct dashboard routing, worker backend-route protection, device registration and administrator escape route.
