import json
import uuid
from collections import defaultdict

from odoo import fields, http
from odoo.fields import Command
from odoo.http import request
from odoo.tools.float_utils import float_compare


class NutkingHybridController(http.Controller):
    """Offline-first doorway into Odoo's native stock transfer workflow.

    The worker workspace mirrors native Odoo states and actions, while every
    official transaction is a real ``stock.picking``. Offline requests remain
    provisional until this controller replays them against the current Odoo
    inventory database.
    """

    MAX_BATCH = 250
    MAX_LINES = 500

    @staticmethod
    def _require_user():
        user = request.env.user
        if not (
            user.has_group('nutking_inventory_distribution.group_nutking_user')
            or user.has_group('base.group_system')
        ):
            return request.make_json_response(
                {'error': 'Nut King operations access is required.'}, status=403
            )
        return None

    @staticmethod
    def _body():
        return request.httprequest.get_json(silent=True) or {}

    @staticmethod
    def _safe_int(value):
        try:
            return int(value) if value not in (None, False, '') else False
        except (TypeError, ValueError):
            return False

    @staticmethod
    def _device_datetime(value):
        if not value:
            return fields.Datetime.now()
        normalized = str(value).replace('T', ' ').replace('Z', '')[:19]
        try:
            return fields.Datetime.to_datetime(normalized)
        except (TypeError, ValueError):
            return fields.Datetime.now()

    @staticmethod
    def _serialize_datetime(value):
        return value.isoformat() if value else ''

    @staticmethod
    def _descendant_domain(location):
        return [('location_id', 'child_of', location.id)]

    @classmethod
    def _resolve_partner(cls, partner_id, customer=False, supplier=False):
        partner_id = cls._safe_int(partner_id)
        if not partner_id:
            return request.env['res.partner']
        partner = request.env['res.partner'].sudo().browse(partner_id).exists()
        if not partner:
            raise ValueError('The selected contact no longer exists.')
        if customer and not partner.nutking_is_customer:
            raise ValueError('Select a Nut King customer or company.')
        if supplier and not partner.nutking_is_supplier:
            raise ValueError('Select a Nut King supplier.')
        return partner

    @classmethod
    def _resolve_partner_from_item(cls, item, customer=False, supplier=False):
        partner = cls._resolve_partner(
            item.get('partner_id'), customer=customer, supplier=supplier
        )
        if partner:
            return partner
        external_uid = str(item.get('partner_external_uid') or '')[:128]
        if external_uid:
            transaction = request.env['nutking.offline.transaction'].sudo().search([
                ('external_uid', '=', external_uid),
                ('partner_id', '!=', False),
                ('company_id', '=', request.env.company.id),
            ], limit=1)
            partner = transaction.partner_id
            if partner:
                if customer and not partner.nutking_is_customer:
                    raise ValueError('Select a Nut King customer or company.')
                if supplier and not partner.nutking_is_supplier:
                    raise ValueError('Select a Nut King supplier.')
                return partner
        return request.env['res.partner']

    @classmethod
    def _resolve_truck(cls, truck_id):
        truck_id = cls._safe_int(truck_id)
        if not truck_id:
            return request.env['nutking.truck']
        truck = request.env['nutking.truck'].sudo().browse(truck_id).exists()
        if not truck or truck.company_id != request.env.company:
            raise ValueError('Select a valid Nut King truck.')
        if not truck.stock_location_id:
            truck._ensure_stock_locations()
        if not truck.stock_location_id:
            raise ValueError('The selected truck has no inventory location.')
        return truck

    @classmethod
    def _resolve_trip(cls, trip_id, trip_external_uid=''):
        trip_id = cls._safe_int(trip_id)
        if trip_id:
            trip = request.env['nutking.distribution.trip'].sudo().browse(trip_id).exists()
            if trip and trip.company_id == request.env.company:
                return trip
        if trip_external_uid:
            transaction = request.env['nutking.offline.transaction'].sudo().search([
                ('external_uid', '=', str(trip_external_uid)[:128]),
                ('trip_id', '!=', False),
                ('company_id', '=', request.env.company.id),
            ], limit=1)
            if transaction.trip_id:
                return transaction.trip_id
        return request.env['nutking.distribution.trip']

    @classmethod
    def _resolve_picking(cls, item):
        picking_id = cls._safe_int(item.get('picking_id'))
        if picking_id:
            picking = request.env['stock.picking'].sudo().browse(picking_id).exists()
            if picking and picking.company_id == request.env.company and picking.nutking_is_operation:
                return picking
        source_uid = str(
            item.get('transfer_external_uid')
            or item.get('picking_external_uid')
            or item.get('operation_external_uid')
            or ''
        )[:128]
        if source_uid:
            transaction = request.env['nutking.offline.transaction'].sudo().search([
                ('external_uid', '=', source_uid),
                ('picking_id', '!=', False),
                ('company_id', '=', request.env.company.id),
            ], limit=1)
            if transaction.picking_id:
                return transaction.picking_id
        return request.env['stock.picking']

    @classmethod
    def _operation_map(cls, item):
        kind = item.get('operation_type') or item.get('operation_kind')
        company = request.env.company
        ref = request.env.ref
        raw_stock = ref('nutking_inventory_distribution.location_rm_stock')
        raw_issued = ref('nutking_inventory_distribution.location_rm_issued')
        fg_stock = ref('nutking_inventory_distribution.location_fg_stock')
        adjustment = ref('nutking_inventory_distribution.location_nutking_adjustment')
        suppliers = ref('stock.stock_location_suppliers')
        customers = ref('stock.stock_location_customers')
        truck = cls._resolve_truck(item.get('truck_id'))
        trip = cls._resolve_trip(item.get('trip_id'), item.get('trip_external_uid'))
        partner = request.env['res.partner']
        reason = request.env['nutking.movement.reason']

        mappings = {
            'raw_receipt': {
                'picking_type': ref('nutking_inventory_distribution.picking_type_nutking_raw_receipt'),
                'source': suppliers,
                'destination': raw_stock,
                'product_type': 'raw_material',
                'partner_mode': 'supplier',
            },
            'raw_issue': {
                'picking_type': ref('nutking_inventory_distribution.picking_type_nutking_raw_issue'),
                'source': raw_stock,
                'destination': raw_issued,
                'product_type': 'raw_material',
                'reason_required': True,
            },
            'finished_add': {
                'picking_type': ref('nutking_inventory_distribution.picking_type_nutking_finished_receipt'),
                'source': adjustment,
                'destination': fg_stock,
                'product_type': 'finished_good',
            },
            'finished_issue': {
                'picking_type': ref('nutking_inventory_distribution.picking_type_nutking_finished_truck'),
                'source': fg_stock,
                'destination': truck.stock_location_id if truck else False,
                'product_type': 'finished_good',
                'truck_required': True,
                'partner_mode': 'customer_optional',
            },
            'truck_load': {
                'picking_type': ref('nutking_inventory_distribution.picking_type_nutking_finished_truck'),
                'source': fg_stock,
                'destination': truck.stock_location_id if truck else False,
                'product_type': 'finished_good',
                'truck_required': True,
                'partner_mode': 'customer_optional',
            },
            'customer_delivery': {
                'picking_type': ref('nutking_inventory_distribution.picking_type_nutking_customer_delivery'),
                'source': truck.stock_location_id if truck else False,
                'destination': customers,
                'product_type': 'finished_good',
                'truck_required': True,
                'partner_mode': 'customer',
            },
            'truck_return': {
                'picking_type': ref('nutking_inventory_distribution.picking_type_nutking_truck_return'),
                'source': truck.stock_location_id if truck else False,
                'destination': fg_stock,
                'product_type': 'finished_good',
                'truck_required': True,
                'reason_required': True,
            },
        }
        config = mappings.get(kind)
        if not config:
            raise ValueError('This operation is not available in the native Nut King workflow.')
        if config.get('truck_required') and not truck:
            raise ValueError('Select the truck for this transfer.')
        partner_mode = config.get('partner_mode')
        if partner_mode == 'supplier':
            partner = cls._resolve_partner_from_item(item, supplier=True)
            if not partner:
                raise ValueError('Select the supplier.')
        elif partner_mode == 'customer':
            partner = cls._resolve_partner_from_item(item, customer=True)
            if not partner:
                raise ValueError('Select the customer or company.')
        elif partner_mode == 'customer_optional':
            has_partner = bool(item.get('partner_id') or item.get('partner_external_uid'))
            partner = cls._resolve_partner_from_item(item, customer=True) if has_partner else request.env['res.partner']
        reason_id = cls._safe_int(item.get('reason_id'))
        if reason_id:
            reason = request.env['nutking.movement.reason'].sudo().browse(reason_id).exists()
        if config.get('reason_required') and not reason:
            raise ValueError('Select the movement reason.')
        if not config['source'] or not config['destination']:
            raise ValueError('The source or destination location is not configured.')
        config.update({
            'kind': kind,
            'partner': partner,
            'truck': truck,
            'trip': trip,
            'reason': reason,
            'company': company,
        })
        return config

    @classmethod
    def _create_native_transfer(cls, item, offline):
        config = cls._operation_map(item)
        lines = item.get('lines') or []
        if not isinstance(lines, list) or not lines or len(lines) > cls.MAX_LINES:
            raise ValueError(f'Add between 1 and {cls.MAX_LINES} product lines.')
        move_commands = []
        seen = set()
        for line in lines:
            product_id = cls._safe_int(line.get('product_id'))
            product = request.env['product.product'].sudo().browse(product_id).exists()
            if not product or product.nutking_inventory_type != config['product_type']:
                raise ValueError('One or more selected products do not belong to this warehouse.')
            quantity = float(line.get('quantity') or 0.0)
            if float_compare(quantity, 0.0, precision_rounding=product.uom_id.rounding) <= 0:
                raise ValueError(f'Enter a positive quantity for {product.display_name}.')
            identity = (product.id, str(line.get('lot_reference') or ''))
            if identity in seen:
                raise ValueError(f'Combine duplicate lines for {product.display_name}.')
            seen.add(identity)
            move_commands.append(Command.create({
                'name': product.display_name,
                'product_id': product.id,
                'product_uom_qty': quantity,
                'product_uom': product.uom_id.id,
                'location_id': config['source'].id,
                'location_dest_id': config['destination'].id,
                'nutking_lot_reference': str(line.get('lot_reference') or '')[:128] or False,
                'nutking_expiration_date': line.get('expiration_date') or False,
            }))
        picking = request.env['stock.picking'].sudo().create({
            'picking_type_id': config['picking_type'].id,
            'location_id': config['source'].id,
            'location_dest_id': config['destination'].id,
            'partner_id': config['partner'].id or False,
            'scheduled_date': cls._device_datetime(item.get('scheduled_date') or item.get('created_on_device')),
            'origin': str(item.get('reference') or '')[:256] or False,
            'move_ids': move_commands,
            'nutking_is_operation': True,
            'nutking_operation_kind': config['kind'],
            'nutking_truck_id': config['truck'].id or False,
            'nutking_trip_id': config['trip'].id or False,
            'nutking_reason_id': config['reason'].id or False,
            'nutking_offline_uid': offline.external_uid,
            'nutking_device_name': offline.device_name,
            'nutking_created_offline': bool(item.get('created_offline') or item.get('offline') or not item.get('online_created')),
            'nutking_source_reference': str(item.get('reference') or '')[:256] or False,
            'note': str(item.get('notes') or '')[:4000] or False,
            'company_id': config['company'].id,
        })
        offline.write({'picking_id': picking.id, 'result_reference': picking.name})
        for action in item.get('actions') or []:
            result = cls._apply_native_action(picking, action, item)
            if result.get('requires_dialog'):
                break
        return picking

    @classmethod
    def _apply_native_action(cls, picking, action, item):
        if action == 'return':
            return cls._create_return(picking, item)
        allocations = item.get('allocations') or []
        backorder = item.get('backorder') or 'ask'
        force_demand = bool(item.get('force_demand'))
        return picking.nutking_execute_action(
            action,
            allocations=allocations,
            backorder=backorder,
            force_demand=force_demand,
        )

    @classmethod
    def _create_return(cls, picking, item):
        if picking.state != 'done':
            raise ValueError('Only a completed transfer can be returned.')
        wizard = request.env['stock.return.picking'].sudo().with_context(
            active_model='stock.picking', active_id=picking.id, active_ids=picking.ids
        ).create({'picking_id': picking.id})
        requested = {
            cls._safe_int(line.get('move_id')): float(line.get('quantity') or 0.0)
            for line in (item.get('return_lines') or [])
            if cls._safe_int(line.get('move_id'))
        }
        if requested:
            for line in wizard.product_return_moves:
                line.quantity = max(0.0, requested.get(line.move_id.id, 0.0))
        action = wizard.action_create_returns() if requested else wizard.action_create_returns_all()
        return_picking = request.env['stock.picking'].sudo().browse(action.get('res_id')).exists()
        if return_picking:
            return_picking.write({
                'nutking_is_operation': True,
                'nutking_operation_kind': 'truck_return',
                'nutking_truck_id': picking.nutking_truck_id.id or False,
                'nutking_trip_id': picking.nutking_trip_id.id or False,
                'nutking_source_reference': f'Return of {picking.name}',
            })
        return {
            'requires_dialog': False,
            'return_picking_id': return_picking.id or False,
            'return_reference': return_picking.name or '',
        }

    @classmethod
    def _serialize_move(cls, move):
        return {
            'id': move.id,
            'product_id': move.product_id.id,
            'product': move.product_id.display_name,
            'barcode': move.product_id.barcode or '',
            'demand': move.product_uom_qty,
            'quantity': move.quantity,
            'uom': move.product_uom.name,
            'source_id': move.location_id.id,
            'source': move.location_id.display_name,
            'destination_id': move.location_dest_id.id,
            'destination': move.location_dest_id.display_name,
            'lot_reference': move.nutking_lot_reference or '',
            'expiration_date': str(move.nutking_expiration_date or ''),
            'state': move.state,
            'move_lines': [{
                'id': line.id,
                'location_id': line.location_id.id,
                'location': line.location_id.display_name,
                'location_dest_id': line.location_dest_id.id,
                'location_dest': line.location_dest_id.display_name,
                'lot_id': line.lot_id.id or False,
                'lot': line.lot_id.name or line.lot_name or '',
                'package_id': line.package_id.id or False,
                'package': line.package_id.name or '',
                'quantity': line.quantity,
                'picked': line.picked,
            } for line in move.move_line_ids],
        }

    @classmethod
    def _serialize_picking(cls, picking):
        label = picking._nutking_native_label()
        return {
            'id': picking.id,
            'name': picking.name,
            'operation_type': picking.nutking_operation_kind,
            'operation_label': dict(picking._fields['nutking_operation_kind'].selection).get(
                picking.nutking_operation_kind, picking.picking_type_id.name
            ),
            'picking_type': picking.picking_type_id.name,
            'picking_type_code': picking.picking_type_code,
            'state': picking.state,
            'state_label': label,
            'native_stage': (
                'draft' if picking.state == 'draft'
                else 'ready' if picking.state == 'assigned'
                else 'done' if picking.state == 'done'
                else 'cancel' if picking.state == 'cancel'
                else 'waiting'
            ),
            'available_actions': picking._nutking_available_actions(),
            'scheduled_date': cls._serialize_datetime(picking.scheduled_date),
            'date_done': cls._serialize_datetime(picking.date_done),
            'partner_id': picking.partner_id.id or False,
            'partner': picking.partner_id.display_name or '',
            'truck_id': picking.nutking_truck_id.id or False,
            'truck': picking.nutking_truck_id.name or '',
            'trip_id': picking.nutking_trip_id.id or False,
            'trip': picking.nutking_trip_id.name or '',
            'reason_id': picking.nutking_reason_id.id or False,
            'reason': picking.nutking_reason_id.name or '',
            'reference': picking.nutking_source_reference or picking.origin or '',
            'notes': picking.note or '',
            'source_id': picking.location_id.id,
            'source': picking.location_id.display_name,
            'destination_id': picking.location_dest_id.id,
            'destination': picking.location_dest_id.display_name,
            'quantity': sum(picking.move_ids.mapped('product_uom_qty')),
            'offline_uid': picking.nutking_offline_uid or '',
            'device_name': picking.nutking_device_name or '',
            'created_offline': picking.nutking_created_offline,
            'moves': [cls._serialize_move(move) for move in picking.move_ids],
            'lines': [{
                'move_id': move.id,
                'product_id': move.product_id.id,
                'product': move.product_id.display_name,
                'barcode': move.product_id.barcode or '',
                'quantity': move.product_uom_qty,
                'reserved_quantity': move.quantity,
                'uom': move.product_uom.name,
                'lot_reference': move.nutking_lot_reference or '',
                'expiration_date': str(move.nutking_expiration_date or ''),
            } for move in picking.move_ids],
            'web_url': f'/web#id={picking.id}&model=stock.picking&view_type=form',
            'print_url': f'/nutking/native-transfer/{picking.id}/print',
        }

    @classmethod
    def _location_snapshot(cls, products):
        Quant = request.env['stock.quant'].sudo()
        quants = Quant.search([
            ('product_id', 'in', products.ids),
            ('location_id.nutking_is_location', '=', True),
            ('company_id', 'in', (False, request.env.company.id)),
        ], order='product_id, location_id, lot_id, package_id')
        return [{
            'quant_id': quant.id,
            'product_id': quant.product_id.id,
            'location_id': quant.location_id.id,
            'location': quant.location_id.display_name,
            'lot_id': quant.lot_id.id or False,
            'lot': quant.lot_id.name or '',
            'package_id': quant.package_id.id or False,
            'package': quant.package_id.name or '',
            'quantity': quant.quantity,
            'reserved_quantity': quant.reserved_quantity,
            'available_quantity': quant.available_quantity,
        } for quant in quants]

    @classmethod
    def _product_details(cls, products):
        Move = request.env['stock.move'].sudo()
        Quant = request.env['stock.quant'].sudo()
        result = []
        for product in products:
            move_domain = [
                ('product_id', '=', product.id),
                ('state', '!=', 'cancel'),
                '|', ('location_id.nutking_is_location', '=', True),
                     ('location_dest_id.nutking_is_location', '=', True),
            ]
            recent_moves = Move.search(move_domain, order='date desc, id desc', limit=60)
            open_moves = recent_moves.filtered(lambda move: move.state not in ('done', 'cancel'))
            location_rows = []
            grouped = defaultdict(lambda: {'quantity': 0.0, 'reserved': 0.0, 'available': 0.0})
            quants = Quant.search([
                ('product_id', '=', product.id),
                ('location_id.nutking_is_location', '=', True),
                ('company_id', 'in', (False, request.env.company.id)),
            ], order='location_id, lot_id')
            for quant in quants:
                key = (quant.location_id.id, quant.location_id.display_name, quant.lot_id.id or False, quant.lot_id.name or '')
                grouped[key]['quantity'] += quant.quantity
                grouped[key]['reserved'] += quant.reserved_quantity
                grouped[key]['available'] += quant.available_quantity
            for key, amounts in grouped.items():
                location_rows.append({
                    'location_id': key[0], 'location': key[1],
                    'lot_id': key[2], 'lot': key[3], **amounts,
                })
            result.append({
                'product_id': product.id,
                'name': product.display_name,
                'default_code': product.default_code or '',
                'barcode': product.barcode or '',
                'uom': product.uom_id.name,
                'tracking': product.tracking,
                'on_hand': product.qty_available,
                'free_qty': product.free_qty,
                'incoming_qty': product.incoming_qty,
                'outgoing_qty': product.outgoing_qty,
                'forecasted_qty': product.virtual_available,
                'backend_url': product.nutking_backend_url(),
                'locations': location_rows,
                'reservations': [{
                    'move_id': move.id,
                    'reference': move.picking_id.name or move.reference or '',
                    'picking_id': move.picking_id.id or False,
                    'partner': move.picking_id.partner_id.display_name or '',
                    'truck': move.picking_id.nutking_truck_id.name or '',
                    'trip': move.picking_id.nutking_trip_id.name or '',
                    'demand': move.product_uom_qty,
                    'reserved': move.quantity,
                    'state': move.picking_id._nutking_native_label() if move.picking_id.nutking_is_operation else move.state,
                    'scheduled_date': cls._serialize_datetime(move.picking_id.scheduled_date),
                } for move in open_moves],
                'moves': [{
                    'move_id': move.id,
                    'date': cls._serialize_datetime(move.date),
                    'reference': move.picking_id.name or move.reference or '',
                    'source': move.location_id.display_name,
                    'destination': move.location_dest_id.display_name,
                    'demand': move.product_uom_qty,
                    'quantity': move.quantity,
                    'state': move.state,
                    'partner': move.picking_id.partner_id.display_name or '',
                } for move in recent_moves],
            })
        return result

    @http.route('/nutking/api/hybrid-bootstrap', type='http', auth='user', methods=['GET'], csrf=False)
    def hybrid_bootstrap(self, **kwargs):
        denied = self._require_user()
        if denied:
            return denied
        products = request.env['product.product'].sudo().search([
            ('active', '=', True),
            ('product_tmpl_id.nutking_active', '=', True),
            ('nutking_inventory_type', 'in', ('raw_material', 'finished_good')),
        ], order='name')
        pickings = request.env['stock.picking'].sudo().search([
            ('nutking_is_operation', '=', True),
            ('company_id', '=', request.env.company.id),
        ], order='scheduled_date desc, id desc', limit=250)
        locations = request.env['stock.location'].sudo().search([
            ('nutking_is_location', '=', True),
            ('usage', '!=', 'view'),
            ('company_id', 'in', (False, request.env.company.id)),
        ], order='complete_name')
        return request.make_json_response({
            'native_transfers': [self._serialize_picking(picking) for picking in pickings],
            'product_details': self._product_details(products),
            'stock_by_location': self._location_snapshot(products),
            'hybrid_locations': [{
                'id': location.id,
                'name': location.display_name,
                'usage': location.usage,
                'barcode': location.barcode or '',
                'parent_id': location.location_id.id or False,
            } for location in locations],
            'server_time': fields.Datetime.now().isoformat(),
        })

    @http.route('/nutking/api/contact/create', type='http', auth='user', methods=['POST'], csrf=False)
    def create_contact(self, **kwargs):
        denied = self._require_user()
        if denied:
            return denied
        item = self._body()
        name = str(item.get('name') or '').strip()[:256]
        if not name:
            return request.make_json_response({'error': 'Enter the customer or company name.'}, status=400)
        company_type = 'company' if item.get('company_type') == 'company' else 'person'
        partner = request.env['res.partner'].sudo().create({
            'name': name,
            'company_type': company_type,
            'is_company': company_type == 'company',
            'phone': str(item.get('phone') or '')[:64] or False,
            'nutking_mobile': str(item.get('mobile') or '')[:64] or False,
            'email': str(item.get('email') or '')[:256] or False,
            'street': str(item.get('street') or '')[:256] or False,
            'street2': str(item.get('street2') or '')[:256] or False,
            'city': str(item.get('city') or '')[:128] or False,
            'nutking_customer_code': str(item.get('customer_code') or '')[:64] or False,
            'nutking_route': str(item.get('route') or '')[:128] or False,
            'nutking_delivery_notes': str(item.get('notes') or '')[:2000] or False,
            'nutking_is_customer': True,
        })
        return request.make_json_response({'customer': {
            'id': partner.id,
            'name': partner.display_name,
            'code': partner.nutking_customer_code or '',
            'phone': partner.phone or partner.nutking_mobile or '',
            'email': partner.email or '',
            'route': partner.nutking_route or '',
            'address': partner.contact_address or '',
            'notes': partner.nutking_delivery_notes or '',
            'company_type': partner.company_type,
        }})

    @classmethod
    def _process_native_item(cls, item, offline):
        kind = item.get('kind') or item.get('transaction_kind')
        if kind == 'contact_create':
            name = str(item.get('name') or '').strip()[:256]
            if not name:
                raise ValueError('Enter the customer or company name.')
            partner = request.env['res.partner'].sudo().create({
                'name': name,
                'company_type': 'company' if item.get('company_type') == 'company' else 'person',
                'is_company': item.get('company_type') == 'company',
                'phone': str(item.get('phone') or '')[:64] or False,
                'nutking_mobile': str(item.get('mobile') or '')[:64] or False,
                'email': str(item.get('email') or '')[:256] or False,
                'street': str(item.get('street') or '')[:256] or False,
                'street2': str(item.get('street2') or '')[:256] or False,
                'city': str(item.get('city') or '')[:128] or False,
                'nutking_customer_code': str(item.get('customer_code') or '')[:64] or False,
                'nutking_route': str(item.get('route') or '')[:128] or False,
                'nutking_delivery_notes': str(item.get('notes') or '')[:2000] or False,
                'nutking_is_customer': True,
            })
            offline.write({'partner_id': partner.id, 'result_reference': partner.display_name})
            return {'reference': partner.display_name, 'partner_id': partner.id}
        if kind == 'native_transfer':
            picking = cls._create_native_transfer(item, offline)
            return {'reference': picking.name, 'picking_id': picking.id, 'transfer': cls._serialize_picking(picking)}
        if kind in ('native_transfer_event', 'native_return'):
            picking = cls._resolve_picking(item)
            if not picking:
                raise ValueError('The stock transfer could not be found. Synchronize and reopen it.')
            action = item.get('action') or ('return' if kind == 'native_return' else '')
            result = cls._apply_native_action(picking, action, item)
            offline.write({'picking_id': picking.id, 'result_reference': picking.name})
            response = {'reference': picking.name, 'picking_id': picking.id, 'transfer': cls._serialize_picking(picking)}
            response.update(result or {})
            return response
        raise ValueError('Unsupported native Nut King transaction type.')

    @http.route('/nutking/api/native-sync', type='http', auth='user', methods=['POST'], csrf=False)
    def native_sync(self, **kwargs):
        denied = self._require_user()
        if denied:
            return denied
        payload = self._body()
        transactions = payload.get('transactions') or []
        if not isinstance(transactions, list) or len(transactions) > self.MAX_BATCH:
            return request.make_json_response({'error': 'Invalid native transaction batch.'}, status=400)
        priority = {'contact_create': 0, 'native_transfer': 10, 'native_transfer_event': 20, 'native_return': 30}
        transactions = sorted(transactions, key=lambda item: (
            priority.get(item.get('kind') or item.get('transaction_kind'), 99),
            str(item.get('created_on_device') or ''),
        ))
        Offline = request.env['nutking.offline.transaction'].sudo()
        results = []
        for item in transactions:
            external_uid = str(item.get('external_uid') or uuid.uuid4())[:128]
            kind = item.get('kind') or item.get('transaction_kind')
            existing = Offline.search([
                ('external_uid', '=', external_uid),
                ('company_id', '=', request.env.company.id),
            ], limit=1)
            if existing and existing.state == 'processed':
                results.append({
                    'external_uid': external_uid,
                    'kind': existing.transaction_kind,
                    'status': 'processed',
                    'reference': existing.result_reference or '',
                    'picking_id': existing.picking_id.id or False,
                    'partner_id': existing.partner_id.id or False,
                })
                continue
            values = {
                'transaction_kind': kind,
                'device_name': str(item.get('device_name') or '')[:128],
                'created_on_device': self._device_datetime(item.get('created_on_device')),
                'user_id': request.env.user.id,
                'company_id': request.env.company.id,
                'payload': json.dumps(item),
                'received_at': fields.Datetime.now(),
                'state': 'pending',
                'error_message': False,
            }
            offline = existing or Offline.create({'external_uid': external_uid, **values})
            if existing:
                offline.write(values)
            try:
                with request.env.cr.savepoint():
                    result = self._process_native_item(item, offline)
                if result.get('requires_dialog'):
                    offline.write({'state': 'pending', 'error_message': False})
                    results.append({
                        'external_uid': external_uid,
                        'kind': kind,
                        'status': 'needs_action',
                        **result,
                    })
                else:
                    offline.write({'state': 'processed', 'error_message': False})
                    results.append({'external_uid': external_uid, 'kind': kind, 'status': 'processed', **result})
            except Exception as exc:
                offline.write({'state': 'error', 'error_message': str(exc)[:2000]})
                results.append({'external_uid': external_uid, 'kind': kind, 'status': 'error', 'error': str(exc)})
        return request.make_json_response({'results': results, 'server_time': fields.Datetime.now().isoformat()})

    @http.route('/nutking/native-transfer/<int:picking_id>/print', type='http', auth='user', methods=['GET'])
    def print_native_transfer(self, picking_id, **kwargs):
        denied = self._require_user()
        if denied:
            return denied
        picking = request.env['stock.picking'].sudo().browse(picking_id).exists()
        if not picking or picking.company_id != request.env.company or not picking.nutking_is_operation:
            return request.not_found()
        try:
            pdf, _fmt = request.env['ir.actions.report']._render_qweb_pdf(
                'stock.action_report_delivery', res_ids=[picking.id]
            )
        except Exception as exc:
            return request.make_response(f'Unable to print this stock transfer: {exc}', status=500)
        filename = f'Nut-King-{picking.name}'.replace('/', '-').replace('\\', '-')
        return request.make_response(pdf, headers=[
            ('Content-Type', 'application/pdf'),
            ('Content-Length', str(len(pdf))),
            ('Content-Disposition', f'inline; filename="{filename}.pdf"'),
            ('Cache-Control', 'no-store, max-age=0'),
        ])
