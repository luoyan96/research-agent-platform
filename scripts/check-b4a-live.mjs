import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {call,as,input,item,seed} from './b4a-demo-client.mjs'
if(!process.env.DEEPSEEK_API_KEY||process.env.B3_AI_ENABLED!=='1')throw new Error('Real Harness credentials and explicit AI configuration required')
const budget={maxTokens:100000,maxSeconds:120},evidence={synthetic:true,at:new Date().toISOString(),harnessVersion:'0.2.0-rc.1',contractVersion:'0.6.1'}
let worker
async function stop(){if(worker&&worker.exitCode===null){const done=once(worker,'exit');worker.kill('SIGKILL');await done}worker=null}
async function wait(id){for(let i=0;i<150;i++){const r=await call('getRun',null,id);if(r.status==='succeeded')return r;if(['failed','cancelled','interrupted'].includes(r.status))throw new Error(`Run ${r.status}: ${r.failure}`);await new Promise(r=>setTimeout(r,1000))}throw new Error('Live timeout; inspect persisted run')}
try{
 const setup=await seed();evidence.setup=setup
 worker=spawn(process.execPath,['apps/api/dist/worker.js'],{env:process.env,windowsHide:true,stdio:'ignore'})
 await as('A',async()=>{
  const cap=(await call('publicCapabilities')).find(c=>c.status==='available');if(!cap)throw new Error('Configure existing public capability first')
  const t=(await call('task',null,setup.targetTaskId)).task
  const run=await call('run',{expectedVersion:t.version,capability:{id:cap.id,version:cap.version,visibility:'lab_public'},budget,inputArtifactIds:[],conclusionRefs:[setup.conclusion]},t.id)
  const result=await wait(run.id);if(!result.candidate?.items.some(i=>i.citations.some(c=>c.artifactId===`conclusion_${setup.conclusion.id}_v${setup.conclusion.version}`)))throw new Error('Real candidate did not cite selected conclusion')
  evidence.reuse={id:result.id,status:result.status,methodVersion:result.methodVersion,conclusionRefs:result.conclusionRefs,candidate:result.candidate,usage:result.usageDetail};evidence.taskState=(await call('task',null,t.id)).task.status
  if(process.env.B4A_REUSE_ONLY==='1')return
  const grant=await call('createSample',{expectedVersion:4,deliverable:setup.delivery,decision:'share_selected',selectedText:'Synthetic cohort A measured twelve samples.',authorizeLabUse:true},setup.sourceTaskId)
  const state=await call('publicMethods'),method=await call('createMethod',{expectedVersion:state.generation,config:{emphasis:'evidence_gaps',detail:'detailed',citations:'exact_quote'},sampleIds:[grant.id]})
  const p=await call('createPlan',input('Synthetic authorized method trial',[item('trial',{kind:'self'})])),target=(await call('confirmPlan',{expectedVersion:1},p.id)).taskIds[0]
  const before=await call('publicMethods'),trial=await call('trialMethod',{expectedVersion:before.generation,methodVersion:method.version,taskId:target,expectedTaskVersion:1,budget})
  const tested=await wait(trial.id);if(!tested.candidate?.items.some(i=>i.citations.some(c=>c.artifactId===`sample_${grant.id}`)))throw new Error('Real trial failed to cite granted excerpt')
  evidence.trial={id:tested.id,status:tested.status,methodVersion:tested.methodVersion,candidate:tested.candidate,usage:tested.usageDetail}
  const activated=await call('activateMethod',{expectedVersion:before.generation,methodVersion:method.version,runId:trial.id,confirm:true});evidence.activated={generation:activated.generation,methodVersion:activated.activeMethodVersion}
  await stop()
  const t2=(await call('task',null,t.id)).task,queued=await call('run',{expectedVersion:t2.version,capability:{id:cap.id,version:activated.generation,visibility:'lab_public'},budget,inputArtifactIds:[],conclusionRefs:[setup.conclusion]},t.id)
  const disabled=await call('disableMethod',{expectedVersion:activated.generation,reason:'Synthetic stop boundary'});const cancelled=await call('getRun',null,queued.id);if(cancelled.status!=='cancelled')throw new Error('Disable failed to fence queued work')
  evidence.disabled={generation:disabled.generation,queuedStatus:cancelled.status,oldRunMethodVersion:(await call('getRun',null,result.id)).methodVersion}
  await call('revokeSample',{expectedVersion:grant.version,reason:'Synthetic grant withdrawal'},grant.id);const withdrawn=await call('publicMethods');if(withdrawn.methods.find(m=>m.version===method.version)?.usable!==false)throw new Error('Withdrawn method still usable');evidence.sampleWithdrawal='dependent method unusable; trial source access withdrawn'
 })
}finally{await stop();await writeFile(resolve(process.env.B4A_LIVE_EVIDENCE_FILE??'.runtime/b4a-live-evidence.json'),JSON.stringify(evidence,null,2))}
console.log(JSON.stringify({status:evidence.trial?'real_reuse_and_method_trial_verified':'real_reuse_verified',reuse:evidence.reuse?.usage,trial:evidence.trial?.usage,taskState:evidence.taskState,g4a:'Joint frontend acceptance pending'}))
