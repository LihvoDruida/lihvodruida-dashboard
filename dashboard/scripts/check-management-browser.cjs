"use strict";
// Render the production shell, navigation and UI primitives with synthetic identities.
// Network auth/Discord/PostgreSQL are deliberately outside this visual test.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { once } = require("node:events");
const root = path.resolve(__dirname, "..");
const lookup = [process.env.MISTBLOSSOM_QA_MODULES || root, process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || root];
const { chromium } = require(require.resolve("playwright", { paths: lookup }));
const esbuild = require(require.resolve("esbuild", { paths: lookup }));
const output = process.env.MISTBLOSSOM_QA_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), "management-ui-"));
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "identity.tsx"), 'export default function Identity(){return <div className="panel"><strong>Mistblossom Vanguard</strong> · Керування гільдією</div>}');
fs.writeFileSync(path.join(output, "link.tsx"), 'export default function Link({children,href,...props}){return <a {...props} href={href}>{children}</a>}');
fs.writeFileSync(path.join(output, "entry.tsx"), `
import {createRoot} from 'react-dom/client';
import Shell from '@/components/management/ManagementShell';
import Header from '@/components/AdminPageHeader';
import Sections from '@/components/ManagementSections';
import Field from '@/components/ui/FormField';
import Button from '@/components/ui/Button';
import Table from '@/components/ui/DataTable';
const owner=new URLSearchParams(location.search).get('role')!=='reader';
const user={provider:'discord',id:'visual-fixture',name:'Тестовий користувач',role:owner?'admin':'member',isServerOwner:owner,permissions:['dashboard.view','groups.view']};
createRoot(document.getElementById('app')).render(<Shell user={user} active="groups">
<Header eyebrow="Mistblossom Vanguard • Права" title="Групи та права доступу" description="Керуй дозволами груп і перевіряй актуальний доступ до розділів." metrics={[{label:'Поточна група',value:owner?'Власник сервера':'Спостерігач',tone:'good'},{label:'Груп',value:'4'},{label:'Сховище',value:'PostgreSQL'}]}/>
<Sections sections={[{id:'permissions',label:'Дозволи',description:'Кожна дія перевіряється сервером.'},{id:'details',label:'Параметри',description:'Налаштування вибраної групи.'}]}>
<Table caption="Групи доступу" headings={['Група','Ранг','Дозволи']}><tr><th scope="row">Адміністратор</th><td>100</td><td>Керування групами та правами</td></tr><tr><th scope="row">Модератор</th><td>50</td><td>Заявки, рейди та публікації Discord</td></tr><tr><th scope="row">Наставник</th><td>20</td><td>Перегляд заявок</td></tr><tr><th scope="row">Учасник</th><td>10</td><td>Профіль та перегляд рейдів</td></tr></Table>
<form className="panel"><Field name="groupName" label="Назва групи" defaultValue="Спостерігач" maxLength={80} hint="Зрозуміла назва для меню та профілів."/><Field label="Discord role ID" name="roleId" error="Вкажи коректний ID ролі"/><Button tone="primary" disabled={!owner}>Зберегти</Button></form>
</Sections></Shell>);
`);
(async () => {
  await esbuild.build({ entryPoints: [path.join(output, "entry.tsx")], outfile: path.join(output, "app.js"), bundle: true, jsx: "automatic", tsconfig: path.join(root, "tsconfig.json"), nodePaths: [path.join(root, "node_modules")], alias: { "@/components/DashboardIdentity": path.join(output, "identity.tsx"), "next/link": path.join(output, "link.tsx") }, define: { "process.env.NODE_ENV": '"production"' } });
  const css = [...fs.readFileSync(path.join(root, "src/app/layout.tsx"), "utf8").matchAll(/import "\.\/styles\/([^\"]+\.css)";/g)].map(match => fs.readFileSync(path.join(root, "src/app/styles", match[1]), "utf8")).join("\n");
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js") { res.setHeader("content-type", "text/javascript"); return res.end(fs.readFileSync(path.join(output, "app.js"))); }
    if (req.url === "/style.css") { res.setHeader("content-type", "text/css"); return res.end(css); }
    res.setHeader("content-type", "text/html"); res.end('<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="app"></div><script src="/app.js"></script></body></html>');
  });
  server.unref(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const browser = await chromium.launch({ executablePath: process.env.MISTBLOSSOM_QA_CHROMIUM || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage"], headless: true });
  const errors = [];
  try {
    const page = await browser.newPage(); page.on("pageerror", error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const [width, height] of [[1440, 1000], [1024, 900], [768, 1024], [390, 844]]) {
      await page.setViewportSize({ width, height }); await page.goto(origin); await page.getByRole("tab", { name: /Дозволи/ }).waitFor();
      assert.equal(await page.locator('[aria-current="page"]').count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `page overflow at ${width}`);
      await page.getByRole("tab", { name: /Параметри/ }).click();
      await page.getByLabel("Назва групи").fill("Нова назва");
      await page.keyboard.press("Home");
      await page.getByRole("tab", { name: /Дозволи/ }).click();
      await page.getByRole("tab", { name: /Параметри/ }).click();
      assert.equal(await page.getByLabel("Назва групи").inputValue(), "Нова назва");
      await page.getByRole("tab", { name: /Дозволи/ }).focus(); await page.keyboard.press("ArrowRight");
      assert.equal(await page.getByRole("tab", { name: /Параметри/ }).getAttribute("aria-selected"), "true");
      await page.getByRole("tab", { name: /Дозволи/ }).click();
      await page.screenshot({ path: path.join(output, `management-${width}.png`), fullPage: true });
      console.log(`PASS shell, overflow, preserved forms and keyboard tabs at ${width}px`);
    }
    await page.goto(origin + "?role=reader");
    await page.getByRole("link", { name: /Групи доступу/ }).waitFor();
    assert.equal(await page.locator('nav a[href="/dashboard/access"]').count(), 0);
    assert.equal(await page.locator('nav a[href="/dashboard/server"]').count(), 0);
    assert.equal(await page.locator('nav a[href="/dashboard/groups"]').count(), 1);
    assert.deepEqual(errors, []);
    console.log("PASS read-only navigation excludes management and owner actions");
    console.log(`[check-management-browser] 5/5 passed; internal screenshots: ${output}`);
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
