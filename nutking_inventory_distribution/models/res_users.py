from odoo import api, models
from odoo.fields import Command


class ResUsers(models.Model):
    _inherit = 'res.users'

    @api.model
    def nutking_recover_system_administrators(self):
        """Keep Odoo administrators out of the worker-only Operations app.

        Earlier staging releases temporarily implied Nut King Management from
        ``base.group_system``. Removing that implication does not always remove
        direct group assignments or a previously selected Home Action from
        existing users. On every module upgrade, normalize system administrators
        so ``/web`` opens a real backend action instead of the worker PWA.
        """
        system_group = self.env.ref('base.group_system')
        backend_action = self.env.ref(
            'nutking_inventory_distribution.action_nutking_dashboard',
            raise_if_not_found=False,
        )

        worker_group_xmlids = (
            'nutking_inventory_distribution.group_nutking_manager',
            'nutking_inventory_distribution.group_nutking_supervisor',
            'nutking_inventory_distribution.group_nutking_distribution',
            'nutking_inventory_distribution.group_nutking_finished_clerk',
            'nutking_inventory_distribution.group_nutking_raw_clerk',
            'nutking_inventory_distribution.group_nutking_user',
        )
        worker_groups = self.env['res.groups'].sudo().browse()
        for xmlid in worker_group_xmlids:
            group = self.env.ref(xmlid, raise_if_not_found=False)
            if group:
                worker_groups |= group

        # ``group_ids`` contains explicit memberships. System administrators
        # must not be explicit worker-role users; they can still test /nutking/
        # because the controller separately permits ``base.group_system``.
        administrators = system_group.sudo().user_ids
        commands = [Command.unlink(group.id) for group in worker_groups]
        values = {}
        if commands:
            values['group_ids'] = commands
        if backend_action:
            # A concrete backend home action prevents the web client from
            # restoring the worker URL action when /web is entered directly.
            values['action_id'] = backend_action.id
        if values and administrators:
            administrators.sudo().write(values)

        self.env.registry.clear_cache()
        return True
