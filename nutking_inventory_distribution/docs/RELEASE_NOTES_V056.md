# Nut King v0.5.6 — Community Backend Recovery

- Confirms the module remains based only on Odoo 19 Community dependencies: `stock`, `contacts`, and `mail`.
- Removes stale Nut King worker-role assignments from Settings administrators on every install/upgrade.
- Sets the Nut King backend dashboard as the Home Action for Settings administrators, so entering `/web` stays inside Odoo.
- Preserves manual administrator access to `/nutking/` for testing without making the administrator a worker-role user.
- Makes `/nutking/backend` repair the current administrator before opening the backend.
- Does not activate the final worker `/web` lock-down.
