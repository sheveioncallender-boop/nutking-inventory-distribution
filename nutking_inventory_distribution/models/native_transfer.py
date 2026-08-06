from odoo import fields, models, _
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tools.float_utils import float_compare


NUTKING_TRANSFER_KINDS = [
    ('raw_receipt', 'Receive Raw Materials'),
    ('raw_issue', 'Issue Raw Materials'),
    ('finished_add', 'Receive Finished Goods'),
    ('finished_issue', 'Issue Finished Goods to Truck'),
    ('truck_load', 'Load Truck'),
    ('customer_delivery', 'Customer Delivery'),
    ('truck_return', 'Return Truck Stock'),
]


class StockPicking(models.Model):
    _inherit = 'stock.picking'

    nutking_is_operation = fields.Boolean(
        string='Nut King Transfer', default=False, index=True, copy=False
    )
    nutking_operation_kind = fields.Selection(
        NUTKING_TRANSFER_KINDS,
        string='Nut King Operation',
        index=True,
        copy=False,
    )
    nutking_truck_id = fields.Many2one(
        'nutking.truck', string='Truck', index=True, copy=False, tracking=True
    )
    nutking_trip_id = fields.Many2one(
        'nutking.distribution.trip', string='Distribution Trip', index=True,
        copy=False, tracking=True, ondelete='set null'
    )
    nutking_reason_id = fields.Many2one(
        'nutking.movement.reason', string='Movement Reason', copy=False,
        tracking=True
    )
    nutking_offline_uid = fields.Char(
        string='Offline Transaction ID', index=True, copy=False, readonly=True
    )
    nutking_device_name = fields.Char(
        string='Originating Device', copy=False, readonly=True
    )
    nutking_created_offline = fields.Boolean(
        string='Created Offline', default=False, copy=False, readonly=True
    )
    nutking_source_reference = fields.Char(
        string='Nut King Reference', copy=False, tracking=True
    )

    _nutking_offline_uid_unique = models.Constraint(
        'unique(nutking_offline_uid)',
        'This offline Nut King transfer has already been synchronized.',
    )

    def _nutking_assert_access(self):
        if not self.env.user.has_group(
            'nutking_inventory_distribution.group_nutking_user'
        ) and not self.env.user.has_group('base.group_system'):
            raise AccessError(_('Nut King operations access is required.'))
        return True

    def _nutking_native_label(self):
        self.ensure_one()
        mapping = {
            'draft': 'Draft',
            'confirmed': 'Waiting',
            'waiting': 'Waiting',
            'partially_available': 'Waiting',
            'assigned': 'Ready',
            'done': 'Done',
            'cancel': 'Cancelled',
        }
        return mapping.get(self.state, self.state or '')

    def _nutking_available_actions(self):
        self.ensure_one()
        actions = []
        if self.state == 'draft':
            actions += ['mark_todo', 'validate', 'cancel']
        elif self.state in ('confirmed', 'waiting', 'partially_available'):
            if self.show_check_availability:
                actions.append('check_availability')
            actions += ['validate', 'cancel']
        elif self.state == 'assigned':
            actions += ['validate', 'print', 'cancel']
        elif self.state == 'done':
            actions += ['return', 'print']
        return actions

    def _nutking_set_picked_quantities(self, allocations=None, force_demand=False):
        """Prepare Odoo 19 detailed operations before native validation.

        Odoo 19 stores the working quantity on ``stock.move.line.quantity``.
        Creating move lines through the ORM also updates native reservations, so
        this method does not maintain a parallel reserved-stock calculation.
        The ``force_demand`` option only fills any remaining demand on the
        transfer's source location; Odoo still performs its normal stock and lot
        checks during move-line creation and validation.
        """
        self.ensure_one()
        allocations = allocations or []
        allocations_by_product = {}
        for line in allocations:
            product_id = int(line.get('product_id') or 0)
            if product_id:
                allocations_by_product.setdefault(product_id, []).append(line)

        active_moves = self.move_ids.filtered(lambda move: move.state not in ('done', 'cancel'))
        if allocations:
            if self.state == 'draft':
                self.action_confirm()
            if self.state in ('assigned', 'partially_available'):
                self.do_unreserve()
            self.move_line_ids.filtered(lambda line: line.state not in ('done', 'cancel')).unlink()

            MoveLine = self.env['stock.move.line']
            for move in active_moves:
                requested = allocations_by_product.get(move.product_id.id, [])
                allocated_total = 0.0
                for item in requested:
                    location = self.env['stock.location'].browse(
                        int(item.get('location_id') or move.location_id.id)
                    ).exists()
                    if not location or location.usage == 'view':
                        raise ValidationError(_('Select a valid source location.'))
                    source_path = move.location_id.parent_path or f'{move.location_id.id}/'
                    if not (
                        location == move.location_id
                        or (location.parent_path or '').startswith(source_path)
                    ):
                        raise ValidationError(_(
                            '%(location)s is outside the transfer source location.',
                            location=location.display_name,
                        ))
                    quantity = float(item.get('quantity') or 0.0)
                    if float_compare(
                        quantity, 0.0,
                        precision_rounding=move.product_uom.rounding,
                    ) <= 0:
                        continue
                    lot = self.env['stock.lot']
                    lot_id = int(item.get('lot_id') or 0)
                    if lot_id:
                        lot = self.env['stock.lot'].browse(lot_id).exists()
                        if not lot or lot.product_id != move.product_id:
                            raise ValidationError(_('The selected lot does not match the product.'))
                    package = self.env['stock.package'].browse(
                        int(item.get('package_id') or 0)
                    ).exists()
                    MoveLine.create({
                        'move_id': move.id,
                        'picking_id': self.id,
                        'product_id': move.product_id.id,
                        'product_uom_id': move.product_uom.id,
                        'location_id': location.id,
                        'location_dest_id': move.location_dest_id.id,
                        'lot_id': lot.id or False,
                        'package_id': package.id or False,
                        'lot_name': str(item.get('lot_name') or '')[:128] or False,
                        'quantity': quantity,
                        'picked': True,
                        'company_id': move.company_id.id,
                    })
                    allocated_total += quantity

                if force_demand and float_compare(
                    allocated_total,
                    move.product_uom_qty,
                    precision_rounding=move.product_uom.rounding,
                ) < 0:
                    missing = move.product_uom_qty - allocated_total
                    MoveLine.create({
                        'move_id': move.id,
                        'picking_id': self.id,
                        'product_id': move.product_id.id,
                        'product_uom_id': move.product_uom.id,
                        'location_id': move.location_id.id,
                        'location_dest_id': move.location_dest_id.id,
                        'quantity': missing,
                        'picked': True,
                        'company_id': move.company_id.id,
                    })
            return

        for move in active_moves:
            if move.location_id.should_bypass_reservation() or force_demand:
                move.quantity = move.product_uom_qty
            elif float_compare(
                move.quantity, 0.0,
                precision_rounding=move.product_uom.rounding,
            ) <= 0:
                continue
            move.picked = True
            move.move_line_ids.picked = True

    def nutking_execute_action(
        self, action, allocations=None, backorder='ask', force_demand=False
    ):
        self.ensure_one()
        self._nutking_assert_access()
        if not self.nutking_is_operation:
            raise UserError(_('This transfer is not controlled by Nut King Operations.'))

        if action == 'mark_todo':
            if self.state == 'draft':
                self.action_confirm()
        elif action == 'check_availability':
            if self.state == 'draft':
                self.action_confirm()
            self.action_assign()
        elif action == 'validate':
            if self.state == 'draft':
                self.action_confirm()
            self.move_ids._nutking_apply_requested_lot()
            self._nutking_set_picked_quantities(
                allocations=allocations,
                force_demand=bool(force_demand),
            )
            context = {'skip_backorder': backorder in ('create', 'cancel')}
            if backorder == 'cancel':
                context['picking_ids_not_to_backorder'] = self.ids
            result = self.with_context(**context).button_validate()
            if isinstance(result, dict):
                return {
                    'requires_dialog': True,
                    'dialog': result.get('res_model') or result.get('tag') or 'odoo_action',
                    'action': result,
                }
        elif action == 'cancel':
            if self.state not in ('done', 'cancel'):
                self.action_cancel()
        elif action == 'unreserve':
            if self.state in ('assigned', 'partially_available'):
                self.do_unreserve()
        else:
            raise UserError(_('Unsupported native transfer action: %s') % action)
        return {'requires_dialog': False}

    def action_nutking_open_product(self):
        self.ensure_one()
        product = self.move_ids[:1].product_id
        if not product:
            return False
        return {
            'type': 'ir.actions.act_window',
            'name': product.display_name,
            'res_model': 'product.product',
            'res_id': product.id,
            'view_mode': 'form',
            'target': 'current',
        }


class StockMove(models.Model):
    _inherit = 'stock.move'

    nutking_lot_reference = fields.Char(string='Requested Batch / Lot')
    nutking_expiration_date = fields.Date(string='Requested Expiration Date')

    def _nutking_apply_requested_lot(self):
        """Create or resolve lot information on incoming/bypass moves before validation."""
        Lot = self.env['stock.lot'].sudo()
        for move in self.filtered(lambda m: m.nutking_lot_reference and m.product_id.tracking != 'none'):
            lot = Lot.search([
                ('name', '=', move.nutking_lot_reference),
                ('product_id', '=', move.product_id.id),
                ('company_id', 'in', (False, move.company_id.id)),
            ], limit=1)
            if not lot:
                can_create_lot = (
                    move.picking_id.picking_type_code == 'incoming'
                    or move.location_id.should_bypass_reservation()
                )
                if not can_create_lot:
                    raise ValidationError(_(
                        'Lot %(lot)s does not exist for %(product)s. Select an existing lot from Detailed Operations.',
                        lot=move.nutking_lot_reference,
                        product=move.product_id.display_name,
                    ))
                vals = {
                    'name': move.nutking_lot_reference,
                    'product_id': move.product_id.id,
                    'company_id': move.company_id.id,
                }
                if 'expiration_date' in Lot._fields and move.nutking_expiration_date:
                    vals['expiration_date'] = move.nutking_expiration_date
                lot = Lot.create(vals)
            if not move.move_line_ids:
                move.env['stock.move.line'].create({
                    'move_id': move.id,
                    'picking_id': move.picking_id.id,
                    'product_id': move.product_id.id,
                    'product_uom_id': move.product_uom.id,
                    'location_id': move.location_id.id,
                    'location_dest_id': move.location_dest_id.id,
                    'lot_id': lot.id,
                    'quantity': move.product_uom_qty,
                    'picked': True,
                    'company_id': move.company_id.id,
                })
            else:
                move.move_line_ids.filtered(lambda ml: not ml.lot_id).write({
                    'lot_id': lot.id,
                })
        return True


class ProductProduct(models.Model):
    _inherit = 'product.product'

    def nutking_backend_url(self):
        self.ensure_one()
        return f'/web#id={self.id}&model=product.product&view_type=form'
