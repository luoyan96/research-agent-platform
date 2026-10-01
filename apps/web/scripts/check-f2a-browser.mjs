// Real B2a service; independent cookie stores for A/B/C. Only failure requests are intercepted.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { routes, contractVersion } from '../../../packages/contracts/dist/index.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base=process.env.F1_BASE_URL??'http://127.0.0.1:4177';
const accounts=JSON.parse(await readFile(process.env.F1_CREDENTIALS_FILE??'.runtime/f2a/credentials.json','utf8'));
const evidence=resolve(process.env.F2A_EVIDENCE_DIR??'.runtime/f2a/browser');await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({channel:process.env.F1_BROWSER_CHANNEL??'msedge',headless:true});
const contexts=await Promise.all(accounts.map(()=>browser.newContext({viewport:{width:1487,height:1058}})));
const [a,b,c]=await Promise.all(contexts.map(ctx=>ctx.newPage()));
const results={base,contractVersion,checks:[],viewports:[],console:[]}, pageErrors=[];
const observed=new Map();
for(const page of [a,b,c]){
  page.on('pageerror',e=>pageErrors.push(e.message));
  page.on('console',m=>{if(['error','warning'].includes(m.type()))results.console.push({type:m.type(),text:m.text()});});
  page.on('response',async r=>{if(r.ok()&&r.url().includes('/overview?'))observed.set(page,await r.json());});
}
const check=text=>{results.checks.push(text);console.log('PASS '+text);};
const button=(page,name)=>page.getByRole('button',{name,exact:true});
const input=(page,name)=>page.getByRole('textbox',{name,exact:true});
const visible=(page,text)=>page.getByText(text,{exact:false}).first().waitFor();
const shot=(page,name)=>page.screenshot({path:resolve(evidence,name+'.png'),fullPage:true});
async function login(page,index,initial=true){
  if(initial)await page.goto(base+'/#/login');
  await input(page,'账号').fill(accounts[index].username);await input(page,'密码').fill(accounts[index].password);
  await button(page,'登录').click();await page.getByRole('heading',{name:'先处理与你有关的事'}).waitFor();
}
async function go(page,path){await page.evaluate(hash=>{location.hash=hash;},path);}
async function call(ctx,name,params={},query={},body=null,status=routes[name].status){
  const route=routes[name];let path=route.path;
  for(const [k,v] of Object.entries(params))path=path.replace('{'+k+'}',v);
  const headers={Origin:base};
  if(route.method!=='GET'){
    const auth=await (await ctx.request.get(base+'/api/v1/auth/session')).json();
    headers['X-CSRF-Token']=auth.data.csrfToken;headers['Idempotency-Key']=crypto.randomUUID();
  }
  const response=await ctx.request.fetch(base+path+'?'+new URLSearchParams(query),{method:route.method,headers,...(body===null?{}:{data:body})});
  assert.equal(response.status(),status,name);
  const json=await response.json();return status>=400?json:route.response.parse(json);
}
const schedule={suggested:null,hardDeadline:null,committed:null,estimatedHumanHours:null,checkpoint:null};
const stamp=Date.now().toString();
const item=(id,allocation)=>({id:'item_'+crypto.randomUUID(),title:`F2a ${stamp} ${id}`,goal:'仅授权成员可见的合成目标',deliverable:'合成文本',acceptanceCriteria:'明确列出缺项',allocation,dependencies:[],schedule,inputArtifactIds:[],budget:null});
async function lab(page,scope){
  const loaded=page.waitForResponse(r=>r.ok()&&r.url().includes('/overview?'));
  if(page.url().endsWith('#/lab'))await button(page,'刷新').click();
  else await page.getByRole('navigation').getByRole('link',{name:'实验室任务',exact:true}).click();
  await loaded;
  await page.locator('[data-total=unassigned]').waitFor();
  const control=button(page,scope==='mine'?'我参与的':'实验室');
  if(await control.getAttribute('aria-pressed')!=='true'){await control.click();await page.locator('[data-total=unassigned]').waitFor();}
  const overview=observed.get(page);assert(overview);
  for(const [key,value] of Object.entries(overview.data.counts))assert.equal(Number(await page.locator(`[data-total=${key}]`).innerText()),value);
  const tasks=await call(page.context(),'tasks',{}, {labId:'lab_synthetic',scope,limit:30,snapshot:overview.snapshot.token});
  const actual=await page.locator('.task-card h2 a').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href').slice('#/tasks/'.length)));
  assert.deepEqual([...actual].sort(),tasks.data.map(t=>t.id).sort());
  assert.equal(await page.locator('.read-stamp time').getAttribute('datetime'),overview.snapshot.at);
  return overview;
}
async function availability(page){await go(page,'/availability');await page.getByRole('heading',{name:'我的可用时间',exact:true}).waitFor();}
try{
  await login(a,0);await login(b,1);await login(c,2);
  results.viewports.push(await a.evaluate(()=>({innerWidth,innerHeight,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth})));
  check(`A/B/C 独立真实会话；契约 ${contractVersion}`);
  await input(a,'描述你的需求').fill('F2a 保存后可找回 '+stamp);await button(a,'手工创建方案').click();
  await input(a,'任务标题').fill('F2a 草案确认后的任务 '+stamp);await input(a,'这一项的目标').fill('合成目标');
  await input(a,'交付什么').fill('合成清单');await input(a,'怎样算完成').fill('缺项明确');await button(a,'保存方案').click();
  await a.waitForURL(/#\/plans\/(?!new)/);const planId=a.url().split('/plans/')[1];
  await button(a,'退出登录').click();await login(a,0,false);
  await a.getByRole('link',{name:'F2a 保存后可找回 '+stamp,exact:true}).click();await visible(a,'版本 1');
  await input(a,'整体目标').fill('F2a 重新编辑 '+stamp);await button(a,'保存方案').click();await visible(a,'版本 2');
  await button(a,'确认此版本并安排').click();await visible(a,'方案已确认');
  await go(a,'/plans');await a.getByRole('heading',{name:'我的已保存方案'}).waitFor();
  assert.equal(await a.locator(`.saved-plan a[href="#/plans/${planId}"]`).count(),0);
  await a.getByRole('link',{name:'已确认方案',exact:true}).click();await a.locator(`.saved-plan a[href="#/plans/${planId}"]`).waitFor();
  await call(contexts[1],'getPlan',{id:planId},{},null,404);await call(contexts[2],'getPlan',{id:planId},{},null,404);
  for(const ctx of contexts.slice(1))assert(!(await call(ctx,'plans')).data.some(p=>p.id===planId));
  check('手工保存→同标签页退出重登→入口找回→编辑/确认→移出草案；B/C 无权枚举或读取');

  const created=await call(contexts[0],'createPlan',{}, {},{labId:'lab_synthetic',goal:'F2a 真实日常协作 '+stamp,proposedItems:[item('回应',{kind:'invitation',memberId:'member_B'}),item('验收',{kind:'invitation',memberId:'member_B'}),item('推进',{kind:'self'})],unresolvedQuestions:[]});
  const confirmed=await call(contexts[0],'confirmPlan',{id:created.data.id},{},{expectedVersion:1});
  const [invited,reviewing,advance]=confirmed.data.taskIds;
  let detail=(await call(contexts[1],'task',{id:reviewing})).data;
  await call(contexts[1],'invitationDecision',{id:detail.pendingInvitation.id},{},{expectedVersion:detail.pendingInvitation.version,expectedTaskVersion:detail.version,decision:'accepted',comment:null});
  detail=(await call(contexts[1],'task',{id:reviewing})).data;
  await call(contexts[1],'start',{id:reviewing},{},{expectedVersion:detail.task.version});
  detail=(await call(contexts[1],'task',{id:reviewing})).data;
  await call(contexts[1],'submit',{id:reviewing},{},{expectedVersion:detail.task.version,summary:'F2a 真实提交文本',artifactRefs:[],sources:[]});
  await go(a,'/');await a.getByRole('link',{name:`F2a ${stamp} 验收`,exact:true}).waitFor();
  await a.getByText('继续推进 · 展开近期可操作事项',{exact:true}).click();await a.getByRole('link',{name:`F2a ${stamp} 推进`,exact:true}).waitFor();
  await shot(a,'entry-desktop');check('入口优先显示服务待验收事项，并按需展开真实可开始/提交任务');
  await go(b,'/lab');await b.locator('[data-total=unassigned]').waitFor();await go(b,'/');
  await b.getByRole('link',{name:`F2a ${stamp} 回应`,exact:true}).click();await visible(b,'尚未承诺');await shot(b,'pending-invitation');
  await button(b,'拒绝邀请').click();await visible(b,'NOT_FOUND');assert.equal(await b.getByRole('heading',{name:`F2a ${stamp} 回应`,exact:true}).count(),0);
  await call(contexts[1],'task',{id:invited},{},null,404);check('待回应邀请不算承诺；拒绝后任务访问收回且旧内容清除');

  await lab(a,'lab');await shot(a,'overview-desktop');await lab(a,'mine');await lab(b,'mine');await lab(c,'lab');
  const cmembers=await call(contexts[2],'members',{id:'lab_synthetic'},{limit:100});
  assert(!cmembers.data.some(m=>m.visibleCommitments.some(c=>[invited,reviewing,advance].includes(c.taskId))));
  check('lab/mine 卡片、全量四列计数与读取时刻匹配同一服务快照；C 看不到受限承诺');

  for(const label of ['查看我参与的真实任务','查看我参与的任务']){
    await lab(a,'lab');
    await a.getByRole('combobox',{name:'任务状态',exact:true}).selectOption('completed');await a.locator('[data-total=unassigned]').waitFor();
    await go(a,'/');await a.getByRole('heading',{name:'先处理与你有关的事'}).waitFor();
    if(label==='查看我参与的任务')await a.getByText('继续推进 · 展开近期可操作事项',{exact:true}).click();
    await a.getByRole('link',{name:label,exact:true}).click();await a.locator('[data-total=unassigned]').waitFor();
    assert.equal(await button(a,'我参与的').getAttribute('aria-pressed'),'true');
    assert.equal(await a.getByRole('combobox',{name:'任务状态',exact:true}).inputValue(),'');
    await a.getByRole('link',{name:`F2a ${stamp} 推进`,exact:true}).waitFor();
  }
  check('首页两个“我参与的”入口清除旧实验室范围及状态筛选，恢复本人未完成任务');

  await availability(b);await b.getByLabel('开始日期',{exact:true}).fill('2000-01-01');await b.getByLabel('结束日期',{exact:true}).fill('2000-01-02');
  await input(b,'日期时区').fill('Asia/Shanghai');await b.getByRole('spinbutton').fill('0');await button(b,'保存我的可用时间').click();await visible(b,'可用时间已保存');await visible(b,'待更新 · 当前可用情况未知');
  await lab(a,'mine');await a.getByText('人员安排 · 授权承诺与自报可用时间',{exact:true}).click();await a.locator('[data-member=member_B]').getByText(/待更新/).waitFor();await shot(a,'members-expired');
  check('本人可用时间持久保存，另一会话重取一致；过期显示待更新、0 小时不误作未知');

  await availability(b);const current=new Date();const end=new Date(current.getTime()+86400000*7);
  await b.getByLabel('开始日期',{exact:true}).fill(current.toISOString().slice(0,10));await b.getByLabel('结束日期',{exact:true}).fill(end.toISOString().slice(0,10));await b.getByRole('spinbutton').fill('4');
  const attempts=[];b.on('request',r=>{if(r.method()==='PATCH'&&r.url().includes('/me/availability'))attempts.push({key:r.headers()['idempotency-key'],body:r.postData()});});
  await b.route('**/api/v1/me/availability',route=>route.abort('failed'),{times:1});await button(b,'保存我的可用时间').click();await visible(b,'NETWORK_ERROR');assert.equal(await b.getByRole('spinbutton').inputValue(),'4');
  await button(b,'重试同一请求').click();await visible(b,'可用时间已保存');assert.deepEqual(attempts[0],attempts[1]);check('可用时间失败保留输入，重试复用同一 key 与正文');
  const old=await contexts[1].newPage();await old.goto(base+'/#/availability');await old.getByRole('spinbutton').fill('3');
  await b.getByRole('spinbutton').fill('6');await button(b,'保存我的可用时间').click();await visible(b,'可用时间已保存');
  await button(old,'保存我的可用时间').click();await visible(old,'VERSION_CONFLICT');await button(old,'读取最新状态').first().click();await visible(old,'服务端已有成员版本');assert.equal(await old.getByRole('spinbutton').inputValue(),'3');
  await shot(old,'availability-conflict');await button(old,'保留我的输入并重新确认').click();await button(old,'保存我的可用时间').click();await visible(old,'可用时间已保存');await old.close();check('可用时间旧版本冲突保留输入，读取后明确比较/重新确认，不静默覆盖');

  const stale=await lab(a,'mine');await call(contexts[0],'createPlan',{}, {},{labId:'lab_synthetic',goal:'令旧快照失效 '+stamp,proposedItems:[],unresolvedQuestions:[]});
  await a.locator('.task-card h2 a').first().click();await visible(a,'CURSOR_EXPIRED');assert.equal(await a.locator('.task-card').count(),0);await shot(a,'snapshot-expired');
  await button(a,'读取最新状态').click();await a.getByRole('heading',{name:'暂时无法读取',exact:true}).waitFor({state:'hidden'});await visible(a,'任务版本');check('跨读取变更令旧快照明确过期，旧组合清除；手动重读恢复真实详情');
  await lab(a,'mine');await contexts[0].setOffline(true);await visible(a,'连接已断开');assert.equal(await a.locator('.task-card').count(),0);await shot(a,'offline');
  await contexts[0].setOffline(false);await button(a,'读取最新状态').click();await a.locator('[data-total=unassigned]').waitFor();check('断线立即清理旧受限内容；恢复后手动重同步，无演示回退');
  await a.setViewportSize({width:390,height:844});
  const viewport=await a.evaluate(()=>({innerWidth,innerHeight,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth}));
  assert.equal(viewport.innerWidth,390);assert.equal(viewport.innerHeight,844);assert.equal(viewport.scrollWidth,390);results.viewports.push(viewport);await shot(a,'overview-mobile');
  await go(a,'/');await a.getByRole('heading',{name:'先处理与你有关的事'}).waitFor();await shot(a,'entry-mobile');
  await a.keyboard.press('Tab');assert(await a.evaluate(()=>document.activeElement!==document.body));
  const icon=await a.locator('link[rel=icon]').getAttribute('href');assert.equal((await contexts[0].request.get(base+icon)).status(),200);assert.equal(await a.locator('vite-error-overlay').count(),0);assert.deepEqual(pageErrors,[]);
  check('桌面与实际 DOM 390×844 无横向溢出，键盘可聚焦、favicon 200、无 pageerror/覆盖层');
  for(let i=0;i<11;i++)await call(contexts[0],'createPlan',{}, {},{labId:'lab_synthetic',goal:`F2a 分页 ${stamp} ${i}`,proposedItems:[],unresolvedQuestions:[]});
  await go(a,'/plans');await a.getByRole('heading',{name:'我的已保存方案'}).waitFor();
  const firstPage=await a.locator('.saved-plan a').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
  const firstAt=await a.locator('.read-stamp time').getAttribute('datetime');
  await button(a,'下一页草案').click();await button(a,'回到第一页').waitFor();
  const secondPage=await a.locator('.saved-plan a').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
  assert(firstPage.length===10&&secondPage.length>0);assert(!firstPage.some(id=>secondPage.includes(id)));
  assert.equal(await a.locator('.read-stamp time').getAttribute('datetime'),firstAt);
  check('草案跨页保持同一快照、无重复；全量列表不止入口最近 5 项');

  // The concurrent-window test changed B's version; establish a fresh baseline first.
  await go(b,'/lab');await b.locator('[data-total=unassigned]').waitFor();
  await availability(b);await b.getByRole('spinbutton').fill('7');
  await call(contexts[1],'logout',{}, {},{});
  await button(b,'保存我的可用时间').click();await visible(b,'UNAUTHENTICATED');await login(b,1,false);
  await availability(b);assert.equal(await b.getByRole('spinbutton').inputValue(),'7');
  await button(b,'保存我的可用时间').click();await visible(b,'PENDING_INTENT');await button(b,'重试同一请求').click();await visible(b,'可用时间已保存');
  await b.getByRole('spinbutton').fill('9');await button(b,'退出登录').click();await login(b,2,false);await availability(b);
  assert.equal(await b.getByRole('spinbutton').inputValue(),'');assert.equal(await b.getByLabel('开始日期',{exact:true}).inputValue(),'');
  check('新可用时间表单同账号失效恢复原输入/请求；显式退出换 C 清空 B 未提交内容');
  await a.bringToFront();await lab(a,'mine');
  await call(contexts[0],'createPlan',{}, {},{labId:'lab_synthetic',goal:'检查定期失效探测 '+stamp,proposedItems:[],unresolvedQuestions:[]});
  await a.getByRole('heading',{name:'需要重新同步',exact:true}).waitFor({timeout:40000});assert.equal(await a.locator('.task-card').count(),0);await visible(a,'CURSOR_EXPIRED');
  await button(a,'读取最新状态').click();await a.locator('[data-total=unassigned]').waitFor();
  check('只读列表定期探测真实快照失效并清除旧内容，不等待整页刷新或 15 分钟过期');
  results.note='Console records include deliberate 404/410/network failures. All successful responses came from real B2a.';
  await writeFile(resolve(evidence,'results.json'),JSON.stringify(results,null,2));
}catch(error){await shot(a,'failure-a');await shot(b,'failure-b');throw error;}
finally{await browser.close();}
