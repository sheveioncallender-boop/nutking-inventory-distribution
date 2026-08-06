from odoo import api, models
from odoo.fields import Command


class ResUsers(models.Model):
    _inherit = 'res.users'

    @api.model
    def nutking_recover_system_administrators(self):
        """Keep Odoo administrators out of the worker-only Operations app.

        Earlier staging releases temporarily implied Nut King Management from
        ``base.group_system`` and assigned a Nut King Home Action. Removing the
        implication does not always remove direct memberships or the old Home
        Action. On every module upgrade, normalize system administrators so
        ``/web`` opens Odoo's normal backend and never the worker PWA.
        """
        system_group = self.env.ref('base.group_system')
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
        # Clear any Home Action left by staging builds. With no forced Home
        # Action, /web opens Odoo's normal backend instead of a worker URL or
        # a custom model the administrator may not be allowed to read.
        values['action_id'] = False
        if values and administrators:
            administrators.sudo().write(values)

        self.env.registry.clear_cache()
        return True
