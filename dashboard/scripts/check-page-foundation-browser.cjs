"use strict";
// Production components and CSS with a synthetic identity; no live credentials.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http");
const { once } = require("node:events");
const root = path.resolve(__dirname, "..");
const lookup = [process.env.MISTBLOSSOM_QA_MODULES || root, process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || root];
const { chromium } = require(require.resolve("playwright", { paths: lookup }));
const esbuild = require(require.resolve("esbuild", { paths: lookup }));
const output = process.env.MISTBLOSSOM_QA_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), "page-foundation-"));
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "link.tsx"), 'export default function Link({children,prefetch,...props}){return <a {...props}>{children}</a>}');
fs.writeFileSync(path.join(output, "reporter.ts"), 'export function sendClientErrorReport(){window.fixtureReports=(window.fixtureReports||0)+1}');
fs.writeFileSync(path.join(output, "entry.tsx"), `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import Container from '@/components/page/PageContainer';import Header from '@/components/page/PageHeader';
import Section from '@/components/page/PageSection';import FormSection from '@/components/page/FormSection';
import Directory from '@/components/management/overview/ManagementDirectory';import Dropdown from '@/components/ui/DropdownMenu';
import Boundary from '@/components/page/PageErrorBoundary';import Skeleton from '@/components/page/PageSkeleton';
import Button from '@/components/ui/Button';import Field from '@/components/ui/FormField';
import {normalizeDirectoryFilters} from '@/lib/managementDirectory';
const items=[{key:'groups',href:'/dashboard/groups',section:'access',label:'Групи доступу',description:'Ранги та права учасників'},{key:'logs',href:'/dashboard/logs',section:'system',label:'Журнали',description:'Події та помилки'},{key:'discord',href:'/dashboard/discord',section:'discord',label:'Учасники',description:'Discord-ролі та серверні ніки'}];
function Crash({crash}){if(crash)throw Error('FixtureFailure');return <p>Блок працює</p>}
function App(){const [crash,setCrash]=useState(false);const params=new URLSearchParams(location.search);
return <Container label="Еталонний інтерфейс" sidebar={<nav className="management-nav"><div><span className="management-nav-label">Керування</span><div className="management-nav-links"><a href="/dashboard" aria-current="page"><strong>Огляд</strong><small>Стан системи</small></a></div></div></nav>}>
<Header title="Центр керування" description="Спільний каркас сторінок, пошук і доступні інструменти." breadcrumbs={[{label:'Огляд'}]} metrics={[{label:'Група',value:'Адмін'},{label:'Розділів',value:items.length}]} actions={<Dropdown label="Системні розділи" items={[{id:'logs',label:'Журнали',href:'/dashboard/logs'},{id:'disabled',label:'Недоступна дія',href:'/unavailable',disabled:true},{id:'action',label:'Тестова дія',onSelect:()=>window.fixtureActions=(window.fixtureActions||0)+1}]}/>}/>
<Section id="directory" title="Робочі розділи"><Directory items={items} initialFilters={normalizeDirectoryFilters({query:params.get('q'),section:params.get('section'),sort:params.get('sort')})}/></Section>
<Section id="settings" title="Приклад форми"><FormSection title="Група"><Field label="Назва групи" maxLength={80}/><Button disabled>Зберегти</Button></FormSection></Section>
<Section id="loading" title="Завантаження"><Skeleton label="Завантаження тестових даних"/></Section>
<Section id="recovery" title="Відновлення"><Button onClick={()=>setCrash(!crash)}>{crash?'Прибрати збій':'Симулювати збій'}</Button><Boundary resetKey={String(crash)}><Crash crash={crash}/></Boundary></Section>
</Container>};createRoot(document.getElementById('app')).render(<App/>);
`);
(async () => {
  await esbuild.build({ entryPoints: [path.join(output, "entry.tsx")], outfile: path.join(output, "app.js"), bundle: true, jsx: "automatic", tsconfig: path.join(root, "tsconfig.json"), nodePaths: [path.join(root, "node_modules")], alias: { "next/link": path.join(output, "link.tsx"), "@/components/ClientErrorReporter": path.join(output, "reporter.ts") }, define: { "process.env.NODE_ENV": '"production"' } });
  const css = [...fs.readFileSync(path.join(root, "src/app/layout.tsx"), "utf8").matchAll(/import "\.\/styles\/([^\"]+\.css)";/g)].map(m => fs.readFileSync(path.join(root, "src/app/styles", m[1]), "utf8")).join("\n") + "\n" + fs.readFileSync(path.join(output, "app.css"), "utf8");
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js") { res.setHeader("content-type", "text/javascript"); return res.end(fs.readFileSync(path.join(output, "app.js"))); }
    if (req.url === "/style.css") { res.setHeader("content-type", "text/css"); return res.end(css); }
    res.setHeader("content-type", "text/html"); res.end('<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="app"></div><script src="/app.js"></script></body></html>');
  });
  server.unref(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.MISTBLOSSOM_QA_CHROMIUM || undefined, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const page = await browser.newPage(); const errors = [];
    page.on("pageerror", error => { if (!error.message.includes("FixtureFailure")) errors.push(error.message); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const [width, height] of [[1920, 1080], [1440, 1000], [1024, 900], [768, 1024], [390, 844]]) {
      await page.setViewportSize({ width, height }); await page.goto(origin);
      await page.getByLabel("Пошук розділу").fill("групи");
      assert.equal(await page.locator('article h3').count(), 1);
      assert.match(await page.getByRole("status").first().textContent(), /1 із 3/);
      assert.equal(new URL(page.url()).searchParams.get("q"), "групи");
      await page.getByLabel("Пошук розділу").fill("відсутній результат"); await page.getByRole("heading", { name: "Нічого не знайдено" }).waitFor();
      await page.getByRole("button", { name: "Показати всі розділи" }).click(); assert.equal(await page.locator('article h3').count(), 3);
      await page.getByLabel("Категорія").selectOption("system"); assert.equal(await page.locator('article h3').count(), 1);
      await page.getByRole("button", { name: "Скинути", exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}px`);
      const summary = page.locator("summary"); await summary.click(); await page.keyboard.press("Tab"); await page.keyboard.press("Escape");
      assert.equal(await page.locator("details[open]").count(), 0); assert.equal(await summary.evaluate(el => el === document.activeElement), true);
      await summary.click(); await page.getByRole("button", { name: "Тестова дія" }).click(); assert.equal(await page.locator("details[open]").count(), 0);
      await page.getByRole("button", { name: "Симулювати збій" }).click(); await page.getByText("Цей блок тимчасово недоступний.", { exact: false }).waitFor();
      await page.getByRole("button", { name: "Прибрати збій" }).click(); await page.getByText("Блок працює", { exact: true }).waitFor();
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(await page.locator('[aria-label="Завантаження тестових даних"] span').last().evaluate(el => getComputedStyle(el).animationName), "none");
      await page.screenshot({ path: path.join(output, `foundation-${width}.png`), fullPage: true });
      console.log(`PASS search, URL, filters, disclosure, recovery and no overflow at ${width}px`);
    }
    assert.deepEqual(errors, []); console.log("[check-page-foundation-browser] 5/5 passed");
  } finally { if (browser) await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
