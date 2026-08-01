# Nut King Odoo-Native Hybrid Architecture — v0.5.0

## Design principle

The Nut King worker workspace is an offline-capable doorway into Odoo Inventory, not a second inventory engine.

```text
Approved worker device
└── /nutking/ branded PWA
    ├── Rapid Scan
    ├── Odoo-style transfer review
    ├── cached product forecast and moves
    ├── detailed source / lot allocations
    ├── physical inventory
    ├── ordered offline action queue
    └── synchronization status
                 │
                 │ authenticated HTTPS when reachable
                 ▼
Nut King hybrid controllers
├── /nutking/api/bootstrap
├── /nutking/api/hybrid-bootstrap
├── /nutking/api/native-sync
├── /nutking/api/contact/create
└── /nutking/native-transfer/<id>/print
                 │
                 ▼
Odoo 19 native inventory
├── stock.picking
├── stock.move
├── stock.move.line
├── stock.quant
├── stock.lot / stock.package
├── res.partner
└── native reports, returns, forecast, reservations and history
```

## Official transfer model

Every new warehouse stock operation created by the hybrid workspace becomes a native `stock.picking` with native stock moves. The module adds only Nut King metadata such as truck, trip, reason, device, and offline transaction ID.

The worker-facing stage is derived directly from Odoo state:

| Odoo state | Worker label |
|---|---|
| `draft` | Draft |
| `confirmed`, `waiting`, `partially_available` | Waiting |
| `assigned` | Ready |
| `done` | Done |
| `cancel` | Cancelled |

No parallel Draft/Confirmed/Completed stock state is maintained for v0.5.0 native transfers.

## Native actions

- **Mark as Todo:** calls Odoo transfer confirmation.
- **Check Availability:** calls native assignment/reservation.
- **Detailed Operations:** captures the requested source location, lot, package, and quantity using the synchronized Odoo stock snapshot.
- **Validate:** sets picked quantities and calls Odoo's native validation.
- **Return:** uses Odoo's stock return wizard.
- **Cancel:** calls native transfer cancellation when Odoo permits it.
- **Print:** renders Odoo's native delivery/transfer report for the official transfer.

## Warehouses and operation types

The module creates dedicated native operation types for:

- Receive Raw Materials
- Issue Raw Materials
- Receive Finished Goods
- Finished Goods to Truck
- Customer Delivery
- Truck Return

Internal and outgoing operation types use manual reservation so the worker can run Check Availability or specify detailed source allocations.

## Customers and companies

Customer/company records are normal Odoo Contacts. The offline workspace synchronizes authorized contacts and can queue a new contact for server creation. A Finished Goods-to-Truck transfer requires a truck and may optionally link a customer/company.

## Product details

### Online

The product link can open the actual Odoo `product.product` form. Native Odoo forecast, moves, locations, lots, and stock data remain authoritative.

### Offline

IndexedDB stores a read-only product snapshot:

- On Hand
- Free to Use
- Incoming
- Outgoing
- Forecasted
- quantity by Nut King location and lot
- open demand and reserved quantity / Used By
- recent move history

The snapshot is timestamped and refreshed after synchronization.

## Detailed operations offline

The device downloads quantities by location, lot, and package. A user may prepare a detailed allocation while offline. The request is not an official reservation until Odoo processes it.

At synchronization, Odoo verifies:

- the transfer still exists or can be created;
- the product belongs to the correct Nut King inventory type;
- the source location is the configured source or one of its descendants;
- the lot belongs to the selected product;
- current stock and reservation rules permit the allocation;
- the user is authorized to perform the action.

Odoo's result is final. Conflicts remain visible in the synchronization centre.

## Location hierarchy

Locations created beneath a Nut King location inherit the Nut King location flag. This allows shelves and bins created through Odoo to appear in offline detailed operations and scoped physical inventory. Manual source selection accepts the configured source location and its descendants.

## Physical inventory

Physical Inventory continues through Odoo's `stock.quant` inventory mechanism. Raw Materials and Finished Goods actions are scoped to the appropriate warehouse tree and product type while preserving Odoo's normal count, difference, apply, and history behaviour.

## Offline persistence

The service worker caches the application shell. IndexedDB stores:

- the authorized server snapshot;
- native transfer drafts and events;
- contacts queued for creation;
- physical counts and distribution actions;
- synchronization history and errors.

Every transaction has a unique external UID. `nutking.offline.transaction` prevents duplicate processing.

## Security and staging boundary

- All workspace pages and APIs require an authenticated Nut King user.
- Controllers validate the Nut King role before using carefully scoped server operations.
- Records remain company-scoped.
- Workers are not granted general write access to native stock pickings through the backend.
- Settings administrators retain backend access during staging.
- Final login redirection and `/web` lock-down will be activated only after multi-device runtime testing.
