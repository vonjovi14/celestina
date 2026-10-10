// Cloudflare Pages Function. Access protects /admin/* AND /api/*; API validates JWT independently.
const REPO='vonjovi14/celestina', BRANCH='main';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const b64url=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
async function authorized(request,env){
  if(!env.CF_ACCESS_TEAM_DOMAIN||!env.CF_ACCESS_AUD)return false;
  const token=request.headers.get('Cf-Access-Jwt-Assertion');if(!token)return false;
  const parts=token.split('.');if(parts.length!==3)return false;
  const [h,p,s]=parts;let header,payload;try{header=JSON.parse(new TextDecoder().decode(b64url(h)));payload=JSON.parse(new TextDecoder().decode(b64url(p)))}catch{return false}
  if(header.alg!=='RS256'||!header.kid||payload.aud?.includes(env.CF_ACCESS_AUD)!==true)return false;
  const team=env.CF_ACCESS_TEAM_DOMAIN.replace(/\/$/,'');
  if(payload.iss!==team||typeof payload.exp!=='number'||payload.exp<=Date.now()/1000||typeof payload.nbf==='number'&&payload.nbf>Date.now()/1000)return false;
  const r=await fetch(team+'/cdn-cgi/access/certs');if(!r.ok)return false;const jwks=await r.json();const jwk=jwks.keys?.find(k=>k.kid===header.kid&&k.kty==='RSA');if(!jwk)return false;
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,b64url(s),new TextEncoder().encode(h+'.'+p));
}
const validDate=s=>{if(!/^20\d{6}$/.test(s))return false;const y=+s.slice(0,4),m=+s.slice(4,6),d=+s.slice(6,8),v=new Date(Date.UTC(y,m-1,d));return v.getUTCFullYear()===y&&v.getUTCMonth()===m-1&&v.getUTCDate()===d};
async function github(env,path,opts={}){const r=await fetch('https://api.github.com/repos/'+REPO+'/'+path,{...opts,headers:{'Authorization':'Bearer '+env.GITHUB_TOKEN,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'celestina-admin',...(opts.headers||{})}});if(!r.ok){const body=await r.text();throw Error('GitHub '+r.status+': '+body.slice(0,300))}return r.json()}
const getFile=async(env,path)=>{const r=await fetch('https://api.github.com/repos/'+REPO+'/contents/'+path+'?ref='+BRANCH,{headers:{'Authorization':'Bearer '+env.GITHUB_TOKEN,'Accept':'application/vnd.github.raw+json','User-Agent':'celestina-admin'}});if(r.status===404)return null;if(!r.ok)throw Error('GitHub read '+r.status);return r.text()};
export async function onRequest({request,env}){
 try{
  if(!await authorized(request,env))return json({error:'認証できません。Cloudflare Accessの設定を確認してください。'},401);
  if(!env.GITHUB_TOKEN)return json({error:'GITHUB_TOKEN Secretが未設定です。'},500);
  if(request.method==='GET'){
    const date=new URL(request.url).searchParams.get('date');if(!validDate(date))return json({error:'日付が不正です。'},400);
    const raw=await getFile(env,'gallery/'+date+'.txt');if(raw===null)return json({exists:false});const comma=raw.indexOf(',');return json({exists:true,title:comma<0?raw.trim():raw.slice(0,comma).trim(),caption:comma<0?'':raw.slice(comma+1).trim()});
  }
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const length=Number(request.headers.get('content-length')||0);if(length>12*1024*1024)return json({error:'アップロード容量が大きすぎます。'},413);
  const body=await request.json(),{action,date}=body;if(!validDate(date)||!['save','delete'].includes(action))return json({error:'操作または日付が不正です。'},400);
  if(action==='save'&&(typeof body.title!=='string'||!body.title.trim()||body.title.length>120||body.title.includes(',')||/[\r\n]/.test(body.title)||typeof body.caption!=='string'||!body.caption.trim()||body.caption.length>2000))return json({error:'タイトルまたはキャプションが不正です。タイトルにカンマや改行は使えません。'},400);
  if(body.image!==null&&body.image!==undefined&&(typeof body.image!=='string'||body.image.length>11*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.image)))return json({error:'画像データが不正です。'},400);
  const ref=await github(env,'git/ref/heads/'+BRANCH),head=ref.object.sha;
  const commit=await github(env,'git/commits/'+head),treeSha=commit.tree.sha;
  const idxRaw=await getFile(env,'gallery/index.json');if(idxRaw===null)throw Error('gallery/index.jsonが見つかりません');let dates=JSON.parse(idxRaw);if(!Array.isArray(dates))throw Error('index.json形式が不正です');
  const exists=dates.includes(date);if(action==='delete'&&!exists)return json({error:'削除対象がありません。'},404);
  if(action==='save'&&!exists&&!body.image)return json({error:'新規投稿には画像が必要です。'},400);
  dates=action==='delete'?dates.filter(d=>d!==date):[...new Set([...dates,date])];dates.sort((a,b)=>b.localeCompare(a));
  const changes=[];
  const addText=async(path,content)=>{const blob=await github(env,'git/blobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content,encoding:'utf-8'})});changes.push({path,mode:'100644',type:'blob',sha:blob.sha})};
  await addText('gallery/index.json',JSON.stringify(dates,null,2)+'\n');
  if(action==='delete'){
    changes.push({path:'gallery/'+date+'.txt',mode:'100644',type:'blob',sha:null},{path:'gallery/'+date+'.png',mode:'100644',type:'blob',sha:null});
  }else{
    await addText('gallery/'+date+'.txt',body.title.trim()+','+body.caption.trim());
    if(body.image){const blob=await github(env,'git/blobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:body.image,encoding:'base64'})});changes.push({path:'gallery/'+date+'.png',mode:'100644',type:'blob',sha:blob.sha})}
  }
  const tree=await github(env,'git/trees',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base_tree:treeSha,tree:changes})});
  const next=await github(env,'git/commits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Celestina: '+(action==='delete'?'delete ':'publish ')+date,tree:tree.sha,parents:[head]})});
  await github(env,'git/refs/heads/'+BRANCH,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({sha:next.sha,force:false})});
  return json({ok:true,commitUrl:'https://github.com/'+REPO+'/commit/'+next.sha});
 }catch(e){return json({error:e?.message||'Unexpected error'},500)}
}
