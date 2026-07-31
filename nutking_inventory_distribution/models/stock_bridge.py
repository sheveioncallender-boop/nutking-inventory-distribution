from odoo import api, fields, models, _
from odoo.exceptions import AccessError


class StockLocation(models.Model):
    _inherit = 'stock.location'

    nutking_is_location = fields.Boolean(
        string='Nut King Operations Location',
        default=False,
        index=True,
        help='Identifies locations controlled by the Nut King Inventory & Distribution application.',
    )


class StockPicking(models.Model):
    _inherit = 'stock.picking'

    nutking_operation_id = fields.Many2one(
        'nutking.stock.operation',
        string='Nut King Operation',
        readonly=True,
        copy=False,
        index=True,
        ondelete='set null',
    )


class StockQuant(models.Model):
    _inherit = 'stock.quant'

    @api.model
    def _nutking_inventory_scope(self):
        inventory_type = self.env.context.get('nutking_inventory_type')
        if inventory_type == 'raw_material':
            return self.env.user.has_group('nutking_inventory_distribution.group_nutking_raw_clerk')
        if inventory_type == 'finished_good':
            return self.env.user.has_group('nutking_inventory_distribution.group_nutking_finished_clerk')
        return False

    @api.model
    def _is_inventory_mode(self):
        if self.env.context.get('nutking_physical_inventory'):
            return bool(self.env.context.get('inventory_mode')) and self._nutking_inventory_scope()
        return super()._is_inventory_mode()

    @api.model
    def _domain_location_id(self):
        location_id = self.env.context.get('nutking_physical_location_id')
        if self.env.context.get('nutking_physical_inventory') and location_id:
            return "[('id', '=', context.get('nutking_physical_location_id'))]"
        return super()._domain_location_id()

    @api.model
    def _domain_product_id(self):
        inventory_type = self.env.context.get('nutking_inventory_type')
        if self.env.context.get('nutking_physical_inventory') and inventory_type:
            return "[('is_storable', '=', True), ('nutking_inventory_type', '=', context.get('nutking_inventory_type'))]"
        return super()._domain_product_id()

    @api.model
    def _nutking_physical_inventory_action(self, inventory_type):
        group_xmlid = (
            'nutking_inventory_distribution.group_nutking_raw_clerk'
            if inventory_type == 'raw_material'
            else 'nutking_inventory_distribution.group_nutking_finished_clerk'
        )
        if not self.env.user.has_group(group_xmlid) and not self.env.user.has_group('base.group_system'):
            raise AccessError(_('You do not have access to this Nut King physical inventory.'))

        location_xmlid = (
            'nutking_inventory_distribution.location_rm_stock'
            if inventory_type == 'raw_material'
            else 'nutking_inventory_distribution.location_fg_stock'
        )
        location = self.env.ref(location_xmlid)
        action_name = (
            _('Raw Materials Physical Inventory')
            if inventory_type == 'raw_material'
            else _('Finished Goods Physical Inventory')
        )
        scoped = self.with_context(
            inventory_mode=True,
            nutking_physical_inventory=True,
            nutking_inventory_type=inventory_type,
            nutking_physical_location_id=location.id,
            default_location_id=location.id,
            hide_location=True,
            no_at_date=True,
        )
        action = scoped.action_view_inventory()
        action['name'] = action_name
        action['domain'] = [
            ('location_id', '=', location.id),
            ('product_id.nutking_inventory_type', '=', inventory_type),
        ]
        context = dict(action.get('context') or {})
        # Odoo normally enables a "My Count" default for non-manager Inventory
        # users. Nut King warehouse menus are already safely scoped to a single
        # warehouse and product type, so show the complete warehouse count.
        context.pop('search_default_my_count', None)
        context.update({
            'inventory_mode': True,
            'nutking_physical_inventory': True,
            'nutking_inventory_type': inventory_type,
            'nutking_physical_location_id': location.id,
            'default_location_id': location.id,
            'hide_location': True,
            'no_at_date': True,
        })
        action['context'] = context
        return action

    @api.model
    def action_nutking_raw_physical_inventory(self):
        return self._nutking_physical_inventory_action('raw_material')

    @api.model
    def action_nutking_finished_physical_inventory(self):
        return self._nutking_physical_inventory_action('finished_good')
