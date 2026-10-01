import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { request } from 'node:https'
import { createServer } from 'node:net'
import { randomBytes, randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { routes, contractVersion } from '../packages/contracts/dist/index.js'

assert.match(process.env.RELEASE_SHA??'',/^[a-f0-9]{40}$/,'Set RELEASE_SHA to the tested full commit')
mkdirSync('.runtime',{recursive:true})
const root=mkdtempSync(resolve('.runtime/b5a-production-')),children=new Set()
const freePort=()=>new Promise((ok,no)=>{const s=createServer();s.on('error',no);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>ok(p))})})
const apiPort=await freePort(),webPort=await freePort(),origin=`https://127.0.0.1:${webPort}`
const base={...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(apiPort),APP_ORIGIN:origin,DATABASE_PATH:join(root,'platform.sqlite'),BLOB_ROOT:join(root,'blobs'),OPERATOR_ID:'synthetic_pilot_operator',B3_AI_ENABLED:'0',DEEPSEEK_API_KEY:'',TLS_KEY_FILE:join(root,'local.key'),TLS_CERT_FILE:join(root,'local.crt'),API_UPSTREAM:`http://127.0.0.1:${apiPort}`}
function cli(file,args=[],input,env=base){const r=spawnSync(process.execPath,[file,...args],{env,input:input===undefined?undefined:JSON.stringify(input),encoding:'utf8',windowsHide:true});assert.equal(r.status,0,`${file} failed (private output withheld)`);return r.stdout.trim()?r.stdout.trim():null}
const ssl=spawnSync(process.env.OPENSSL_BIN??'openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',base.TLS_KEY_FILE,'-out',base.TLS_CERT_FILE,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{encoding:'utf8',windowsHide:true})
assert.equal(ssl.status,0,'Set OPENSSL_BIN to an existing OpenSSL executable; no certificate is installed in system trust.')
const ca=readFileSync(base.TLS_CERT_FILE)
async function start(file,env=base,pattern=/listening /i){
 const child=spawn(process.execPath,[file],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});children.add(child)
 await new Promise((ok,no)=>{let output='';const timer=setTimeout(()=>no(new Error('process readiness timeout')),15000);child.stdout.on('data',b=>{output+=b;if(pattern.test(output)){clearTimeout(timer);ok()}});child.stderr.on('data',()=>{});child.once('error',no);child.once('exit',()=>{clearTimeout(timer);no(new Error('process stopped before ready'))})})
 return child
}
async function stop(child){if(child.exitCode===null){const done=once(child,'exit');child.kill();await done}children.delete(child)}
function http(path,method='GET',body,client){return new Promise((ok,no)=>{
 const req=request(origin+path,{method,ca,headers:{...(body?{'content-type':'application/json',origin,'idempotency-key':randomUUID()}:{}),...(client?{cookie:client.cookie,'x-csrf-token':client.csrf}: {})}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{const bytes=Buffer.concat(chunks);let value;try{value=JSON.parse(bytes.toString())}catch{value=null}ok({status:res.statusCode,headers:res.headers,bytes,value})})});req.on('error',no);if(body)req.write(JSON.stringify(body));req.end()
})}
async function api(name,client,body,id){const r=routes[name],response=await http(r.path.replace('{id}',id??''),r.method,body,client);assert.equal(response.status,r.status,`${name}: ${response.status}`);r.response.parse(response.value);return response}
const accounts=['A','B','C'].map(x=>({memberId:`pilot_${x}`,username:`pilot_${x}`,password:randomBytes(24).toString('hex'),displayName:`Synthetic pilot ${x}`}))
async function login(a){const response=await api('login',null,{username:a.username,password:a.password});assert.match(response.headers['set-cookie'][0],/Secure/);const client={cookie:response.headers['set-cookie'][0].split(';')[0],csrf:''};client.csrf=(await api('session',client)).value.data.csrfToken;return client}
const schedule={suggested:null,hardDeadline:null,committed:null,estimatedHumanHours:null,checkpoint:null}
const evidence={synthetic:true,contractVersion,environment:{node:process.version,platform:process.platform,production:true,httpsCertificate:'temporary loopback certificate; validated with explicit CA'},modelCalls:0}
try{
 cli('apps/api/dist/manage.js',['migrate']);cli('apps/api/dist/manage.js',['migrate'])
 cli('apps/api/dist/operate.js',[],{action:'create-lab',requestId:randomUUID(),labId:'pilot_lab',name:'Synthetic pilot'})
 for(const a of accounts)cli('apps/api/dist/operate.js',[],{action:'create-account',requestId:randomUUID(),labId:'pilot_lab',...a})
 let apiChild=await start('apps/api/dist/main.js'),webChild=await start('scripts/serve-pilot.mjs')
 let worker=await start('apps/api/dist/worker.js',base,/worker started/)
 assert.equal((await http('/')).status,200);assert.match((await http('/')).bytes.toString(),/type="module"/)
 assert.equal((await http('/.env')).status,404);assert.equal((await http('/tasks/synthetic-deep-link')).status,200)
 await api('ready')
 let a=await login(accounts[0]),b=await login(accounts[1]),c=await login(accounts[2])
 const p=(await api('createPlan',a,{labId:'pilot_lab',goal:'Synthetic readiness collaboration',proposedItems:[{id:'work',title:'Synthetic accepted delivery',goal:'Verify synthetic evidence',deliverable:'Text with attachment',acceptanceCriteria:'Explicit missing evidence',allocation:{kind:'invitation',memberId:'pilot_B'},dependencies:[],schedule,inputArtifactIds:[],budget:null}],unresolvedQuestions:[]})).value.data
 const id=(await api('confirmPlan',a,{expectedVersion:p.version},p.id)).value.data.taskIds[0]
 const offer=(await api('task',b,undefined,id)).value.data
 await api('invitationDecision',b,{expectedVersion:offer.pendingInvitation.version,expectedTaskVersion:offer.version,decision:'accepted',comment:null},offer.pendingInvitation.id)
 const task=async(client=a)=>(await api('task',client,undefined,id)).value.data.task
 const artifact=(await api('upload',b,{taskId:id,expectedVersion:(await task(b)).version,filename:'synthetic.txt',mediaType:'text/plain',contentBase64:Buffer.from('Synthetic pilot evidence: twelve samples.').toString('base64')})).value.data
 await api('start',b,{expectedVersion:(await task(b)).version},id)
 const d=(await api('submit',b,{expectedVersion:(await task(b)).version,summary:'Synthetic result; no external validation.',artifactRefs:[artifact.id],sources:[]},id)).value.data
 await api('review',a,{expectedVersion:d.version,expectedTaskVersion:(await task()).version,revision:d.revision,decision:'accepted',comment:'Synthetic acceptance only'},d.id)
 assert.equal((await task()).status,'completed')
 assert.equal((await http(routes.task.path.replace('{id}',id),'GET',undefined,c)).status,404)
 // Restart real API/worker after sessions and accepted facts exist. Browser is not involved.
 await stop(apiChild);await stop(worker);apiChild=await start('apps/api/dist/main.js');worker=await start('apps/api/dist/worker.js',base,/worker started/)
 assert.equal((await task()).status,'completed')
 evidence.production={sameOriginLogin:true,secureCookie:true,csrf:true,acceptedTask:id,artifact:artifact.id,restartPreserved:true}
 await stop(apiChild);await stop(worker)
 assert.equal((await http('/api/v1/health/ready')).status,502)
 assert.equal((await http('/?scenario=demo')).status,200)
 await stop(webChild)
 const backupPath=join(root,'backup'),restoreRoot=join(root,'restored')
 cli('apps/api/dist/recover.js',['backup'],undefined,{...base,BACKUP_PATH:backupPath,RELEASE_SHA:process.env.RELEASE_SHA,CONFIG_REVISION:'b5a-synthetic-v1'})
 cli('apps/api/dist/recover.js',['restore'],undefined,{...base,BACKUP_PATH:backupPath,RESTORE_ROOT:restoreRoot})
 const restoredEnv={...base,DATABASE_PATH:join(restoreRoot,'platform.sqlite'),BLOB_ROOT:join(restoreRoot,'blobs')}
 cli('apps/api/dist/manage.js',['migrate'],undefined,restoredEnv);cli('apps/api/dist/manage.js',['migrate'],undefined,restoredEnv)
 apiChild=await start('apps/api/dist/main.js',restoredEnv);webChild=await start('scripts/serve-pilot.mjs',restoredEnv)
 assert.equal((await http(routes.session.path,'GET',undefined,a)).status,401)
 a=await login(accounts[0]);b=await login(accounts[1]);c=await login(accounts[2])
 assert.equal((await task()).status,'completed')
 const content=await http(routes.content.path.replace('{id}',artifact.id),'GET',undefined,b)
 assert.equal(content.status,200);assert.equal(content.bytes.toString(),'Synthetic pilot evidence: twelve samples.')
 assert.equal((await http(routes.content.path.replace('{id}',artifact.id),'GET',undefined,c)).status,404)
 evidence.recovery={newIsolatedPath:true,oldSessionRejected:true,acceptedTaskPreserved:true,attachmentBytesVerified:true,unauthorizedDownloadRejected:true,repeatedMigration:true}
 writeFileSync(join(root,'evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600})
 console.log(JSON.stringify({...evidence,evidenceFile:join(root,'evidence.json')},null,2))
}finally{for(const child of [...children])await stop(child)}
