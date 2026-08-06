from odoo import fields, models


class NutkingStaff(models.Model):
    _name = 'nutking.staff'
    _description = 'Nut King Staff Member'
    _order = 'name'

    name = fields.Char(required=True, index=True)
    active = fields.Boolean(default=True)
    employee_code = fields.Char(copy=False, index=True)
    role = fields.Selection(
        [
            ('raw_materials', 'Raw Materials'),
            ('finished_goods', 'Finished Goods'),
            ('driver', 'Driver'),
            ('distribution', 'Distribution Team'),
            ('supervisor', 'Supervisor'),
            ('management', 'Management'),
            ('other', 'Other'),
        ],
        required=True,
        default='other',
    )
    phone = fields.Char()
    email = fields.Char()
    user_id = fields.Many2one('res.users', string='Related System User', ondelete='set null')
    notes = fields.Text()
