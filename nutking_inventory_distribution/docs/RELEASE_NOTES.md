# Release Notes — 19.0.1.0.0 Alpha

## Included

- Single branded Nut King Operations app for Odoo 19 Community.
- Separate Raw Materials and Finished Goods catalogues and stock locations.
- No Manufacturing, BOM or raw-to-finished conversion workflow.
- Nut King stock receipts, issues, supplier returns, damage, expiry and controlled adjustments.
- Finished-goods additions, customer returns and damage handling.
- Trucks with automatically generated mobile stock locations.
- Distribution trips with drivers, teams, customers, routes and state controls.
- Truck loading, customer delivery, truck return and per-product reconciliation.
- Mandatory movement reasons and supervisor-required reasons.
- Role groups for raw materials, finished goods, distribution, supervisor and management.
- Branded dashboard, inventory reports, product-level movement analysis and distribution analysis.
- Branded stock-operation and trip-reconciliation PDF reports.
- Offline PWA with IndexedDB queue, device timestamps, role-based operation list, locally projected balances, automatic sync and idempotent transaction IDs.
- Server-side validation of role, operation, product type, required references, stock availability, trip state and truck assignment.

## Intentionally deferred

- Strict worker-only login, direct dashboard redirect and complete backend route lock-down.
- Final production device registration/offline PIN and lost-device revocation.
- Native Odoo lot/serial traceability. Batch/lot text is currently captured as operational reference only.
- Proof-of-delivery signature/photo capture.
- Sales, invoicing, purchasing and accounting integration.
- Automated email/WhatsApp alerts.

## Staging requirement

This package has passed static source validation, but it has not been executed against a live PostgreSQL/Odoo server in the build environment. Install it on an Odoo 19 Community staging database and complete the supplied checklist before production use.
