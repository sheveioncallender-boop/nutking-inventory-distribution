# Nut King Inventory & Distribution

**Odoo release:** 19.0  
**Module version:** `19.0.3.0.0`  
**Status:** staging release

A single branded Nut King application for independently managing Raw Materials, Finished Goods, trucks, distribution trips, customers, returns, physical inventory, reporting, and offline operations.

## Core business rules

- Raw Materials and Finished Goods are separate inventories.
- No Bills of Materials, manufacturing orders, or raw-to-finished conversion.
- Every completed quantity change is posted through Odoo stock records.
- Trucks operate as controlled internal stock locations.
- Rapid Scan creates reviewable stock operations.
- Physical Inventory uses Odoo `stock.quant` inventory quantities and applies native inventory adjustments.

## Offline-first worker workspace

Workers open:

```text
/nutking/
```

The workspace is a standalone Progressive Web App and does not load the standard Odoo web-client shell. After the first successful synchronization it caches the application interface and the user’s authorized operational snapshot in IndexedDB.

Available while disconnected:

- dashboard and last synchronized stock snapshot;
- Raw Materials and Finished Goods stock lists;
- rapid receive and rapid issue;
- truck loading, customer delivery, truck return, and distribution-trip actions;
- physical counts for both warehouses;
- recent stock operations, contacts, trucks, and cached reports;
- review of local drafts, errors, and the synchronization queue.

New actions receive unique device identifiers and remain stored locally until the server accepts them. Projected device quantities include unsynchronized actions entered on that device. Odoo remains the authoritative server balance.

## Administrator access

During staging, Settings administrators also see **Nut King Administration**, which retains backend access for troubleshooting, native Physical Inventory, configuration, and synchronization logs. Strict worker redirection and backend lock-down remain intentionally deferred until operational testing is complete.

## Installation

1. Place the complete `nutking_inventory_distribution` folder in the Cloudpepper-connected Git repository.
2. Commit, push, redeploy, and restart Odoo.
3. Update the Apps List.
4. Upgrade **Nut King Inventory & Distribution**.
5. Sign out and sign back in.
6. Open **Nut King Operations** once while online and press **Synchronize**.
7. Install the workspace on approved devices when prompted by the browser.

## Dependencies

```python
['stock', 'contacts', 'mail']
```
