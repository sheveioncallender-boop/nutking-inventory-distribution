from odoo import api, fields, models


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    nutking_inventory_type = fields.Selection(
        [
            ('raw_material', 'Raw Material'),
            ('finished_good', 'Finished Good'),
            ('other', 'Other'),
        ],
        string='Nut King Inventory Type',
        default='other',
        required=True,
        index=True,
    )
    nutking_minimum_qty = fields.Float(string='Minimum Stock Level', default=0.0)
    nutking_units_per_case = fields.Float(string='Units per Case', default=1.0)
    nutking_pack_size = fields.Char(string='Pack Size')
    nutking_active = fields.Boolean(string='Available in Nut King Operations', default=True)

    @api.onchange('nutking_inventory_type')
    def _onchange_nutking_inventory_type(self):
        if self.nutking_inventory_type in ('raw_material', 'finished_good'):
            self.is_storable = True


class ProductProduct(models.Model):
    _inherit = 'product.product'

    nutking_inventory_type = fields.Selection(
        related='product_tmpl_id.nutking_inventory_type',
        store=True,
        readonly=True,
    )
    nutking_minimum_qty = fields.Float(
        related='product_tmpl_id.nutking_minimum_qty',
        store=True,
        readonly=True,
    )
