import json
import uuid
from pathlib import Path

from odoo import fields, http
from odoo.fields import Command
from odoo.http import request


class NutkingOfflineController(http.Controller):

    @staticmethod
    def _require_nutking_user():
        if not request.env.user.has_group('nutking_inventory_distribution.group_nutking_user'):
            return request.make_json_response({'error': 'Nut King operations access is required.'}, status=403)
        return None

    @http.route('/nutking/offline', type='http', auth='user', methods=['GET'])
    def offline_app(self, **kwargs):
        denied = self._require_nutking_user()
        if denied:
            return denied
        module_path = Path(__file__).resolve().parents[1]
        content = (module_path / 'static' / 'offline' / 'index.html').read_text(encoding='utf-8')
        return request.make_response(content, headers=[
            ('Content-Type', 'text/html; charset=utf-8'),
            ('Cache-Control', 'no-cache'),
        ])

    @http.route('/nutking/sw.js', type='http', auth='public', methods=['GET'], csrf=False)
    def service_worker(self, **kwargs):
        module_path = Path(__file__).resolve().parents[1]
        content = (module_path / 'static' / 'offline' / 'sw.js').read_text(encoding='utf-8')
        return request.make_response(content, headers=[
            ('Content-Type', 'application/javascript; charset=utf-8'),
            ('Service-Worker-Allowed', '/nutking/'),
            ('Cache-Control', 'no-cache'),
        ])

    @http.route('/nutking/manifest.webmanifest', type='http', auth='public', methods=['GET'], csrf=False)
    def manifest(self, **kwargs):
        module_path = Path(__file__).resolve().parents[1]
        content = (module_path / 'static' / 'offline' / 'manifest.webmanifest').read_text(encoding='utf-8')
        return request.make_response(content, headers=[('Content-Type', 'application/manifest+json')])

    @http.route('/nutking/api/bootstrap', type='http', auth='user', methods=['GET'], csrf=False)
    def bootstrap(self, **kwargs):
        denied = self._require_nutking_user()
        if denied:
            return denied
        products = request.env['product.product'].search([
            ('active', '=', True),
            ('product_tmpl_id.nutking_active', '=', True),
            ('nutking_inventory_type', 'in', ('raw_material', 'finished_good')),
        ])
        trucks = request.env['nutking.truck'].search([('active', '=', True)])
        customers = request.env['res.partner'].search([('nutking_is_customer', '=', True), ('active', '=', True)])
        suppliers = request.env['res.partner'].search([('nutking_is_supplier', '=', True), ('active', '=', True)])
        reasons = request.env['nutking.movement.reason'].search([('active', '=', True)])
        capabilities = request.env['nutking.stock.operation'].allowed_operation_types_for_user()
        trips = request.env['nutking.distribution.trip'].search([
            ('state', 'in', ('planned', 'loading', 'in_progress', 'reconciliation')),
        ], order='planned_departure desc')
        quant_model = request.env['stock.quant'].sudo()
        raw_location = request.env.ref('nutking_inventory_distribution.location_rm_stock')
        finished_location = request.env.ref('nutking_inventory_distribution.location_fg_stock')
        balances = {'raw': {}, 'finished': {}, 'trucks': {}}
        for product in products:
            if product.nutking_inventory_type == 'raw_material':
                balances['raw'][str(product.id)] = quant_model._get_available_quantity(product, raw_location, strict=False)
            elif product.nutking_inventory_type == 'finished_good':
                balances['finished'][str(product.id)] = quant_model._get_available_quantity(product, finished_location, strict=False)
        for truck in trucks.filtered('stock_location_id'):
            balances['trucks'][str(truck.id)] = {
                str(product.id): quant_model._get_available_quantity(product, truck.stock_location_id, strict=False)
                for product in products.filtered(lambda item: item.nutking_inventory_type == 'finished_good')
            }
        return request.make_json_response({
            'user': {'id': request.env.user.id, 'name': request.env.user.name},
            'capabilities': capabilities,
            'balances': balances,
            'products': [{
                'id': product.id,
                'name': product.display_name,
                'barcode': product.barcode,
                'type': product.nutking_inventory_type,
                'uom': product.uom_id.name,
            } for product in products],
            'trucks': [{'id': truck.id, 'name': truck.name, 'barcode': truck.barcode} for truck in trucks],
            'customers': [{'id': partner.id, 'name': partner.display_name, 'code': partner.nutking_customer_code} for partner in customers],
            'suppliers': [{'id': partner.id, 'name': partner.display_name, 'code': partner.nutking_supplier_code} for partner in suppliers],
            'trips': [{
                'id': trip.id,
                'name': trip.name,
                'truck_id': trip.truck_id.id,
                'truck_name': trip.truck_id.name,
                'route_name': trip.route_name,
                'state': trip.state,
            } for trip in trips],
            'reasons': [{
                'id': reason.id,
                'name': reason.name,
                'code': reason.code,
                'applies_to': reason.applies_to,
                'requires_note': reason.requires_note,
            } for reason in reasons],
            'server_time': fields.Datetime.now().isoformat(),
        })

    @http.route('/nutking/api/sync', type='http', auth='user', methods=['POST'], csrf=False)
    def sync(self, **kwargs):
        denied = self._require_nutking_user()
        if denied:
            return denied
        payload = request.httprequest.get_json(silent=True) or {}
        transactions = payload.get('transactions', [])
        if not isinstance(transactions, list) or len(transactions) > 250:
            return request.make_json_response({'error': 'Invalid transaction batch.'}, status=400)

        results = []
        Offline = request.env['nutking.offline.transaction'].sudo()
        Operation = request.env['nutking.stock.operation'].with_user(request.env.user)
        for item in transactions:
            external_uid = str(item.get('external_uid') or uuid.uuid4())[:128]
            existing = Offline.search([('external_uid', '=', external_uid)], limit=1)
            if existing and existing.state == 'processed':
                results.append({
                    'external_uid': external_uid,
                    'status': 'processed',
                    'operation': existing.operation_id.name or False,
                })
                continue
            if existing and existing.operation_id:
                results.append({
                    'external_uid': external_uid,
                    'status': existing.state,
                    'operation': existing.operation_id.name or False,
                })
                continue

            offline = existing or Offline.create({
                'external_uid': external_uid,
                'device_name': str(item.get('device_name') or '')[:128],
                'created_on_device': item.get('created_on_device') or fields.Datetime.now(),
                'user_id': request.env.user.id,
                'company_id': request.env.company.id,
                'payload': json.dumps(item),
            })
            if existing:
                offline.write({
                    'payload': json.dumps(item),
                    'device_name': str(item.get('device_name') or '')[:128],
                    'received_at': fields.Datetime.now(),
                    'error_message': False,
                    'state': 'pending',
                })
            try:
                with request.env.cr.savepoint():
                    operation = Operation.create({
                        'operation_type': item['operation_type'],
                        'partner_id': int(item['partner_id']) if item.get('partner_id') else False,
                        'truck_id': int(item['truck_id']) if item.get('truck_id') else False,
                        'trip_id': int(item['trip_id']) if item.get('trip_id') else False,
                        'reason_id': int(item['reason_id']) if item.get('reason_id') else False,
                        'notes': item.get('notes'),
                        'company_id': request.env.company.id,
                        'offline_transaction_id': offline.id,
                        'line_ids': [Command.create({
                            'product_id': int(line['product_id']),
                            'quantity': float(line['quantity']),
                            'lot_reference': line.get('lot_reference'),
                        }) for line in item.get('lines', [])],
                    })
                    operation.action_confirm()
                    operation.action_process()
                offline.write({'state': 'processed', 'operation_id': operation.id, 'error_message': False})
                results.append({'external_uid': external_uid, 'status': 'processed', 'operation': operation.name})
            except Exception as exc:  # queued for supervisor review; stock work is rolled back by savepoint
                offline.write({'state': 'error', 'error_message': str(exc)[:2000]})
                results.append({'external_uid': external_uid, 'status': 'error', 'error': str(exc)})
        return request.make_json_response({'results': results})
