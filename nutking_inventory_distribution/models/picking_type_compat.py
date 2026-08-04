from odoo import api, models


class StockPickingType(models.Model):
    """Compatibility defaults for optional Enterprise/custom stock extensions.

    Some hosted databases extend ``stock.picking.type`` with required fields that
    are not part of Odoo Community/core.  XML records created by this module must
    still receive a valid value when such an extension is installed.
    """

    _inherit = "stock.picking.type"

    @api.model
    def _nutking_required_extension_default(self, field_name):
        field = self._fields.get(field_name)
        if not field:
            return None

        default = field.default
        if callable(default):
            try:
                default = default(self)
            except TypeError:
                default = default()

        # A Boolean False is a real PostgreSQL value.  For a required Selection,
        # False becomes NULL, so choose a valid option instead.
        if field.type == "boolean":
            return bool(default)

        if field.type == "selection":
            if default not in (None, False, ""):
                return default
            try:
                selection = field._description_selection(self.env)
            except Exception:
                selection = field.selection(self) if callable(field.selection) else field.selection
            keys = [item[0] for item in (selection or [])]
            preferred = (
                "none",
                "not_set",
                "no_restriction",
                "no_package",
                "without_package",
                "no",
            )
            return next((value for value in preferred if value in keys), keys[0] if keys else False)

        if default not in (None, False):
            return default
        if field.type in ("integer", "float", "monetary"):
            return 0
        if field.type in ("char", "text", "html"):
            return ""
        return False

    @api.model_create_multi
    def create(self, vals_list):
        # ``restrict_put_in_pack`` is added by an installed stock extension on
        # some Enterprise/hosted databases and may be required at SQL level.
        # Keep the module Community-compatible by only supplying it when present.
        field_name = "restrict_put_in_pack"
        if field_name in self._fields:
            fallback = self._nutking_required_extension_default(field_name)
            for vals in vals_list:
                if vals.get(field_name) in (None, ""):
                    vals[field_name] = fallback
        return super().create(vals_list)
    @api.model
    def nutking_sync_operation_types(self):
        """Reapply Nut King routing defaults on install and every upgrade.

        Early module releases loaded these records as ``noupdate`` data.  This
        explicit synchronizer keeps the native Odoo operation types aligned
        with the two Nut King warehouses even on databases upgraded from those
        releases.  Dynamic truck locations are still selected per transfer by
        the hybrid controller.
        """
        ref = self.env.ref
        company = ref('base.main_company')
        mappings = {
            'nutking_inventory_distribution.picking_type_nutking_raw_receipt': {
                'name': 'Nut King: Receive Raw Materials',
                'sequence_code': 'NK-RMR',
                'code': 'incoming',
                'default_location_src_id': ref('stock.stock_location_suppliers').id,
                'default_location_dest_id': ref('nutking_inventory_distribution.location_rm_stock').id,
                'company_id': company.id,
                'show_operations': True,
                'use_create_lots': True,
                'use_existing_lots': True,
                'create_backorder': 'ask',
            },
            'nutking_inventory_distribution.picking_type_nutking_raw_issue': {
                'name': 'Nut King: Issue Raw Materials',
                'sequence_code': 'NK-RMI',
                'code': 'internal',
                'default_location_src_id': ref('nutking_inventory_distribution.location_rm_stock').id,
                'default_location_dest_id': ref('nutking_inventory_distribution.location_rm_issued').id,
                'company_id': company.id,
                'reservation_method': 'manual',
                'show_operations': True,
                'use_existing_lots': True,
                'create_backorder': 'ask',
            },
            'nutking_inventory_distribution.picking_type_nutking_finished_receipt': {
                'name': 'Nut King: Receive Finished Goods',
                'sequence_code': 'NK-FGR',
                'code': 'incoming',
                'default_location_src_id': ref('nutking_inventory_distribution.location_nutking_adjustment').id,
                'default_location_dest_id': ref('nutking_inventory_distribution.location_fg_stock').id,
                'company_id': company.id,
                'show_operations': True,
                'use_create_lots': True,
                'use_existing_lots': True,
                'create_backorder': 'ask',
            },
            'nutking_inventory_distribution.picking_type_nutking_finished_truck': {
                'name': 'Nut King: Finished Goods to Truck',
                'sequence_code': 'NK-TRK',
                'code': 'internal',
                'default_location_src_id': ref('nutking_inventory_distribution.location_fg_stock').id,
                'default_location_dest_id': ref('nutking_inventory_distribution.location_fg_issued').id,
                'company_id': company.id,
                'reservation_method': 'manual',
                'show_operations': True,
                'use_existing_lots': True,
                'create_backorder': 'ask',
            },
            'nutking_inventory_distribution.picking_type_nutking_customer_delivery': {
                'name': 'Nut King: Customer Delivery',
                'sequence_code': 'NK-DEL',
                'code': 'outgoing',
                'default_location_src_id': ref('nutking_inventory_distribution.location_fg_stock').id,
                'default_location_dest_id': ref('stock.stock_location_customers').id,
                'company_id': company.id,
                'reservation_method': 'manual',
                'show_operations': True,
                'use_existing_lots': True,
                'create_backorder': 'ask',
            },
            'nutking_inventory_distribution.picking_type_nutking_truck_return': {
                'name': 'Nut King: Return Truck Stock',
                'sequence_code': 'NK-RET',
                'code': 'internal',
                'default_location_src_id': ref('nutking_inventory_distribution.location_fg_stock').id,
                'default_location_dest_id': ref('nutking_inventory_distribution.location_fg_stock').id,
                'company_id': company.id,
                'reservation_method': 'manual',
                'show_operations': True,
                'use_existing_lots': True,
                'create_backorder': 'ask',
            },
        }
        for xmlid, values in mappings.items():
            operation_type = ref(xmlid, raise_if_not_found=False)
            if operation_type:
                writable = {name: value for name, value in values.items() if name in operation_type._fields}
                operation_type.sudo().write(writable)
        return True

