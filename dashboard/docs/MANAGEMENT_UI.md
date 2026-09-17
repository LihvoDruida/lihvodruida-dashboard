# Management UI structure

All `/dashboard/*` management pages now use the same desktop hierarchy:

1. `DashboardIdentity` — global app navigation.
2. `AdminPageHeader` — compact title, description and status metrics.
3. `AdminTabs` — one consistent management section switcher.
4. Page content — panels/forms using the shared control and spacing system.

The management header intentionally replaces the older large `hero +
HeroSidePanel` composition.  It reduces vertical waste on desktop and keeps
important state visible without turning every settings page into a landing
page.

The Discord management page uses a 300–360 px utility column on the left and
the main bulk operations column on the right.  Logs use a compact filter
column plus the wider Discord-log configuration panel.

Server monitoring uses two refresh speeds:

- fast snapshot every 2 seconds: CPU, per-core usage, RAM, Swap, disk, uptime;
- slow snapshot every 60 seconds: Docker/BuildKit file snapshot refresh.

Background refresh does not toggle the manual button into a loading state,
pauses while the tab is hidden, resumes immediately when visible, aborts stale
requests and backs off after errors.
