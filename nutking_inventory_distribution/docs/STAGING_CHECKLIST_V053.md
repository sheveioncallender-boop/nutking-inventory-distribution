# Nut King v0.5.3 focused staging checks

1. Upgrade the module and open `/nutking/reset` once.
2. Open Issue Raw Materials and confirm Movement Reason is not shown.
3. Add a raw-material product, review it, click Save Draft, and confirm the modal closes and the transfer appears under Stock Operations.
4. Repeat and click Mark as Todo; confirm Odoo creates the native transfer in Waiting/Ready according to availability.
5. Open Issue Finished Goods to Truck. Type part of a customer/company name and select the matching synchronized Odoo Contact.
6. Type part of a truck name or registration and select the truck.
7. Add a finished product and review the operation.
8. While online, click the product name and confirm the native Odoo product form opens.
9. Disconnect the internet, click a product name, and confirm the cached product details open instead.
10. Reconnect and synchronize; verify the same stock.picking appears in the backend.
