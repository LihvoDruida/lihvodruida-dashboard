# v3.8.51 — Discord embed editor input hotfix

## Root cause

`DiscordEmbedEditorInner` used `defaultAutoroleButtons = []` and also placed the raw
`defaultAutoroleButtons` array in the editor-reset `useEffect` dependency list.
When the prop was omitted (including `/discord/embed`), every local state update created
a fresh empty array. React therefore reran the reset effect after each keystroke and
restored all controlled form fields to their defaults.

## Fix

- convert autorole defaults to a semantic JSON key;
- memoize the normalized autorole snapshot by that key;
- depend on the stable semantic snapshot instead of raw array identity;
- add `check:discord-editor-input` and wire it into `verify` and `build:ci`.

This fixes text entry in `/discord/embed` and protects the same editor used by rules and
autoroles from the same class of reset regression.
