# v3.8.22 — Compact selection forms

- redesigned the shared Discord `RolePicker` used by raid editor, raid-poll creation, Discord embed management and roster formation;
- role lists remain a true two-column grid on desktop/tablet and collapse only on phone-sized viewports;
- reduced role card geometry from tall stacked cards to a stable inline control/name/state row;
- fixed role action badges jumping below content by defining explicit grid areas;
- reduced selected-role summary, search field, gaps, chips and helper copy height;
- mobile role cards use a 52px compact target, hide redundant secondary hint copy and keep the action state inline;
- tightened raid role-section spacing so the shared picker no longer inherits unnecessary vertical air;
- compacted the analogous raid-poll publication choice cards on desktop and mobile;
- removed the artificial tall mobile minimum from rules/onboarding gender, raid-role and nickname-character choice cards;
- extended `check:role-picker` with regression guards for desktop two-column layout, compact heights, mobile layout and related publication-choice geometry.
