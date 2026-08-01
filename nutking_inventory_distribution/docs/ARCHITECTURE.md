# Nut King Offline-First Architecture

## Runtime layers

```text
Approved worker device
└── /nutking/ standalone PWA
    ├── cached HTML/CSS/JavaScript and brand assets
    ├── IndexedDB authorized snapshot
    ├── local draft and physical-count stores
    ├── ordered synchronization queue
    └── projected device balances
                 │
                 │ authenticated HTTPS when reachable
                 ▼
Nut King Odoo controllers
├── /nutking/api/ping
├── /nutking/api/bootstrap
├── /nutking/api/create-draft
├── /nutking/api/operation-action
└── /nutking/api/sync
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

Offline quantities are snapshots, not locks. The workspace prevents a device from issuing more than its synchronized quantity adjusted by its own pending actions. During synchronization Odoo checks the current authoritative quantity. Conflicts are rejected for review rather than silently creating negative stock.

Physical counts also include the expected server quantity from the device snapshot. If the server quantity changed before synchronization, the count is rejected unless a supervisor explicitly approves the conflict.

## Security

- Every page and API requires an authenticated Nut King user.
- API operations are checked against Nut King role permissions server-side.
- Bootstrap data is filtered by the logged-in user's operational role.
- Device data remains available offline to anyone who can unlock that browser profile; approved-device and offline-PIN hardening belongs to the final lock-down phase.
- Technical Odoo access remains available to Settings administrators during staging.
