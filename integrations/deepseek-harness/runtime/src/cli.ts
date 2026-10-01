import { generate } from './index.js'
const controller=new AbortController(),parent=process.ppid
const watch=setInterval(()=>{try{process.kill(parent,0)}catch{controller.abort()}},1000)
let raw=''
for await (const chunk of process.stdin) {
  raw += String(chunk)
  if(raw.length>200000) { process.exitCode=1; break }
}
if (!process.exitCode) {
  try { process.stdout.write(JSON.stringify(await generate(JSON.parse(raw),controller.signal))) }
  catch { process.stdout.write(JSON.stringify({text:'',failure:'HARNESS_ERROR',inputTokens:null,outputTokens:null,elapsedMs:0}));process.exitCode=1 }
}

clearInterval(watch)
