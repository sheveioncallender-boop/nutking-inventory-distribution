# Nut King Offline-First Architecture — v0.4.0

## Runtime layers

```text
Approved worker device
└── /nutking/ standalone PWA
    ├── cached HTML/CSS/JavaScript and brand assets
    ├── IndexedDB authorized snapshot
    ├── local Draft / Confirmed / Completed / Cancelled operations
    ├── local physical-count drafts
    ├── ordered synchronization queue
    ├── provisional device printing
    └── projected device balances
                 │
                 │ authenticated HTTPS when reachable
                 ▼
Nut King Odoo controllers
├── /nutking/api/ping
├── /nutking/api/bootstrap
├── /nutking/api/create-draft
├── /nutking/api/operation-action
├── /nutking/api/sync
└── /nutking/operation/<id>/print
                 │
                 ▼
Odoo 19 stock and Nut King models
├── stock.quant / stock.move / stock.picking
├── nutking.stock.operation
├── nutking.distribution.trip
├── nutking.truck
└── nutking.offline.transaction
```

## Application shell

The worker interface is served at `/nutking/` without Odoo's standard backend JavaScript. A service worker caches the shell and static assets under the `/nutking/` scope. Therefore Odoo's web-client reconnection notification is not part of the worker interface.

## Stock-operation lifecycle

The worker workspace exposes the complete operational lifecycle:

```text
Draft → Confirmed → Completed
  └──────────────→ Cancelled → Draft
```

- **Draft:** editable device/server operation; official stock is unchanged.
- **Confirmed:** checked and ready to complete; official stock is unchanged.
- **Completed:** creates and validates the official Odoo stock picking.
- **Cancelled:** cannot affect inventory and may be returned to Draft when authorized.

A completed Odoo operation cannot be cancelled directly. A reversing stock operation is required so the audit trail remains intact.

## Online and offline actions

When online, actions on synchronized operations call `/nutking/api/operation-action` immediately. New Rapid Scan operations are stored in the queue with a requested `desired_state` and synchronized to Odoo.

When offline, the same actions are stored locally:

- a new operation carries `desired_state` (`draft`, `confirmed`, `done`, or `cancelled`);
- an action on an existing server operation is queued as `operation_event`;
- completed local operations affect projected device stock;
- Odoo validates quantities, permissions, destinations, and movement requirements during synchronization.

## Printing

- Synchronized records use `/nutking/operation/<id>/print` to render the official Nut King QWeb PDF.
- Local or cached offline records use an in-browser print layout.
- Unsynchronized completed records are visibly marked as provisional and not yet authoritative.
- Official references and stock effects exist only after successful synchronization.

## Local data

IndexedDB stores:

- the latest authorized server snapshot;
- pending stock, trip, operation, and inventory-count transactions;
- saved physical-count drafts;
- synchronization history.

The initial online bootstrap is mandatory. Clearing browser/site storage removes the local copy, so approved devices should not use private browsing.

## Synchronization

Each action has a unique external UID. The server records processed identifiers in `nutking.offline.transaction`, making retries idempotent. Transactions are processed in dependency order: trip creation, stock operations, physical inventory, trip actions, then operation actions.

Automatic synchronization is attempted when the server becomes reachable, when the app opens, at periodic intervals, and when the user presses Synchronize. Failed actions remain visible with their error messages.

## Stock conflicts

Offline quantities are snapshots, not locks. The workspace prevents a device from completing more stock-out quantity than its synchronized balance adjusted by its own completed pending actions. During synchronization Odoo checks the current authoritative quantity. Conflicts are rejected for review rather than silently creating negative stock.

Physical counts include the expected server quantity from the device snapshot. If the server quantity changed before synchronization, the count is rejected unless a supervisor explicitly approves the conflict.

## Security

- Every page and API requires an authenticated Nut King user.
- API operations are checked against Nut King role permissions server-side.
- Bootstrap data is filtered by the logged-in user's operational role.
- Printing checks company and operation-type access.
- Device data remains available offline to anyone who can unlock that browser profile; approved-device and offline-PIN hardening belongs to the final lock-down phase.
- Technical Odoo access remains available to Settings administrators during staging.
