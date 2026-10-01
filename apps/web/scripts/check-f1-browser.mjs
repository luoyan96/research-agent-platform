// Real B1 integration. No mocked successful responses; contexts have independent cookie stores.
// Set PLAYWRIGHT_MODULE to an installed Playwright ESM entry if it is outside this workspace.
import { pathToFileURL } from 'node:url';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base=process.env.F1_BASE_URL??'http://127.0.0.1:4175';
let apiProcess;
const manageApi=process.argv.includes('--manage-api');
async function startApi(){
  let occupied=false;
  try{await fetch('http://127.0.0.1:3100/api/v1/health/live');occupied=true;}catch{}
  if(occupied)throw new Error('Port 3100 already serves an API; stop only your own API before --manage-api.');
  apiProcess=spawn(process.execPath,['apps/api/dist/main.js'],{cwd:process.cwd(),env:{...process.env,APP_ORIGIN:base,PORT:'3100'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  for(let i=0;i<100;i++){
    if(apiProcess.exitCode!==null)throw new Error('Local API exited; check port/configuration.');
    try{if((await fetch('http://127.0.0.1:3100/api/v1/health/ready')).ok)return;}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error('Local API readiness timeout');
}
async function stopApi(){if(apiProcess&&apiProcess.exitCode===null){const exited=once(apiProcess,'exit');apiProcess.kill();await exited;}}
if(manageApi)await startApi();
const credentials=Object.fromEntries(JSON.parse(await readFile(process.env.F1_CREDENTIALS_FILE??'.runtime/test-credentials.json','utf8')).map(c=>[c.memberId.slice(-1),c]));
const evidence=resolve(process.env.F1_EVIDENCE_DIR??'.runtime/f1-browser');
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.F1_BROWSER_CHANNEL?{channel:process.env.F1_BROWSER_CHANNEL}:{})});
const contexts=await Promise.all(['A','B','C'].map(()=>browser.newContext({viewport:{width:1487,height:1058}})));
const [a,b,c]=await Promise.all(contexts.map(ctx=>ctx.newPage()));
const errors=[]; const result={base,viewports:['1487x1058','390x844'],checks:[],taskIds:[]};
const check=(label)=>{result.checks.push(label);console.log('PASS '+label);};
const screenshot=async(page,name)=>page.screenshot({path:resolve(evidence,name+'.png'),fullPage:true});
const visible=async(page,text)=>page.getByText(text,{exact:false}).first().waitFor();
const click=async(page,text)=>page.getByRole('button',{name:text,exact:true}).click();
const goto=async(page,path)=>{await page.goto(base+'/#'+path);};
let requestLog=[];
for(const page of [a,b,c]) {
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/v1/')&&!r.url().includes('/auth/'))requestLog.push({url:r.url(),body:r.postData(),key:r.headers()['idempotency-key']});});
}
async function login(page,credential){await goto(page,'/login');await page.getByLabel('账号',{exact:true}).fill(credential.username);await page.getByLabel('密码',{exact:true}).fill(credential.password);await click(page,'登录');await visible(page,'今天，想把什么事情推进一步？');}
async function create(title,kind='invitation'){
  await goto(a,'/');await a.getByLabel('描述你的需求',{exact:true}).fill('合成验收：'+title);await click(a,'手工创建方案');
  await a.getByLabel('任务标题',{exact:true}).fill(title);await a.getByLabel('这一项的目标',{exact:true}).fill('整理可核对的合成内容');await a.getByLabel('交付什么',{exact:true}).fill('文本材料和必要依据');await a.getByLabel('怎样算完成',{exact:true}).fill('覆盖三个合成检查项，文字可读');
  await a.getByRole('combobox',{name:'承接方式',exact:true}).selectOption(kind);
  if(kind==='invitation') await a.getByRole('combobox',{name:'拟邀请成员',exact:true}).selectOption('member_B');
  if(kind==='claim') await a.getByRole('textbox',{name:'公开认领摘要（仅开放认领使用）',exact:true}).fill('公开的合成认领摘要：整理文本清单，不含受限目标。');
  await click(a,'保存方案');await a.waitForURL(/#\/plans\/(?!new)/);await visible(a,'确认此版本并安排');
  return a.url();
}
async function confirm(){const control=a.getByRole('button',{name:'确认此版本并安排',exact:true});await control.scrollIntoViewIfNeeded();const box=await control.boundingBox();const previous=requestLog.filter(r=>r.url.endsWith('/confirm')).length;await a.mouse.dblclick(box.x+box.width/2,box.y+box.height/2);await visible(a,'方案已确认');assert.equal(requestLog.filter(r=>r.url.endsWith('/confirm')).length,previous+1);const href=await a.getByRole('link',{name:/查看任务 /}).first().getAttribute('href');assert(href);const id=href.slice('#/tasks/'.length);result.taskIds.push(id);return id;}
try {
  // Credential file shape is explicitly produced by the B1 provisioning command.
  await login(a,credentials.A);await login(b,credentials.B);await login(c,credentials.C);
  check('A/B/C 独立真实登录会话');
  const planUrl=await create('F1 合成协作：材料整理与验收');
  const old=await contexts[0].newPage();await old.goto(planUrl);await visible(old,'确认此版本并安排');
  await a.getByRole('textbox',{name:'整体目标',exact:true}).fill('合成验收：修订后的材料整理目标');await click(a,'保存方案');await visible(a,'版本 2');
  await click(old,'确认此版本并安排');await visible(old,'VERSION_CONFLICT');await screenshot(old,'version-conflict');await old.close();
  check('A1 草案修改及旧版本确认冲突');
  const id=await confirm();await screenshot(a,'plan-confirmed');
  const confirmRequest=requestLog.filter(r=>r.url.endsWith('/confirm')).at(-1);
  const aSession=await (await contexts[0].request.get(base+'/api/v1/auth/session')).json();
  const replay=await contexts[0].request.post(confirmRequest.url,{headers:{Origin:base,'X-CSRF-Token':aSession.data.csrfToken,'Idempotency-Key':confirmRequest.key},data:JSON.parse(confirmRequest.body)});
  assert.equal(replay.status(),200);assert.deepEqual((await replay.json()).data.taskIds,[id]);
  const misuse=await contexts[0].request.post(confirmRequest.url,{headers:{Origin:base,'X-CSRF-Token':aSession.data.csrfToken,'Idempotency-Key':confirmRequest.key},data:{expectedVersion:999}});assert.equal(misuse.status(),409);
  check('A1 双击只发一次；原 key 重放确认不增任务，同 key 不同负载拒绝');
  await goto(b,'/tasks/'+id);await visible(b,'接受邀请');await screenshot(b,'invitation');await click(b,'接受邀请');await visible(b,'开始任务');
  const before=await (await contexts[1].request.get(base+'/api/v1/tasks/'+id)).json();assert.equal(before.data.task.leadId,'member_B');assert.equal(before.data.assignments[0].status,'accepted');assert(before.data.assignments[0].commitment);
  await click(b,'开始任务');await visible(b,'提交文本成果');
  await b.getByLabel('成果正文',{exact:true}).fill('合成成果 v1：三个检查项已整理，不含私有工具或过程日志。');
  let failed=false;
  await b.route('**/api/v1/tasks/'+id+'/deliverables',async route=>{if(!failed){failed=true;await route.abort();}else await route.continue();});
  await click(b,'提交新版本');await visible(b,'NETWORK_ERROR');assert.match(await b.getByLabel('成果正文',{exact:true}).inputValue(),/合成成果 v1/);await screenshot(b,'request-failure-retained');
  await click(b,'重试同一请求');await visible(b,'待验收');await b.unroute('**/api/v1/tasks/'+id+'/deliverables');
  const submits=requestLog.filter(r=>r.url.endsWith('/'+id+'/deliverables'));assert.equal(submits.length,2);assert.equal(submits[0].key,submits[1].key);assert.equal(submits[0].body,submits[1].body);
  check('请求失败保留成果，重试沿用原 key 与正文');
  await goto(a,'/tasks/'+id);await a.getByLabel('验收意见或修改要求',{exact:true}).fill('请补充第三项依据。');await click(a,'提出修改');await visible(a,'需修改');
  await b.reload();await visible(b,'修改后重新提交');await b.getByLabel('成果正文',{exact:true}).fill('合成成果 v2：已补充第三项依据，覆盖全部检查项。');await click(b,'提交新版本');await visible(b,'交付 v2');
  await a.reload();await a.getByLabel('验收意见或修改要求',{exact:true}).fill('三个合成检查项全部符合要求。');await click(a,'接受这版交付');await visible(a,'已完成');await screenshot(a,'accepted-desktop');
  const review=requestLog.filter(r=>r.url.endsWith('/review')).at(-1);const reviewReplay=await contexts[0].request.post(review.url,{headers:{Origin:base,'X-CSRF-Token':aSession.data.csrfToken,'Idempotency-Key':review.key},data:JSON.parse(review.body)});assert.equal(reviewReplay.status(),200);
  const bSession=await (await contexts[1].request.get(base+'/api/v1/auth/session')).json();const submitRequest=requestLog.filter(r=>r.url.endsWith('/'+id+'/deliverables')).at(-1);const submitReplay=await contexts[1].request.post(submitRequest.url,{headers:{Origin:base,'X-CSRF-Token':bSession.data.csrfToken,'Idempotency-Key':submitRequest.key},data:JSON.parse(submitRequest.body)});assert.equal(submitReplay.status(),201);
  await b.reload();await visible(b,'已完成');const completed=await (await contexts[1].request.get(base+'/api/v1/tasks/'+id)).json();assert.equal(completed.data.deliverables.length,2);assert.equal(completed.data.task.status,'completed');assert.equal(completed.data.deliverables.find(d=>d.revision===2).review.decision,'accepted');
  check('A4 接受→开始→提交→退回→重提→指定版本验收；重放不增加版本');
  await create('F1 合成协作：拒绝邀请');const declined=await confirm();await goto(b,'/tasks/'+declined);await click(b,'拒绝邀请');await visible(b,'NOT_FOUND');await goto(a,'/tasks/'+declined);await visible(a,'已拒绝');await screenshot(a,'invitation-declined');check('A2 接受与拒绝分别验证，拒绝保留历史');
  await create('F1 合成协作：竞争认领','claim');const claim=await confirm();await goto(b,'/tasks/'+claim);await goto(c,'/tasks/'+claim);await visible(b,'认领这项任务');await visible(c,'认领这项任务');
  assert(!(await b.locator('main').innerText()).includes('整理可核对的合成内容'));await visible(b,'公开的合成认领摘要');
  await Promise.all([click(b,'认领这项任务'),click(c,'认领这项任务')]);
  await Promise.race([visible(b,'ALREADY_CLAIMED'),visible(c,'ALREADY_CLAIMED')]);const loser=await b.getByText('ALREADY_CLAIMED',{exact:true}).isVisible()?b:c;await screenshot(loser,'claim-conflict');await goto(a,'/tasks/'+claim);const claimed=await (await contexts[0].request.get(base+'/api/v1/tasks/'+claim)).json();assert(['member_B','member_C'].includes(claimed.data.task.leadId));assert.equal(claimed.data.assignments.filter(x=>x.status==='accepted').length,1);check('A3 两独立会话竞争认领，仅一项承诺');
  await goto(c,'/tasks/'+id);await visible(c,'NOT_FOUND');await screenshot(c,'forbidden');const denied=await contexts[2].request.get(base+'/api/v1/tasks/'+id);assert.equal(denied.status(),404);const cSession=await (await contexts[2].request.get(base+'/api/v1/auth/session')).json();const spoof=await contexts[2].request.post(base+'/api/v1/tasks/'+id+'/start',{headers:{Origin:base,'X-CSRF-Token':cSession.data.csrfToken,'Idempotency-Key':crypto.randomUUID()},data:{expectedVersion:1,actorId:'member_B'}});assert([400,404].includes(spoof.status()));check('A5 C 越权读取和伪造 actorId 被拒绝');
  await goto(a,'/tasks/'+id);await visible(a,'已完成');await a.setViewportSize({width:390,height:844});await screenshot(a,'accepted-mobile');assert(await a.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await a.setViewportSize({width:1487,height:1058});
  await goto(a,'/');await a.keyboard.press('Tab');assert(await a.evaluate(()=>document.activeElement?.tagName==='BUTTON'||document.activeElement?.tagName==='A'));await screenshot(a,'entry');
  check('桌面/390px 窄屏、键盘焦点、刷新从真实服务恢复');
  if(manageApi){
    await stopApi();await startApi();
    await goto(a,'/tasks/'+id);await visible(a,'已完成');await goto(b,'/tasks/'+id);await visible(b,'已完成');
    const persisted=await(await contexts[0].request.get(base+'/api/v1/tasks/'+id)).json();
    assert.equal(persisted.data.task.version,completed.data.task.version);assert.equal(persisted.data.deliverables.length,2);assert.equal(persisted.data.assignments[0].status,'accepted');
    await screenshot(a,'after-service-restart');check('A5 服务进程重启后原 A/B 会话读取任务、承诺、交付及验收一致');
  }else result.checks.push('服务重启：本次未管理 API，需单独验证');
  assert.deepEqual(errors,[]);check('三会话无 pageerror');
  await writeFile(resolve(evidence,'result.json'),JSON.stringify(result,null,2));
} catch(error) {
  await screenshot(a,'failure-a');
  console.error('A page:',await a.locator('main').innerText());
  throw error;
} finally {await browser.close();if(manageApi)await stopApi();}
