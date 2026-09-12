#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Resolve from this script instead of process.cwd() so the cleanup is stable
// whether it is invoked by npm, Docker, CI, or directly from the repo root.
const dashboardRoot = path.resolve(__dirname, '..');

const legacyPaths = [
  'src/components/HomeDashboardLiveSync.tsx',
  'src/components/HomeLocalTime.tsx',
  'src/components/HomeUpcomingRaidList.tsx',
  'src/components/SectionIcon.tsx',
  'src/lib/dashboardAuditNotifications.ts',
  'public/ui-icons',
];

let removed = 0;

for (const relativePath of legacyPaths) {
  const absolutePath = path.join(dashboardRoot, relativePath);
  if (!fs.existsSync(absolutePath)) continue;

  const stat = fs.lstatSync(absolutePath);
  if (stat.isDirectory()) {
    fs.rmSync(absolutePath, { recursive: true, force: true });
  } else {
    fs.rmSync(absolutePath, { force: true });
  }

  removed += 1;
  console.log(`[cleanup-legacy] removed ${relativePath}`);
}

console.log(`[cleanup-legacy] OK — ${removed} stale path(s) removed.`);
