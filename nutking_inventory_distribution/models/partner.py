from odoo import fields, models


class ResPartner(models.Model):
    _inherit = 'res.partner'

    nutking_is_customer = fields.Boolean(string='Nut King Distribution Customer', default=False, index=True)
    nutking_customer_code = fields.Char(string='Customer Code', copy=False, index=True)
    nutking_route = fields.Char(string='Distribution Route')
    nutking_delivery_notes = fields.Text(string='Delivery Instructions')

    nutking_is_supplier = fields.Boolean(string='Nut King Raw-Material Supplier', default=False, index=True)
    nutking_supplier_code = fields.Char(string='Supplier Code', copy=False, index=True)
