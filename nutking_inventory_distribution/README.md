# Nut King Inventory & Distribution

**Odoo release:** 19.0  
**Module version:** `19.0.5.0.2`  
**Workspace version:** `0.5.2`  
**Status:** staging release

A single branded Nut King application for independently managing Raw Materials, Finished Goods, trucks, distribution, customers, physical inventory, reporting, and offline operations.

## Core business rules

- Raw Materials and Finished Goods are separate inventories.
- No Bills of Materials, manufacturing orders, or raw-to-finished conversion.
- Official warehouse transactions are native Odoo `stock.picking`, `stock.move`, and `stock.move.line` records.
- Trucks operate as controlled internal stock locations.
- Customers and companies are Odoo Contacts (`res.partner`).
- Physical Inventory continues to use Odoo's native `stock.quant` inventory process.
- Odoo remains the authoritative source for reservations, availability, detailed operations, forecasting, move history, validation, returns, and printing.

## Hybrid worker workflow

Workers open `/nutking/`. The workspace keeps Nut King branding and Rapid Scan speed while following Odoo's natural transfer flow:

```text
Draft → Waiting → Ready → Done
             Cancelled
```

The available actions mirror Odoo where applicable:

- Mark as Todo
- Check Availability
- Detailed Operations
- Validate
- Return
- Cancel
- Print

Rapid Scan is only a faster way to prepare a native transfer. It does not create a parallel reservation or stock-status system.

## Finished Goods to truck

A Finished Goods issue creates an internal transfer:

```text
Available Finished Goods → Selected Truck
```

A truck is required. A customer or company is optional, allowing either customer-allocated stock or general truck stock. When a customer is selected, the transfer links directly to the Odoo Contact.

## Product availability and history

- **Online:** clicking a product can open its actual Odoo product form, forecast, locations, and move history.
- **Offline:** the workspace opens a cached Odoo-style product snapshot with On Hand, Free to Use, Incoming, Outgoing, Forecasted, locations/lots, reservations/Used By, and recent moves.

Offline data always shows its last synchronization time. It is a snapshot, not a live server reservation.

## Offline reservation and validation

The PWA stores native transfer instructions and action order locally. Users can select source locations, lots, packages, and quantities from the synchronized snapshot. Offline actions are provisional until synchronization.

When the connection returns, the server:

1. creates or updates the native Odoo transfer;
2. confirms it;
3. runs Odoo's Check Availability;
4. applies detailed source/lot allocations;
5. validates through Odoo;
6. returns the official state, reference, forecast, and move history.

If availability changed while the device was offline, Odoo's current result wins. The transfer may remain Waiting, reserve partially, require a backorder decision, or be rejected for correction.

## Administrator access

During staging, Settings administrators retain **Nut King Administration** for native transfer review, technical maintenance, physical inventory, products, trucks, contacts, trips, and synchronization logs. Strict staff redirection and backend lock-down remain intentionally deferred until runtime testing is complete.

## Installation / upgrade

1. Put the complete `nutking_inventory_distribution` folder in the Cloudpepper-connected Git repository.
2. Commit, push, redeploy, and restart Odoo.
3. Update the Apps List.
4. Upgrade **Nut King Inventory & Distribution**.
5. Open `/nutking/reset` once while online.
6. Open **Nut King Operations** and press **Synchronize**.
7. Confirm the sidebar displays **Workspace v0.5.2**.
8. Complete the staging checklist before production use.

## Dependencies

```python
['stock', 'contacts', 'mail']
```

## v0.5.6 Community backend recovery

This release normalizes Settings administrators after earlier staging upgrades. Administrators receive a backend Home Action and are removed from explicit Nut King worker roles, while the module continues to depend only on Odoo Community applications.
