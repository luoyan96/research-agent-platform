import { createServer } from 'node:https'
import { request } from 'node:http'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { resolve, relative, extname, isAbsolute } from 'node:path'

// Loopback reference only; no public bind, dynamic code, directory listing or proxy trust.
const origin=new URL(process.env.APP_ORIGIN??'')
if(origin.protocol!=='https:'||origin.hostname!=='127.0.0.1'||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('Exact loopback HTTPS APP_ORIGIN required')
const upstream=new URL(process.env.API_UPSTREAM??'http://127.0.0.1:3100')
if(upstream.protocol!=='http:'||upstream.hostname!=='127.0.0.1'||upstream.pathname!=='/'||upstream.username||upstream.password)throw new Error('Loopback API_UPSTREAM required')
const root=realpathSync(resolve('apps/web/dist'))
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'}
const server=createServer({key:readFileSync(process.env.TLS_KEY_FILE??''),cert:readFileSync(process.env.TLS_CERT_FILE??''),minVersion:'TLSv1.2'},(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store')
 if(req.headers.host!==origin.host){res.writeHead(400).end();return}
 if(req.url?.startsWith('/api/')){
  const headers={...req.headers,host:upstream.host};delete headers['x-forwarded-for'];delete headers['x-forwarded-proto'];delete headers.forwarded
  const proxy=request({hostname:upstream.hostname,port:upstream.port,method:req.method,path:req.url,headers,timeout:15000},r=>{res.writeHead(r.statusCode??502,r.headers);r.pipe(res)})
  proxy.on('timeout',()=>proxy.destroy());proxy.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'Content-Type':'application/json'});res.end('{"error":"API unavailable"}')});req.on('aborted',()=>proxy.destroy());req.pipe(proxy);return
 }
 if(!['GET','HEAD'].includes(req.method??'')){res.writeHead(405).end();return}
 try{
  const pathname=decodeURIComponent(new URL(req.url??'/',origin).pathname)
  if(pathname.includes('\\')||pathname.includes('\0')||pathname.split('/').some(s=>s.startsWith('.'))){res.writeHead(404).end();return}
  let path=resolve(root,`.${pathname}`)
  if(!extname(path))path=resolve(root,'index.html')
  path=realpathSync(path);const child=relative(root,path)
  if(child.startsWith('..')||isAbsolute(child)||!statSync(path).isFile()){res.writeHead(404).end();return}
  res.setHeader('Content-Type',types[extname(path)]??'application/octet-stream');res.end(req.method==='HEAD'?undefined:readFileSync(path))
 }catch{res.writeHead(404).end()}
})
server.requestTimeout=20000
server.listen(Number(origin.port||443),'127.0.0.1',()=>console.log(`Pilot HTTPS listening ${origin.origin}; API same-origin proxy; loopback only`))
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close())
