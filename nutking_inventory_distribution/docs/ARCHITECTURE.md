# Nut King Inventory & Distribution Architecture

## User-facing application

Daily work is organized inside **Nut King Operations**. Standard Odoo models remain the reliable engine underneath, while Nut King menus, forms, permissions and server rules control the workflow.

## Core dependencies

- `stock`: products, quantities, locations, transfers, stock history and native physical inventory.
- `contacts`: suppliers and distribution customers.
- `mail`: audit chatter and activities.

No `mrp`, `fleet` or `hr` application dependency is required. Trucks and staff are purpose-built Nut King models inside this module.

## Independent inventory paths

Raw Materials:

`Supplier → Available Raw Materials → Issued / Supplier Return / Damaged / Expired`

Finished Goods:

`Independent Receipt → Available Finished Goods → General Issue or Truck → Customer / Return`

Raw Materials and Finished Goods never create or consume each other.

## Rapid Scan path

`Rapid Scan → Local review → Nut King operation in Draft → Detailed review form → Confirm → Process → Odoo stock transfer`

Repeated scans of the same product and batch are consolidated into one line by increasing its quantity. Online drafts open immediately in the detailed Nut King operation form. Offline drafts are queued locally and become Odoo Draft operations after synchronization.

## Native Physical Inventory path

`Raw/Finished menu → scoped server action → Odoo stock.quant Physical Inventory → Counted → Difference → Apply`

The module calls Odoo’s normal physical-inventory action and scopes the returned action to:

- the exact Nut King Raw Materials stock location and raw-material products, or
- the exact Nut King Finished Goods stock location and finished-good products.

The custom context permits the native inventory mode for the corresponding Nut King warehouse role without granting employees the standard Inventory application role.

## Offline path

`Installed PWA → cached bootstrap data → IndexedDB draft queue → /nutking/api/sync → Odoo Draft operation`

Each queued draft has a unique external ID. The server accepts that ID once, validates the user’s role and record data, and returns the created Draft operation. Rejected drafts remain on the device with the synchronization error.

## Security phases

Current staging phase:

- Nut King roles
- ACLs and record rules
- operation-level server validation
- custom menus
- scoped native physical inventory

Final phase after staging:

- dedicated branded staff login
- direct role dashboard routing
- worker backend-route protection
- hidden standard Odoo navigation
- registered-device controls
- protected developer escape route
