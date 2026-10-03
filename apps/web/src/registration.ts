import { ApiClient, ApiError, Intent } from './api';
import { escapeHtml as e } from './view-model';

export const registrationPage = `<section class="flow login"><p class="eyebrow">加入你的科研团队</p><h1>注册账号</h1><p class="intro">使用实验室邀请码，设置你自己的账号和密码。</p><form data-form="register" class="panel">
<label>实验室邀请码<input name="inviteCode" required minlength="20" maxlength="128" pattern="[A-Za-z0-9_\\-]+" autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="invite-help"></label><p class="fine" id="invite-help">向实验室负责人索取邀请码。注册后加入该邀请码对应的实验室。</p>
<label>账号<input name="username" required maxlength="100" pattern="[A-Za-z0-9_\\-]+" autocomplete="username" autocapitalize="none" spellcheck="false" aria-describedby="username-help"></label><p class="fine" id="username-help">使用英文字母、数字、下划线或短横线；登录时区分大小写。</p>
<label>显示名<input name="displayName" required maxlength="200" autocomplete="name"></label>
<label>密码<input name="password" type="password" required minlength="9" maxlength="256" autocomplete="new-password" aria-describedby="password-help"></label><p class="fine" id="password-help">密码需超过 8 个字符；建议使用容易记住且不重复的密码。</p>
<label>确认密码<input name="confirmation" type="password" required minlength="9" maxlength="256" autocomplete="new-password"></label>
<button class="primary" type="submit">注册</button><div data-registration-status aria-live="polite"></div></form><p>已有账号？<a href="#/login">去登录</a></p></section>`;

const messages: Record<string,string> = {
 INVITE_UNAVAILABLE:'邀请码无效、已过期、已撤销或名额已满，请向实验室负责人索取有效邀请码。',
 USERNAME_TAKEN:'这个账号已被使用，请换一个账号；如果是你刚刚注册的账号，可以直接登录。',
 RATE_LIMITED:'注册尝试较多，请稍后再试。',
 VALIDATION_ERROR:'请检查邀请码、账号格式、显示名和密码长度。',
 FORBIDDEN:'页面来源校验未通过，请从正式网站重新打开注册页。',
};

export function bindRegistration(root: ParentNode, api: ApiClient, signal: AbortSignal) {
 const form=root.querySelector<HTMLFormElement>('[data-form=register]')!;
 const status=form.querySelector<HTMLElement>('[data-registration-status]')!;
 let pending: Intent<'register'> | undefined, active=false;
 const inputs=[...form.querySelectorAll<HTMLInputElement>('input')];
 const submit=form.querySelector<HTMLButtonElement>('[type=submit]')!;
 const clear=()=>{pending=undefined;form.reset();};
 signal.addEventListener('abort',clear,{once:true});
 const execute=async()=>{
  if(active || !pending || signal.aborted)return;
  active=true;inputs.forEach(x=>x.disabled=true);submit.disabled=true;
  status.textContent='正在注册…';
  try {
   const result=await api.send(pending);
   if(signal.aborted)return;
   clear();
   form.innerHTML=`<h2>注册成功</h2><p>账号 <strong>${e(result.data.username)}</strong> 已创建，可以使用你设置的密码登录。</p><a class="button primary" href="#/login">去登录</a>`;
  }catch(error){
   if(signal.aborted)return;
   const code=error instanceof ApiError?error.code:'NETWORK_ERROR';
   if(messages[code] && code!=='RATE_LIMITED'){
    pending=undefined;inputs.forEach(x=>x.disabled=false);submit.disabled=false;
    status.innerHTML=`<p role="alert">${e(messages[code])}</p>`;
   }else{
    // Keep an uncertain request only in this page's memory; never persist credentials.
    status.innerHTML=`<p role="alert">${code==='RATE_LIMITED'?e(messages.RATE_LIMITED!):'暂时无法确认注册结果。重试会沿用同一请求，不会重复创建账号。你也可以去登录确认账号是否已创建。'}</p><button type="button" data-registration-retry>重试注册</button>`;
    status.querySelector<HTMLButtonElement>('[data-registration-retry]')!.onclick=()=>void execute();
   }
  }finally{active=false;}
 };
 form.onsubmit=event=>{
  event.preventDefault();if(active || pending)return;
  const data=new FormData(form), password=String(data.get('password'));
  if(password!==data.get('confirmation')){status.innerHTML='<p role="alert">两次输入的密码不一致，请重新确认。</p>';return;}
  pending=new Intent('register',{inviteCode:String(data.get('inviteCode')).trim(),username:String(data.get('username')).trim(),displayName:String(data.get('displayName')).trim(),password},{});
  void execute();
 };
}
