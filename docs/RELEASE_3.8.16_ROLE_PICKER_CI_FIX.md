# v3.8.16 — Role picker CI cleanup and regression guard

- removed obsolete `.roster-role-picker` and `.roster-role-check` CSS left after the shared role-picker migration;
- removed the obsolete coarse-pointer override for `.roster-role-check`;
- registered `discord-role-chip` as a deliberate semantic button in the UI audit instead of applying generic `.btn` geometry;
- added `check:role-picker` to protect the shared two-column picker, responsive collapse, roster migration and audit classification from regressions;
- wired the new check into `build:ci` before the remaining integration checks.
