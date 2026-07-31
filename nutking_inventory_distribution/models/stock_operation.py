from odoo import api, fields, models, _
from odoo.exceptions import UserError, ValidationError
from odoo.fields import Command
from odoo.tools.float_utils import float_compare


OPERATION_TYPES = [
    ('raw_receipt', 'Receive Raw Materials'),
    ('raw_issue', 'Issue Raw Materials'),
    ('raw_supplier_return', 'Return Raw Materials to Supplier'),
    ('raw_damage', 'Record Damaged Raw Materials'),
    ('raw_expired', 'Record Expired Raw Materials'),
    ('raw_adjustment', 'Raw Materials Adjustment'),
    ('finished_add', 'Add Finished Goods'),
    ('truck_load', 'Load Truck'),
    ('customer_delivery', 'Customer Delivery'),
    ('truck_return', 'Return Truck Stock'),
    ('customer_return', 'Customer Return'),
    ('finished_damage', 'Record Damaged Finished Goods'),
    ('finished_adjustment', 'Finished Goods Adjustment'),
]

OPERATION_GROUPS = {
    'raw_receipt': ('nutking_inventory_distribution.group_nutking_raw_clerk',),
    'raw_issue': ('nutking_inventory_distribution.group_nutking_raw_clerk',),
    'raw_supplier_return': ('nutking_inventory_distribution.group_nutking_raw_clerk',),
    'raw_damage': ('nutking_inventory_distribution.group_nutking_raw_clerk',),
    'raw_expired': ('nutking_inventory_distribution.group_nutking_raw_clerk',),
    'raw_adjustment': ('nutking_inventory_distribution.group_nutking_supervisor',),
    'finished_add': ('nutking_inventory_distribution.group_nutking_finished_clerk',),
    'truck_load': (
        'nutking_inventory_distribution.group_nutking_finished_clerk',
        'nutking_inventory_distribution.group_nutking_distribution',
    ),
    'customer_delivery': ('nutking_inventory_distribution.group_nutking_distribution',),
    'truck_return': (
        'nutking_inventory_distribution.group_nutking_finished_clerk',
        'nutking_inventory_distribution.group_nutking_distribution',
    ),
    'customer_return': (
        'nutking_inventory_distribution.group_nutking_finished_clerk',
        'nutking_inventory_distribution.group_nutking_distribution',
    ),
    'finished_damage': (
        'nutking_inventory_distribution.group_nutking_finished_clerk',
        'nutking_inventory_distribution.group_nutking_distribution',
    ),
    'finished_adjustment': ('nutking_inventory_distribution.group_nutking_supervisor',),
}


class NutkingStockOperation(models.Model):
    _name = 'nutking.stock.operation'
    _description = 'Nut King Stock Operation'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'operation_date desc, id desc'

    name = fields.Char(default='New', readonly=True, copy=False, index=True)
    operation_type = fields.Selection(OPERATION_TYPES, required=True, tracking=True, index=True)
    state = fields.Selection(
        [('draft', 'Draft'), ('confirmed', 'Confirmed'), ('done', 'Completed'), ('cancelled', 'Cancelled')],
        default='draft',
        required=True,
        tracking=True,
        index=True,
    )
    operation_date = fields.Datetime(default=fields.Datetime.now, required=True, tracking=True)
    user_id = fields.Many2one('res.users', default=lambda self: self.env.user, required=True, tracking=True)
    company_id = fields.Many2one('res.company', default=lambda self: self.env.company, required=True, index=True)
    partner_id = fields.Many2one('res.partner', string='Supplier / Customer', tracking=True)
    truck_id = fields.Many2one('nutking.truck', tracking=True)
    trip_id = fields.Many2one('nutking.distribution.trip', tracking=True, ondelete='set null')
    reason_id = fields.Many2one('nutking.movement.reason', tracking=True)
    notes = fields.Text(tracking=True)
    adjustment_direction = fields.Selection([('increase', 'Increase Stock'), ('decrease', 'Decrease Stock')], default='increase')
    source_location_id = fields.Many2one('stock.location', readonly=True, copy=False)
    destination_location_id = fields.Many2one('stock.location', readonly=True, copy=False)
    line_ids = fields.One2many('nutking.stock.operation.line', 'operation_id', string='Products', copy=True)
    picking_id = fields.Many2one('stock.picking', readonly=True, copy=False)
    total_quantity = fields.Float(compute='_compute_total_quantity', store=True)
    offline_transaction_id = fields.Many2one('nutking.offline.transaction', readonly=True, copy=False)

    @api.depends('line_ids.quantity')
    def _compute_total_quantity(self):
        for operation in self:
            operation.total_quantity = sum(operation.line_ids.mapped('quantity'))

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', 'New') == 'New':
                vals['name'] = self.env['ir.sequence'].next_by_code('nutking.stock.operation') or 'New'
        records = super().create(vals_list)
        records._apply_locations()
        return records

    def write(self, vals):
        protected = {'operation_type', 'line_ids', 'truck_id', 'partner_id', 'adjustment_direction'}
        if protected.intersection(vals) and any(rec.state not in ('draft', 'confirmed') for rec in self):
            raise UserError(_('Completed or cancelled operations cannot be changed.'))
        result = super().write(vals)
        if protected.intersection(vals):
            self._apply_locations()
        return result

    @api.onchange('operation_type', 'truck_id', 'adjustment_direction')
    def _onchange_operation_configuration(self):
        self._apply_locations()

    def _location(self, xmlid):
        return self.env.ref(xmlid, raise_if_not_found=False)

    def _apply_locations(self):
        suppliers = self._location('stock.stock_location_suppliers')
        customers = self._location('stock.stock_location_customers')
        inventory = self._location('nutking_inventory_distribution.location_nutking_adjustment')
        mapping = {
            'raw_receipt': (suppliers, self._location('nutking_inventory_distribution.location_rm_stock')),
            'raw_issue': (self._location('nutking_inventory_distribution.location_rm_stock'), self._location('nutking_inventory_distribution.location_rm_issued')),
            'raw_supplier_return': (self._location('nutking_inventory_distribution.location_rm_stock'), suppliers),
            'raw_damage': (self._location('nutking_inventory_distribution.location_rm_stock'), self._location('nutking_inventory_distribution.location_rm_damaged')),
            'raw_expired': (self._location('nutking_inventory_distribution.location_rm_stock'), self._location('nutking_inventory_distribution.location_rm_expired')),
            'finished_add': (inventory, self._location('nutking_inventory_distribution.location_fg_stock')),
            'customer_return': (customers, self._location('nutking_inventory_distribution.location_fg_returns')),
        }
        for operation in self:
            source = destination = False
            if operation.operation_type in mapping:
                source, destination = mapping[operation.operation_type]
            elif operation.operation_type == 'truck_load':
                source = self._location('nutking_inventory_distribution.location_fg_stock')
                destination = operation.truck_id.stock_location_id if operation.truck_id else False
            elif operation.operation_type == 'customer_delivery':
                source = operation.truck_id.stock_location_id if operation.truck_id else False
                destination = customers
            elif operation.operation_type == 'truck_return':
                source = operation.truck_id.stock_location_id if operation.truck_id else False
                destination = self._location('nutking_inventory_distribution.location_fg_stock')
            elif operation.operation_type == 'finished_damage':
                source = operation.truck_id.stock_location_id if operation.truck_id else self._location('nutking_inventory_distribution.location_fg_stock')
                destination = self._location('nutking_inventory_distribution.location_fg_damaged')
            elif operation.operation_type == 'raw_adjustment':
                raw = self._location('nutking_inventory_distribution.location_rm_stock')
                source, destination = (inventory, raw) if operation.adjustment_direction == 'increase' else (raw, inventory)
            elif operation.operation_type == 'finished_adjustment':
                finished = self._location('nutking_inventory_distribution.location_fg_stock')
                source, destination = (inventory, finished) if operation.adjustment_direction == 'increase' else (finished, inventory)
            operation.source_location_id = source.id if source else False
            operation.destination_location_id = destination.id if destination else False

    @api.constrains('operation_type', 'line_ids', 'partner_id', 'truck_id', 'trip_id', 'reason_id', 'notes', 'company_id')
    def _check_requirements(self):
        reason_required = {
            'raw_issue', 'raw_supplier_return', 'raw_damage', 'raw_expired', 'raw_adjustment',
            'truck_return', 'customer_return', 'finished_damage', 'finished_adjustment',
        }
        partner_required = {'raw_receipt', 'raw_supplier_return', 'customer_delivery', 'customer_return'}
        truck_required = {'truck_load', 'customer_delivery', 'truck_return'}
        trip_required = {'truck_load', 'customer_delivery', 'truck_return'}
        for operation in self:
            if operation.operation_type in reason_required and not operation.reason_id:
                raise ValidationError(_('A movement reason is required for this operation.'))
            if operation.operation_type in partner_required and not operation.partner_id:
                raise ValidationError(_('A supplier or customer is required for this operation.'))
            if operation.operation_type in truck_required and not operation.truck_id:
                raise ValidationError(_('A truck is required for this operation.'))
            if operation.operation_type in trip_required and not operation.trip_id:
                raise ValidationError(_('A distribution trip is required for this operation.'))
            if operation.trip_id and operation.truck_id and operation.trip_id.truck_id != operation.truck_id:
                raise ValidationError(_('The selected truck must match the truck assigned to the distribution trip.'))
            if operation.trip_id and operation.company_id != operation.trip_id.company_id:
                raise ValidationError(_('The operation and distribution trip must belong to the same company.'))
            if operation.operation_type == 'truck_load' and operation.trip_id and operation.trip_id.state not in ('planned', 'loading'):
                raise ValidationError(_('Truck loading is only allowed while the trip is planned or loading.'))
            if operation.operation_type in ('customer_delivery', 'truck_return') and operation.trip_id and operation.trip_id.state not in ('in_progress', 'reconciliation'):
                raise ValidationError(_('Deliveries and truck returns require an active or reconciling trip.'))
            if operation.reason_id:
                if operation.operation_type.startswith('raw_'):
                    expected_reason_area = 'raw'
                elif operation.operation_type in ('truck_load', 'customer_delivery', 'truck_return', 'customer_return'):
                    expected_reason_area = 'distribution'
                else:
                    expected_reason_area = 'finished'
                if operation.reason_id.applies_to not in ('all', expected_reason_area):
                    raise ValidationError(_('The selected movement reason does not apply to this operation.'))
            if operation.reason_id.requires_note and not operation.notes:
                raise ValidationError(_('The selected reason requires an explanatory note.'))
            if operation.operation_type in ('customer_delivery', 'customer_return') and operation.partner_id and not operation.partner_id.nutking_is_customer:
                raise ValidationError(_('Select a Nut King customer for this operation.'))
            if operation.operation_type in ('raw_receipt', 'raw_supplier_return') and operation.partner_id and not operation.partner_id.nutking_is_supplier:
                raise ValidationError(_('Select a Nut King raw-material supplier for this operation.'))

    @api.model
    def allowed_operation_types_for_user(self):
        if self.env.user.has_group('base.group_system'):
            return [key for key, _label in OPERATION_TYPES]
        return [
            operation_type
            for operation_type, groups in OPERATION_GROUPS.items()
            if any(self.env.user.has_group(group) for group in groups)
        ]

    def _check_role_permission(self):
        if self.env.user.has_group('base.group_system'):
            return True
        allowed = set(self.allowed_operation_types_for_user())
        for operation in self:
            if operation.operation_type not in allowed:
                raise UserError(_('Your Nut King role does not permit this operation.'))
            if operation.reason_id.requires_supervisor and not self.env.user.has_group(
                'nutking_inventory_distribution.group_nutking_supervisor'
            ):
                raise UserError(_('The selected movement reason requires supervisor approval.'))
        return True

    def action_confirm(self):
        self._check_role_permission()
        self._check_requirements()
        for operation in self:
            if not operation.line_ids:
                raise UserError(_('Add at least one product line before confirming.'))
            operation._apply_locations()
            if not operation.source_location_id or not operation.destination_location_id:
                raise UserError(_('The source and destination locations could not be determined.'))
            operation.state = 'confirmed'
        return True

    def _check_product_category(self):
        raw_ops = {'raw_receipt', 'raw_issue', 'raw_supplier_return', 'raw_damage', 'raw_expired', 'raw_adjustment'}
        finished_ops = {'finished_add', 'truck_load', 'customer_delivery', 'truck_return', 'customer_return', 'finished_damage', 'finished_adjustment'}
        for operation in self:
            expected = 'raw_material' if operation.operation_type in raw_ops else 'finished_good' if operation.operation_type in finished_ops else False
            if expected:
                invalid = operation.line_ids.filtered(lambda line: line.product_id.nutking_inventory_type != expected)
                if invalid:
                    raise UserError(_('%(operation)s can only contain %(type)s products. Invalid: %(products)s',
                                      operation=dict(OPERATION_TYPES).get(operation.operation_type),
                                      type=dict(operation.line_ids._fields['inventory_type'].selection).get(expected),
                                      products=', '.join(invalid.mapped('product_id.display_name'))))

    def _check_available_stock(self):
        internal_source_ops = {
            'raw_issue', 'raw_supplier_return', 'raw_damage', 'raw_expired',
            'truck_load', 'customer_delivery', 'truck_return', 'finished_damage',
        }
        for operation in self.filtered(lambda op: op.operation_type in internal_source_ops or (op.operation_type in ('raw_adjustment', 'finished_adjustment') and op.adjustment_direction == 'decrease')):
            for line in operation.line_ids:
                available = self.env['stock.quant'].sudo()._get_available_quantity(
                    line.product_id, operation.source_location_id, strict=False
                )
                if float_compare(available, line.quantity, precision_rounding=line.product_uom_id.rounding) < 0:
                    raise UserError(_('%(product)s has only %(available)s available in %(location)s; %(required)s was requested.',
                                      product=line.product_id.display_name,
                                      available=available,
                                      location=operation.source_location_id.display_name,
                                      required=line.quantity))

    def _get_picking_type(self):
        self.ensure_one()
        source_usage = self.source_location_id.usage
        dest_usage = self.destination_location_id.usage
        if source_usage != 'internal' and dest_usage == 'internal':
            code = 'incoming'
        elif source_usage == 'internal' and dest_usage != 'internal':
            code = 'outgoing'
        else:
            code = 'internal'
        picking_type = self.env['stock.picking.type'].sudo().search([
            ('code', '=', code), ('company_id', '=', self.company_id.id)
        ], limit=1)
        if not picking_type:
            raise UserError(_('No Odoo stock operation type is available for %s movements.') % code)
        return picking_type

    def action_process(self):
        for operation in self:
            if operation.state == 'draft':
                operation.action_confirm()
            if operation.state != 'confirmed':
                raise UserError(_('Only confirmed operations can be processed.'))
            operation._check_role_permission()
            operation._check_product_category()
            operation._check_available_stock()
            picking_type = operation._get_picking_type()
            move_commands = []
            for line in operation.line_ids:
                move_commands.append(Command.create({
                    'name': line.product_id.display_name,
                    'product_id': line.product_id.id,
                    'product_uom_qty': line.quantity,
                    'product_uom': line.product_uom_id.id,
                    'location_id': operation.source_location_id.id,
                    'location_dest_id': operation.destination_location_id.id,
                }))
            picking = self.env['stock.picking'].sudo().create({
                'picking_type_id': picking_type.id,
                'location_id': operation.source_location_id.id,
                'location_dest_id': operation.destination_location_id.id,
                'partner_id': operation.partner_id.id or False,
                'origin': operation.name,
                'scheduled_date': operation.operation_date,
                'move_ids': move_commands,
                'nutking_operation_id': operation.id,
            })
            picking.action_confirm()
            picking.action_assign()
            for move in picking.move_ids:
                line = operation.line_ids.filtered(lambda item: item.product_id == move.product_id)[:1]
                move.sudo().write({'quantity': line.quantity, 'picked': True})
            result = picking.button_validate()
            if isinstance(result, dict) and result.get('res_model'):
                raise UserError(_('Odoo requires an additional validation step for this movement. Open transfer %s as the developer administrator.') % picking.name)
            operation.sudo().write({'picking_id': picking.id, 'state': 'done'})
            if operation.operation_type == 'truck_load' and operation.truck_id:
                operation.truck_id.status = 'loading'
            elif operation.operation_type == 'customer_delivery' and operation.truck_id:
                operation.truck_id.status = 'on_route'
            if operation.trip_id:
                operation.trip_id._refresh_reconciliation_lines()
        return True

    def action_cancel(self):
        for operation in self:
            if operation.state == 'done':
                raise UserError(_('A completed stock operation cannot be cancelled. Create a reversing operation instead.'))
            operation.state = 'cancelled'
        return True

    def action_reset_draft(self):
        self.filtered(lambda op: op.state == 'cancelled').state = 'draft'
        return True

    def action_view_picking(self):
        self.ensure_one()
        if not self.picking_id:
            return False
        return {
            'type': 'ir.actions.act_window',
            'name': _('Generated Stock Transfer'),
            'res_model': 'stock.picking',
            'res_id': self.picking_id.id,
            'view_mode': 'form',
            'target': 'current',
        }


class NutkingStockOperationLine(models.Model):
    _name = 'nutking.stock.operation.line'
    _description = 'Nut King Stock Operation Line'
    _order = 'id'

    _operation_product_unique = models.Constraint(
        'unique(operation_id, product_id)',
        'Add each product only once per operation. Combine quantities on one line.',
    )

    operation_id = fields.Many2one('nutking.stock.operation', required=True, ondelete='cascade')
    operation_type = fields.Selection(related='operation_id.operation_type', store=True, readonly=True)
    operation_date = fields.Datetime(related='operation_id.operation_date', store=True, readonly=True)
    state = fields.Selection(related='operation_id.state', store=True, readonly=True)
    company_id = fields.Many2one(related='operation_id.company_id', store=True, readonly=True, index=True)
    partner_id = fields.Many2one(related='operation_id.partner_id', store=True, readonly=True)
    truck_id = fields.Many2one(related='operation_id.truck_id', store=True, readonly=True)
    trip_id = fields.Many2one(related='operation_id.trip_id', store=True, readonly=True)
    product_id = fields.Many2one('product.product', required=True, domain=[('is_storable', '=', True)])
    inventory_type = fields.Selection(related='product_id.nutking_inventory_type', store=True, readonly=True)
    quantity = fields.Float(required=True, default=1.0)
    product_uom_id = fields.Many2one('uom.uom', related='product_id.uom_id', readonly=True)
    barcode = fields.Char(related='product_id.barcode', readonly=True)
    lot_reference = fields.Char(string='Batch / Lot Reference')
    expiration_date = fields.Date()
    notes = fields.Char()

    @api.constrains('quantity')
    def _check_quantity(self):
        if any(line.quantity <= 0 for line in self):
            raise ValidationError(_('Operation quantities must be greater than zero.'))
