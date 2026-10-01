import { describe, it, expect, vi } from 'vitest';
import { ApiClient, Intent, CommandSlot } from '../src/api';
import { contractVersion } from '@research-agent-platform/contracts';

const response = (body: unknown, status=200, version=contractVersion) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json','X-Contract-Version':version}});
const failure = (code: string, status: number) => response({error:{code,message:'Synthetic error',requestId:'req_test'}},status);
const intent = () => new Intent('confirmPlan',{expectedVersion:2},{id:'plan_test'});

describe('F1 service boundary and retry intents',()=>{
  it('treats a proxy HTML 502 as unavailable and retains the original request for retry',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('<h1>Bad gateway</h1>',{status:502})).mockResolvedValueOnce(failure('VERSION_CONFLICT',409));
    const client=new ApiClient(fetcher);const slot=new CommandSlot();const original=intent();
    await expect(slot.run(client,original)).rejects.toMatchObject({code:'SERVICE_UNAVAILABLE'});
    expect(slot.intent).toBe(original);
    await expect(slot.run(client,original)).rejects.toMatchObject({code:'VERSION_CONFLICT'});
    expect(fetcher.mock.calls[1]?.[1]).toEqual(fetcher.mock.calls[0]?.[1]);
  });
  it('never accepts unreadable successful responses or revives an aborted proxy response',async()=>{
    const controller=new AbortController();const reply=new Response('',{status:503});
    vi.spyOn(reply,'json').mockImplementation(async()=>{controller.abort();throw new SyntaxError();});
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('not JSON')).mockResolvedValueOnce(reply);
    const client=new ApiClient(fetcher);
    await expect(client.read('session')).rejects.toMatchObject({code:'INVALID_RESPONSE'});
    await expect(client.read('session',{}, {},controller.signal)).rejects.toMatchObject({name:'AbortError'});
  });
  it('downloads authorized binary with no-store and never treats permission failure as file content',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(new Uint8Array([65,66]),{headers:{'X-Contract-Version':contractVersion}})).mockResolvedValueOnce(failure('NOT_FOUND',404));
    const client=new ApiClient(fetcher);
    expect(await client.read('content',{id:'artifact_test'})).toEqual(new Uint8Array([65,66]));
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({cache:'no-store',credentials:'same-origin'});
    await expect(client.read('content',{id:'artifact_test'})).rejects.toMatchObject({code:'NOT_FOUND'});
  });
  it('discards binary bytes arriving after the restricted view was cleared',async()=>{
    const controller=new AbortController();
    const reply=new Response(new Uint8Array([65]),{headers:{'X-Contract-Version':contractVersion}});
    vi.spyOn(reply,'arrayBuffer').mockImplementation(async()=>{controller.abort();return new Uint8Array([65]).buffer;});
    await expect(new ApiClient(vi.fn<typeof fetch>().mockResolvedValue(reply)).read('content',{id:'artifact_test'},{},controller.signal)).rejects.toMatchObject({name:'AbortError'});
  });
  it('rejects a late parsed response after its read was cancelled',async()=>{
    const controller=new AbortController();
    const reply=response({data:[],nextCursor:null});
    vi.spyOn(reply,'json').mockImplementation(async()=>{controller.abort();return {data:[],nextCursor:null};});
    const client=new ApiClient(vi.fn<typeof fetch>().mockResolvedValue(reply));
    await expect(client.read('tasks',{}, {labId:'lab_test',scope:'mine',limit:30},controller.signal)).rejects.toMatchObject({name:'AbortError'});
  });
  it('retains the identical key and immutable payload after an ambiguous network failure',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(failure('VERSION_CONFLICT',409));
    const client=new ApiClient(fetcher);client.csrfToken='csrf_test';
    const body={expectedVersion:2};const command=new Intent('confirmPlan',body,{id:'plan_test'});body.expectedVersion=99;
    const slot=new CommandSlot();
    await expect(slot.run(client,command)).rejects.toMatchObject({code:'NETWORK_ERROR'});
    await expect(slot.run(client,command)).rejects.toMatchObject({code:'VERSION_CONFLICT'});
    const first=fetcher.mock.calls[0]![1]!;const second=fetcher.mock.calls[1]![1]!;
    expect(first.body).toBe('{"expectedVersion":2}');expect(second).toEqual(first);
    expect(first.credentials).toBe('same-origin');expect(first.headers).toMatchObject({'Idempotency-Key':command.key,'X-CSRF-Token':'csrf_test'});
    expect(slot.intent).toBe(command);
  });
  it('double clicks send one request while in flight',async()=>{
    let resolve!:(value:Response)=>void;
    const fetcher=vi.fn<typeof fetch>(()=>new Promise(r=>resolve=r));
    const slot=new CommandSlot();const client=new ApiClient(fetcher);const command=intent();
    const first=slot.run(client,command);const second=slot.run(client,command);
    resolve(failure('VERSION_CONFLICT',409));
    const results=await Promise.allSettled([first,second]);
    expect(results.every(r=>r.status==='rejected')).toBe(true);expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('requires explicit abandonment before sending a changed intent after failure',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>failure('VERSION_CONFLICT',409));
    const client=new ApiClient(fetcher);const slot=new CommandSlot();const first=intent();
    await expect(slot.run(client,first)).rejects.toMatchObject({code:'VERSION_CONFLICT'});
    const next=intent();expect(next.key).not.toBe(first.key);
    await expect(slot.run(client,next)).rejects.toMatchObject({code:'PENDING_INTENT'});expect(fetcher).toHaveBeenCalledTimes(1);
    slot.discard();await expect(slot.run(client,next)).rejects.toMatchObject({code:'VERSION_CONFLICT'});expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('clears a successful intent so a new user action has a fresh key',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(response({data:{loggedOut:true}}));
    const slot=new CommandSlot();await slot.run(new ApiClient(fetcher),new Intent('logout',{},{}));
    expect(slot.intent).toBeUndefined();expect(intent().key).not.toBe(intent().key);
  });
  it.each([['UNAUTHENTICATED',401],['FORBIDDEN',403],['NOT_FOUND',404],['VERSION_CONFLICT',409],['ALREADY_CLAIMED',409],['SERVICE_UNAVAILABLE',503]] as const)('exposes %s without substituting fixtures',async(code,status)=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(failure(code,status));
    await expect(new ApiClient(fetcher).read('task',{id:'restricted'})).rejects.toMatchObject({code,requestId:'req_test'});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects wrong contract versions and malformed success data',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response({data:[]},200,'0.0.0' as typeof contractVersion)).mockResolvedValueOnce(response({data:{fake:true}}));
    const client=new ApiClient(fetcher);
    await expect(client.read('task',{id:'x'})).rejects.toMatchObject({code:'CONTRACT_MISMATCH'});
    await expect(client.read('task',{id:'x'})).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  });
  it('validates requests before transport and never adds actor identity',async()=>{
    const fetcher=vi.fn<typeof fetch>();
    await expect(new ApiClient(fetcher).call('claim',{params:{id:'x'},query:{},headers:{'Idempotency-Key':'synthetic_command_01'},body:{expectedVersion:1,actorId:'member_C'} as never})).rejects.toMatchObject({code:'VALIDATION_ERROR'});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('aborted reads do not become generic retryable mutations',async()=>{
    const abort=new AbortController();abort.abort();
    const error=new DOMException('Aborted','AbortError');
    const client=new ApiClient(vi.fn<typeof fetch>().mockRejectedValue(error));
    await expect(client.read('session',{}, {},abort.signal)).rejects.toBe(error);
  });
});
