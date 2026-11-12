/* Verde por Verde – interfaz (los datos viven en MySQL, se piden a api.php)
   Roles: usuario · admin · proveedor. La pantalla se decide por rol, pero el permiso real
   lo valida api.php en cada petición. */

/* ---------- Estado ---------- */
let MAT=[],PROD=[],R={},ME=null,CSRF='';
const S={user:null,scr:'login',mode:'in',mat:null,kg:0,prod:null,rc:null,err:'',
  adm:{nu:0,kg:0,cj:0,pend:0},cart:[],gen:null,ent:[],users:[],me:0,det:null,sup:[],sp:null,q:1,
  perf:null,cm:'type',got:null,scanErr:''};
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const U=()=>ME;
const stock=i=>PROD[i]?PROD[i][3]:0;

/* Cada rol solo ve sus pantallas */
const HOME={usuario:'home',admin:'panel',proveedor:'sup'};
const ALLOW={usuario:['home','code','shop','rc','perfil'],admin:['panel','entrega','inv','usuarios'],proveedor:['sup']};
const RL={usuario:'Usuario',admin:'Administrador',proveedor:'Proveedor'};
const NAVS={
  usuario:[['home','🏠','Inicio'],['code','♻️','Reciclaje'],['shop','🛒','Canjear'],['perfil','👤','Perfil']],
  admin:[['panel','📊','Panel'],['entrega','♻️','Entrega'],['inv','📦','Inventario'],['usuarios','👥','Usuarios']],
  proveedor:[]};

async function api(action,data){
  let r;
  const h={'Content-Type':'application/json'};if(CSRF)h['X-CSRF-Token']=CSRF;
  try{r=await fetch('api.php?action='+action,{method:'POST',credentials:'same-origin',cache:'no-store',headers:h,body:JSON.stringify(data||{})})}
  catch(e){const x=new Error('No se pudo conectar con el servidor. ¿Está Apache encendido en XAMPP?');x.code=0;throw x}
  let j;
  try{j=await r.json()}catch(e){j={ok:false,error:'El servidor respondió algo inesperado. Revisa que api.php esté en esta carpeta y que PHP funcione.'}}
  if(j.csrf)CSRF=j.csrf;
  if(!j.ok){const x=new Error(j.error||'Error');x.field=j.field;x.code=r.status;throw x}
  return j}
function setCat(c){
  MAT=c.materiales.map(m=>[m.codigo,m.nombre,m.emoji]);
  R={};c.materiales.forEach(m=>R[m.codigo]=Number(m.pts));
  PROD=c.productos.map(p=>[p.nombre,p.emoji,Number(p.costo),Number(p.stock),Number(p.id)])}

/* Carga los datos que necesita cada pantalla */
async function load(v){
  if(v==='panel'){const j=await api('admin');setCat(j.catalogo);S.adm=j.admin}
  else if(v==='entrega'){const [a,b]=await Promise.all([api('admin'),api('entregas')]);setCat(a.catalogo);S.ent=b.entregas}
  else if(v==='inv'){const [a,b]=await Promise.all([api('admin'),api('abastecimientos')]);setCat(a.catalogo);S.sup=b.lista}
  else if(v==='usuarios'){const j=await api('usuarios');S.users=j.usuarios;S.me=j.me}
  else if(v==='sup'){const j=await api('abastecimientos');setCat(j.catalogo);S.sup=j.lista}
  else if(v==='perfil'){const j=await api('perfil');S.perf=j.perfil}}
function enter(u){
  ME=u;S.user=u.n;S.scr=HOME[u.rol]||'home';S.err='';S.mat=null;S.kg=0;S.prod=null;S.cart=[];S.gen=null;S.got=null;S.det=null;S.sp=null;S.q=1;S.cm='type';S.scanErr='';bump()}
/* Borra todo lo privado de la memoria y vuelve al inicio de sesión */
function wipe(msg){
  stopScan();clearInterval(cdT);clearTimeout(idleT);
  ME=null;CSRF='';S.user=null;S.scr='login';S.mode='in';S.mat=null;S.kg=0;S.prod=null;S.rc=null;S.cart=[];S.gen=null;S.got=null;S.det=null;
  S.perf=null;S.users=[];S.ent=[];S.sup=[];S.adm={nu:0,kg:0,cj:0,pend:0};S.err=msg||'';
  try{history.replaceState(null,'',location.pathname)}catch(_){}
  render()}
async function logout(msg){try{await api('logout')}catch(_){}wipe(msg)}

const ready=(async()=>{
  try{const j=await api('init');setCat(j.catalogo);if(j.user){enter(j.user);await load(S.scr)}}
  catch(e){if(e.code===401||e.code===403)wipe(e.message);else S.err=e.message}
  render()})();

/* ---------- Seguridad en el navegador ---------- */
/* 1) Cierra la sesión tras 20 min sin actividad */
let idleT=null;const IDLE=20*60*1000;
function bump(){clearTimeout(idleT);if(ME)idleT=setTimeout(()=>{if(ME)logout('Tu sesión se cerró por inactividad. Inicia sesión de nuevo.')},IDLE)}
['click','keydown','touchstart','scroll'].forEach(ev=>document.addEventListener(ev,bump,{passive:true,capture:true}));
/* 2) El botón "atrás" nunca muestra una pantalla privada guardada en la caché del navegador */
window.addEventListener('pagehide',()=>{$('#app').innerHTML=''});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload()});
/* 3) Si la sesión se cerró en otra pestaña (o expiró), al volver se pide iniciar sesión */
async function check(){
  if(!ME)return;
  try{const j=await api('init');if(!j.user)wipe('Tu sesión terminó. Inicia sesión de nuevo.');
    else if(j.user.rol!==ME.rol){enter(j.user);await load(S.scr);render()}}
  catch(e){if(e.code===401||e.code===403)wipe(e.message)}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')check()});

/* ---------- Validación del formulario ---------- */
const RULES=[['8 caracteres o más',v=>v.length>=8],['Una mayúscula',v=>/[A-Z]/.test(v)],['Una minúscula',v=>/[a-z]/.test(v)],['Un número',v=>/\d/.test(v)],['Un símbolo (!@#$…)',v=>/[^A-Za-z0-9]/.test(v)]];
function msg(id,v){const up=S.mode==='up';
if(id==='n')return v.trim().length<2?'Escribe tu nombre (mínimo 2 letras).':'';
if(id==='e')return !v.trim()?'Escribe tu correo.':!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())?'Eso no parece un correo. Ejemplo: nombre@correo.com':'';
if(id==='p')return !v?'Escribe tu contraseña.':up&&RULES.some(r=>!r[1](v))?'La contraseña debe cumplir todos los requisitos de la lista.':'';
if(id==='p2')return v!==$('#p').value?'Las contraseñas no coinciden.':'';return ''}
function setErr(id,m){const x=$('#x-'+id),el=$('#'+id);if(x)x.textContent=m;if(el)el.setAttribute('aria-invalid',m?'true':'false')}
function chk(id){const el=$('#'+id);if(!el)return '';const m=msg(id,el.value);setErr(id,m);return m}
function rl(){const v=($('#p')||{}).value||'';RULES.forEach((r,i)=>{const li=$('#r'+i);if(li)li.className=r[1](v)?'ok':''})}
const fmt=t=>new Date(t).toLocaleString('es-MX',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
function toast(m){const t=$('#toast');t.textContent=m;t.className='toast s';setTimeout(()=>t.className='toast',2600)}
const fmtCode=c=>c.slice(0,5)+'-'+c.slice(5);
const qrSvg=t=>{const q=qrcode(0,'M');q.addData(t);q.make();return q.createSvgTag({cellSize:4,margin:3,scalable:true,alt:'Código QR de un solo uso'})};

/* ---------- Piezas comunes ---------- */
const nav=()=>{const n=NAVS[ME.rol];return n.length<2?'':`<nav class="nav" aria-label="Principal">${n.map(([k,e,l])=>`<button data-a="go" data-v="${k}" class="${S.scr===k?'on':''}"><span>${e}</span>${l}</button>`).join('')}</nav>`};
const hdr=t=>`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><div><div class="mut">${RL[ME.rol]} · ${esc(S.user)}</div><h1 style="font-size:30px;overflow-wrap:anywhere">${t}</h1></div><button data-a="out" aria-label="Cerrar sesión" style="width:56px;height:56px;border:0;border-radius:50%;background:var(--btn);font-size:28px;cursor:pointer;flex:none">😊</button></div><div style="height:16px"></div>`;
const fld=(id,l,t,ph,ac)=>`<div class="fl"><label for="${id}">${l}</label><input id="${id}" class="in" type="${t}" placeholder="${ph}" autocomplete="${ac}" aria-describedby="x-${id}" aria-invalid="false"><div id="x-${id}" class="er" role="alert"></div></div>`;
const pwf=(id,l,up)=>`<div class="fl"><label for="${id}">${l}</label><div class="pw"><input id="${id}" class="in" type="password" placeholder="••••••••" autocomplete="${up?'new-password':'current-password'}" aria-describedby="x-${id}" aria-invalid="false"><button type="button" class="eye" data-a="eye" aria-label="Mostrar u ocultar contraseña">👁</button></div><div id="x-${id}" class="er" role="alert"></div></div>`;
const rw=(a,b)=>`<div class="rw"><span>${a}</span><span style="color:var(--gt)">${b}</span></div>`;
const mats=(sel)=>MAT.map(m=>`<button class="t ${sel===m[0]?'on':''}" data-a="mat" data-v="${m[0]}"><span class="e">${m[2]}</span>${esc(m[1])}<br><small>${R[m[0]]} pts/kg</small></button>`).join('');
const kgBox=()=>`<div class="kg"><button data-a="kg" data-v="-0.5" aria-label="Restar medio kilo">−</button><div><span style="font-size:60px;font-weight:800">${S.kg.toFixed(1)}</span> <span class="mut" style="font-size:22px">kg</span></div><button class="p" data-a="kg" data-v="0.5" aria-label="Sumar medio kilo">+</button></div>
<div class="chips">${[0.5,1,2,5].map(k=>`<button data-a="kg" data-v="${k}">${k}kg</button>`).join('')}</div>`;
const stat=(n,l)=>`<div class="card c"><div class="big" style="font-size:40px">${n}</div>${l}</div>`;

/* ---------- Vistas: inicio de sesión ---------- */
function vLogin(){const up=S.mode==='up';return `<div class="w c"><div class="logo">♻️</div><h1 class="brand">Verde <span>por Verde</span></h1><p class="mut" style="font-size:20px;margin:6px 0 18px">Recicla · Gana · Come bien 🌱</p>
<div class="tabs" role="tablist"><button role="tab" aria-selected="${!up}" data-a="mode" data-v="in" class="${up?'':'on'}">Iniciar sesión</button><button role="tab" aria-selected="${up}" data-a="mode" data-v="up" class="${up?'on':''}">Crear cuenta</button></div>
<form class="card" id="f" novalidate style="text-align:left">${up?fld('n','Nombre','text','Ej: María García','name'):''}${fld('e','Correo electrónico','email','nombre@correo.com','email')}${pwf('p','Contraseña',up)}${up?`<ul id="rules" class="rl">${RULES.map((r,i)=>`<li id="r${i}">${r[0]}</li>`).join('')}</ul>`+pwf('p2','Confirmar contraseña',up):''}</form>
<button class="btn" id="go" data-a="${up?'reg':'login'}">${up?'Crear mi cuenta 🌱':'¡Entrar! 🚀'}</button><p class="mut" style="font-size:14px${S.err?';color:var(--err)':''}" role="status">${S.err?esc(S.err):(up?'Las cuentas de proveedor las crea el administrador.':'Conectado a la base de datos MySQL.')}</p></div>`}

/* ---------- Vistas: USUARIO ---------- */
function vHome(){const u=U(),nx=PROD.map(p=>p[2]).filter(c=>c>u.b).sort((a,b)=>a-b)[0];
const kg=u.kg,earn=u.earn,days=u.days;
const A=[['🌱','Primer reciclaje',kg>0],['⭐','10 kg reciclados',kg>=10],['🔥','Racha 7 días',days>=7],['👑','Maestro verde',earn>=500]];
const h=u.h;
return `<div class="w"><div style="display:flex;justify-content:space-between;align-items:center"><div><div class="mut">¡Bienvenido/a de vuelta!</div><h1 style="font-size:32px;overflow-wrap:anywhere">¡Hola, ${esc(S.user)}! 👋</h1></div><button data-a="out" aria-label="Cerrar sesión" style="width:56px;height:56px;border:0;border-radius:50%;background:var(--btn);font-size:28px;cursor:pointer">😊</button></div><div style="height:16px"></div>
<div class="hero"><div style="font-size:15px;letter-spacing:.5px">SALDO ACTUAL</div><div><span class="big">${u.b}</span> <span style="font-size:22px">puntos 🌿</span></div>
<div style="display:flex;justify-content:space-between;margin-top:14px;font-size:15px"><span>Próximo canje</span><span>${nx?'Faltan '+(nx-u.b)+' pts':'¡Ya puedes canjear!'}</span></div><div class="bar"><i style="width:${nx?Math.min(100,u.b/nx*100):100}%"></i></div><div style="display:flex;justify-content:space-between;font-size:14px"><span>${u.b} pts</span><span>${nx||'—'} pts</span></div></div>
<div class="g2"><button class="t" data-a="go" data-v="code"><span class="ic" style="margin:0 auto 8px">♻️</span>Ingresar código<br><span class="pill">+puntos</span></button><button class="t" data-a="go" data-v="shop"><span class="ic" style="margin:0 auto 8px;background:var(--warn)">🛒</span>Canjear puntos<br><span class="pill" style="background:var(--warn);color:var(--wt)">${u.b} disp.</span></button></div><div style="height:16px"></div>
<div class="card"><h2 style="font-size:19px;margin-bottom:12px">🏆 Mis logros</h2><div class="ach">${A.map(a=>`<div class="${a[2]?'on':''}"><span>${a[0]}</span>${a[1]}</div>`).join('')}</div></div>
<div class="card"><h2 style="font-size:19px;margin-bottom:6px">📋 Actividad reciente</h2>${h.length?h.map(x=>`<div class="row"><div class="ic">${esc(x.e)}</div><b>${esc(x.n)}<small>${fmt(x.d)}</small></b><b style="flex:none;color:${x.p>0?'var(--gt)':'var(--wt)'}">${x.p>0?'+':''}${x.p}</b></div>`).join(''):'<p class="mut">Aún no tienes actividad. ¡Ingresa tu primer código de reciclaje!</p>'}</div></div>${nav()}`}

function vCode(){const sc=S.cm==='scan';
const typ=`<div class="card"><div class="fl" style="margin-bottom:0"><label for="cc">Código de reciclaje</label><input id="cc" class="in cc" type="text" inputmode="text" maxlength="11" placeholder="XXXXX-XXXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="x-cc" aria-invalid="false"><div id="x-cc" class="er" role="alert">${esc(S.scanErr)}</div></div></div><button class="btn" data-a="redeemc">Canjear código ✅</button>`;
const scn=`<div class="card"><div class="cam"><video id="vid" playsinline muted></video></div><p class="c mut" id="scanmsg" style="margin:0">Apunta la cámara al código QR</p></div>`;
return `<div class="w"><h1 style="font-size:36px">Reciclaje ♻️</h1><p class="mut">Entrega tu material en el centro y usa el QR o el código que te dé el administrador. Cada código sirve una sola vez.</p>
<div class="tabs" role="tablist"><button role="tab" aria-selected="${!sc}" data-a="cm" data-v="type" class="${sc?'':'on'}">Escribir código</button><button role="tab" aria-selected="${sc}" data-a="cm" data-v="scan" class="${sc?'on':''}">Escanear QR</button></div>
${sc?scn:typ}</div>${nav()}${S.got?gotModal():''}`}
function gotModal(){const g=S.got;return `<div class="ov"><div class="md" role="dialog" aria-modal="true" aria-label="Código canjeado"><div class="c"><div class="ic" style="width:80px;height:80px;border-radius:50%;margin:0 auto 10px;font-size:40px">✅</div><h1 style="font-size:26px">¡Código canjeado!</h1><div class="big" style="font-size:48px;color:var(--gt);margin:8px 0">+${g.p}</div><div class="mut">puntos para tu cuenta 🌿</div></div><div class="dash"></div>
${g.i.map(x=>`<div class="row"><div class="ic">${esc(x.e)}</div><b>${esc(x.n)}<small>${x.kg.toFixed(1)} kg</small></b><b style="flex:none;color:var(--gt)">+${x.p}</b></div>`).join('')}
${rw('Saldo actual',U().b+' pts')}<button class="btn" data-a="gotok" style="margin-top:14px">Listo 🏠</button></div></div>`}

function vShop(){const u=U(),p=S.prod!==null?PROD[S.prod]:null;
return `<div class="w"><h1 style="font-size:36px">Canjear 🛒</h1><p class="mut">Elige tus frutas y verduras</p><div class="pill" style="background:var(--btn);color:#fff;font-size:18px;padding:10px 18px;margin-bottom:16px">🌿 ${u.b} puntos disponibles</div>
<div class="g2">${PROD.map((q,i)=>`<button class="pr" data-a="buy" data-v="${i}"><div class="im">${q[1]}</div><div class="tx">${esc(q[0])}<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px"><span class="pill">${q[2]} pts</span><span style="font-size:14px;color:${stock(i)>0&&u.b>=q[2]?'var(--gt)':'var(--wt)'}">${stock(i)<1?'Agotado':u.b>=q[2]?'✓ Puedes':'Faltan '+(q[2]-u.b)}</span></div></div></button>`).join('')}</div></div>${nav()}
${p?`<div class="ov"><div class="md" role="dialog" aria-modal="true" aria-label="Canjear ${esc(p[0])}"><div class="row"><div class="ic" style="width:72px;height:72px;font-size:42px">${p[1]}</div><b style="font-size:24px">${esc(p[0])}<small>Stock disponible: ${stock(S.prod)}</small></b></div><div class="rw"><span>Costo del canje</span><span style="color:var(--gt)">${p[2]} pts</span></div><div class="rw w2"><span>Tu saldo después</span><span>${u.b-p[2]} pts</span></div>
<button class="btn o" data-a="redeem" ${u.b>=p[2]&&stock(S.prod)>0?'':'disabled'} style="margin-top:14px">${stock(S.prod)<1?'Producto agotado':u.b<p[2]?'Puntos insuficientes':'Canjear ahora 🎉'}</button><button class="btn g" data-a="close">Cancelar</button></div></div>`:''}`}
function vRc(){const r=S.rc;return `<div class="w"><div class="card" style="padding:26px"><div class="c"><div class="ic" style="width:80px;height:80px;border-radius:50%;margin:0 auto 10px;font-size:40px">✅</div><h1 style="font-size:28px">¡Canje exitoso!</h1><div class="mut">Comprobante de canje</div></div><div class="dash"></div>
<div class="row"><div class="ic" style="width:72px;height:72px;font-size:40px">${r.e}</div><b style="font-size:22px">${esc(r.n)}<small>1 unidad</small></b></div>
<div class="row"><span class="mut" style="flex:1">Puntos canjeados</span><b style="flex:none;color:var(--wt)">−${r.c} pts</b></div><div class="row"><span class="mut" style="flex:1">Saldo anterior</span><b style="flex:none">${r.a} pts</b></div><div class="row"><span class="mut" style="flex:1">Saldo actual</span><b style="flex:none;color:var(--gt)">${r.a-r.c} pts</b></div><div class="dash"></div>
<div style="display:flex;justify-content:space-between;font-size:14px" class="mut"><span>Folio: ${esc(r.f)}</span><span>${new Date(r.d).toLocaleDateString('es-MX',{day:'numeric',month:'long',year:'numeric'})}</span></div></div>
<p class="c mut">Recoge tu producto en el punto de entrega 📍</p><button class="btn" data-a="go" data-v="home">Volver al inicio 🏠</button></div>`}

/* Perfil: todo lo que la persona ha reciclado y canjeado queda guardado aquí */
function pBody(p){
  const hist=p.hist.length?p.hist.map(x=>`<div class="row"><div class="ic">${esc(x.e)}</div><b>${esc(x.n)}<small>${fmt(x.d)}${x.f?' · '+esc(x.f):''}</small></b><b style="flex:none;color:${x.p>0?'var(--gt)':'var(--wt)'}">${x.p>0?'+':''}${x.p}</b></div>`).join(''):'<p class="mut">Aún no hay movimientos.</p>';
  const ms=p.mats.length?p.mats.map(m=>`<div class="row"><div class="ic">${esc(m.e)}</div><b>${esc(m.n)}<small>${m.kg.toFixed(1)} kg</small></b><b style="flex:none;color:var(--gt)">+${m.p}</b></div>`).join(''):'<p class="mut">Aún no hay material reciclado.</p>';
  return `<div class="hero"><div style="display:flex;align-items:center;gap:14px"><div class="ic" style="width:58px;height:58px;border-radius:50%;background:rgba(255,255,255,.25);color:#fff;font-weight:800;font-size:26px;flex:none">${esc(p.n[0].toUpperCase())}</div><div style="min-width:0"><div style="font-size:22px;font-weight:800;overflow-wrap:anywhere">${esc(p.n)}</div><div style="font-size:14px;overflow-wrap:anywhere">${esc(p.e)}</div></div></div><div style="margin-top:14px"><span class="big" style="font-size:44px">${p.b}</span> <span style="font-size:20px">puntos 🌿</span></div></div>
<div class="g2">${stat(p.kg.toFixed(1),'kg reciclados')}${stat(p.canjes,'canjes')}</div>
<div class="card"><h2 style="font-size:19px;margin-bottom:6px">♻️ Material reciclado</h2>${ms}</div>
<div class="card"><h2 style="font-size:19px;margin-bottom:6px">📋 Historial</h2>${hist}</div>`}
function vPerfil(){
  if(!S.perf)return `<div class="w"><p class="mut">Cargando…</p></div>${nav()}`;
  return `<div class="w"><h1 style="font-size:36px;margin-bottom:14px">Mi perfil 👤</h1>${pBody(S.perf)}<button class="btn g" data-a="out">Cerrar sesión</button></div>${nav()}`}

/* ---------- Vistas: ADMINISTRADOR ---------- */
function vPanel(){const a=S.adm;
return `<div class="w">${hdr('Panel admin 🛠️')}
<div class="g2">${stat(a.nu,'usuarios')}${stat(a.kg.toFixed(1),'kg reciclados')}</div><div class="g2">${stat(a.cj,'canjes realizados')}${stat(a.pend,'códigos pendientes')}</div>
<div class="card"><h2 style="font-size:19px;margin-bottom:8px">Puntos por kilo</h2>${MAT.map(m=>`<div class="row"><div class="ic">${m[2]}</div><b>${esc(m[1])}</b><input class="ri" type="number" min="1" max="1000" value="${R[m[0]]}" data-rate="${m[0]}" aria-label="Puntos por kilo de ${esc(m[1])}"></div>`).join('')}</div></div>${nav()}`}

const ESTADO={pendiente:['⏳','Pendiente','p'],canjeado:['✅','Canjeado',''],anulado:['🚫','Anulado','x'],vencido:['⌛','Vencido','x']};
function vEntrega(){const r=S.mat?Math.round(S.kg*R[S.mat]):0;
const tot=S.cart.reduce((s,x)=>s+Math.round(x.kg*R[x.mat]),0),tkg=S.cart.reduce((s,x)=>s+x.kg,0);
const nm=c=>{const m=MAT.find(x=>x[0]===c);return m?m:[c,c,'♻️']};
return `<div class="w">${hdr('Entrega ♻️')}<p class="mut" style="margin-top:-6px">Revisa el material, regístralo y genera el código para el usuario.</p>
<div class="card"><div class="mut" style="font-size:15px;margin-bottom:10px">📦 Tipo de material</div><div class="g2">${mats(S.mat)}</div></div>
<div class="card"><div class="mut" style="font-size:15px;margin-bottom:10px">⚖️ Peso (kg)</div>${kgBox()}${r?`<div class="rw" style="margin-top:14px"><span>Suma</span><span style="color:var(--gt)">+${r} puntos</span></div>`:''}<button class="btn g" data-a="add" ${S.mat&&S.kg>0?'':'disabled'}>Agregar a la lista ➕</button></div>
<div class="card"><h2 style="font-size:19px;margin-bottom:6px">Material recibido</h2>${S.cart.length?S.cart.map((x,i)=>{const m=nm(x.mat);return `<div class="row"><div class="ic">${m[2]}</div><b>${esc(m[1])}<small>${x.kg.toFixed(1)} kg · ${Math.round(x.kg*R[x.mat])} pts</small></b><button class="rm" data-a="rm" data-v="${i}" aria-label="Quitar ${esc(m[1])}">✕</button></div>`}).join('')+`<div class="dash"></div>${rw('Total',tkg.toFixed(1)+' kg · '+tot+' pts')}`:'<p class="mut">Aún no agregas materiales.</p>'}</div>
<button class="btn" data-a="gen" ${S.cart.length?'':'disabled'}>Confirmar y generar código ✅</button>
<div class="card" style="margin-top:16px"><h2 style="font-size:19px;margin-bottom:6px">Códigos recientes</h2>${S.ent.length?S.ent.map(x=>{const e=ESTADO[x.st]||ESTADO.vencido;return `<div class="row"><div class="ic">${e[0]}</div><b>•••• ${esc(x.fin)} · ${x.p} pts<small>${esc(x.det||'')} · ${fmt(x.d)}${x.por?' · '+esc(x.por):''}</small></b><span class="st ${e[2]}">${e[1]}</span></div>`}).join(''):'<p class="mut">Aún no se generan códigos.</p>'}</div></div>${nav()}${S.gen?genModal():''}`}
function genModal(){const g=S.gen;
return `<div class="ov"><div class="md c" role="dialog" aria-modal="true" aria-label="Código generado"><h1 style="font-size:24px">Código generado ✅</h1><p class="mut" style="margin:4px 0">+${g.pts} puntos · ${g.kg.toFixed(1)} kg</p>
<div class="qr">${qrSvg(g.c)}</div><div class="code" aria-label="Código ${esc(g.c.split('').join(' '))}">${esc(fmtCode(g.c))}</div><p class="mut" id="cd" style="margin:0 0 6px"> </p>
<p class="mut" style="font-size:14px;margin:0 0 10px">El usuario escanea el QR o escribe el código. Sirve una sola vez y solo se muestra ahora.</p>
<button class="btn" data-a="genok">Listo</button><button class="btn g" data-a="void">Anular código</button></div></div>`}

function vInv(){
return `<div class="w">${hdr('Inventario 📦')}
<div class="card"><h2 style="font-size:19px;margin-bottom:8px">Existencias</h2>${PROD.map(p=>`<div class="row"><div class="ic">${p[1]}</div><b>${esc(p[0])}<small>${p[2]} pts</small></b><input class="ri" type="number" min="0" value="${p[3]}" data-stock="${p[4]}" aria-label="Existencias de ${esc(p[0])}"></div>`).join('')}</div>
<div class="card"><h2 style="font-size:19px;margin-bottom:6px">🚚 Entregas de proveedores</h2>${S.sup.length?S.sup.map(x=>`<div class="row"><div class="ic">${esc(x.e)}</div><b>${esc(x.n)}<small>${esc(x.prov)} · ${fmt(x.d)}</small></b><b style="flex:none;color:var(--gt)">+${x.q}</b></div>`).join(''):'<p class="mut">Aún no hay entregas de proveedores.</p>'}</div></div>${nav()}`}

function vUsuarios(){
return `<div class="w">${hdr('Usuarios 👥')}
<div class="card"><h2 style="font-size:19px;margin-bottom:8px">Crear cuenta</h2>
<div class="fl"><label for="nn">Nombre</label><input id="nn" class="in" type="text" autocomplete="off" maxlength="80" aria-describedby="x-nn" aria-invalid="false"><div id="x-nn" class="er" role="alert"></div></div>
<div class="fl"><label for="ne">Correo electrónico</label><input id="ne" class="in" type="email" autocomplete="off" maxlength="120" aria-describedby="x-ne" aria-invalid="false"><div id="x-ne" class="er" role="alert"></div></div>
<div class="fl"><label for="np">Contraseña temporal</label><div class="pw"><input id="np" class="in" type="password" autocomplete="new-password" aria-describedby="x-np" aria-invalid="false"><button type="button" class="eye" data-a="eye" aria-label="Mostrar u ocultar contraseña">👁</button></div><div id="x-np" class="er" role="alert"></div><div class="mut" style="font-size:14px;margin-top:4px">8 o más caracteres, con mayúscula, minúscula, número y símbolo.</div></div>
<div class="fl"><label for="nr">Rol</label><select id="nr" class="sel" style="max-width:none;width:100%;min-height:52px"><option value="proveedor">Proveedor</option><option value="admin">Administrador</option><option value="usuario">Usuario</option></select></div>
<button class="btn" data-a="mku">Crear cuenta ➕</button></div>
<div class="card"><h2 style="font-size:19px;margin-bottom:6px">Cuentas (${S.users.length})</h2>${S.users.map(u=>`<div class="row" style="flex-wrap:wrap"><div class="ic" style="border-radius:50%;background:var(--btn);color:#fff;font-weight:800">${esc(u.n[0].toUpperCase())}</div><b style="min-width:0;overflow-wrap:anywhere">${esc(u.n)}<small>${esc(u.e)}</small><small>${u.b} pts · ${u.kg.toFixed(1)} kg</small></b>
<select class="sel" data-role="${u.id}" aria-label="Rol de ${esc(u.n)}" ${u.id===S.me?'disabled':''}>${Object.keys(RL).map(r=>`<option value="${r}" ${u.rol===r?'selected':''}>${RL[r]}</option>`).join('')}</select>${u.rol==='usuario'?`<button class="lnk" data-a="det" data-v="${u.id}">Historial</button>`:''}</div>`).join('')}</div></div>${nav()}
${S.det?`<div class="ov"><div class="md" role="dialog" aria-modal="true" aria-label="Historial de ${esc(S.det.n)}">${pBody(S.det)}<button class="btn g" data-a="detx">Cerrar</button></div></div>`:''}`}

/* ---------- Vistas: PROVEEDOR ---------- */
function vSup(){
return `<div class="w">${hdr('Inventario 🚚')}<p class="mut" style="margin-top:-6px">Registra los víveres que entregas y se suman al inventario.</p>
<div class="card"><div class="mut" style="font-size:15px;margin-bottom:10px">🥬 Producto</div><div class="g2">${PROD.map((p,i)=>`<button class="t ${S.sp===i?'on':''}" data-a="sp" data-v="${i}"><span class="e">${p[1]}</span>${esc(p[0])}<br><small>En inventario: ${p[3]}</small></button>`).join('')}</div></div>
<div class="card"><div class="mut" style="font-size:15px;margin-bottom:10px">🔢 Cantidad (unidades)</div><div class="kg"><button data-a="q" data-v="-1" aria-label="Restar una unidad">−</button><input id="qi" class="in" type="number" min="1" max="10000" value="${S.q}" aria-label="Cantidad" style="width:140px;font-size:40px;font-weight:800;min-height:72px"><button class="p" data-a="q" data-v="1" aria-label="Sumar una unidad">+</button></div>
<div class="chips">${[5,10,25,50].map(k=>`<button data-a="q" data-v="${k}">+${k}</button>`).join('')}</div></div>
<button class="btn" data-a="sup" ${S.sp!==null?'':'disabled'}>Agregar al inventario ✅</button>
<div class="card" style="margin-top:16px"><h2 style="font-size:19px;margin-bottom:6px">Mis entregas recientes</h2>${S.sup.length?S.sup.map(x=>`<div class="row"><div class="ic">${esc(x.e)}</div><b>${esc(x.n)}<small>${fmt(x.d)}</small></b><b style="flex:none;color:var(--gt)">+${x.q}</b></div>`).join(''):'<p class="mut">Aún no registras entregas.</p>'}</div></div>`}

/* ---------- Dibujo de pantallas ---------- */
const VIEWS={login:vLogin,home:vHome,code:vCode,shop:vShop,rc:vRc,perfil:vPerfil,panel:vPanel,entrega:vEntrega,inv:vInv,usuarios:vUsuarios,sup:vSup};
let lastScr=null;
function render(){
  if(!ME)S.scr='login';
  else if(!ALLOW[ME.rol].includes(S.scr))S.scr=HOME[ME.rol];   // un rol nunca dibuja pantallas de otro
  $('#app').innerHTML=VIEWS[S.scr]();
  if(lastScr!==S.scr){window.scrollTo(0,0);lastScr=S.scr}
  after()}

/* ---------- Cuenta regresiva del código generado ---------- */
let cdT=null;
function tick(){const el=$('#cd');if(!el||!S.gen){clearInterval(cdT);return}
  const s=Math.max(0,Math.round((S.gen.exp-Date.now())/1000));
  el.textContent=s?'Vence en '+String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0'):'Este código ya venció. Genera uno nuevo.'}

/* ---------- Escáner de QR (cámara) ---------- */
let stream=null,scanI=null,starting=false,holdUntil=0;
const cv=document.createElement('canvas'),cx=cv.getContext('2d',{willReadFrequently:true});
function stopScan(){clearInterval(scanI);scanI=null;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}}
async function startScan(){
  if(starting||stream)return;
  if(!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia)){S.scanErr='Aquí no se puede usar la cámara (se necesita https o localhost). Escribe el código.';S.cm='type';render();return}
  starting=true;
  try{
    const st=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
    if(S.scr!=='code'||S.cm!=='scan'||!ME){st.getTracks().forEach(t=>t.stop());starting=false;return}
    stream=st;const v=$('#vid');v.srcObject=st;await v.play();
    scanI=setInterval(scanFrame,220)}
  catch(e){stopScan();S.scanErr='No pudimos abrir la cámara. Revisa el permiso o escribe el código.';S.cm='type';render()}
  starting=false}
function scanFrame(){
  const v=$('#vid');if(!v||v.readyState<2||!v.videoWidth||Date.now()<holdUntil)return;
  const w=Math.min(640,v.videoWidth),h=Math.round(w*v.videoHeight/v.videoWidth);cv.width=w;cv.height=h;cx.drawImage(v,0,0,w,h);
  const q=jsQR(cx.getImageData(0,0,w,h).data,w,h,{inversionAttempts:'dontInvert'});
  if(!q||!q.data)return;
  const c=q.data.toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(c.length!==10){const m=$('#scanmsg');if(m)m.textContent='Ese QR no es de Verde por Verde.';holdUntil=Date.now()+1500;return}
  stopScan();
  redeem(c).then(render).catch(err=>{
    if(err.code===401||err.code===403){wipe(err.message);return}
    toast(err.message);holdUntil=Date.now()+2500;setTimeout(after,2600);render()})}
async function redeem(c){const j=await api('canjear_codigo',{c});ME=j.user;S.got={p:j.puntos,i:j.items}}
/* Se ejecuta después de cada dibujo: mantiene o apaga la cámara y la cuenta regresiva */
function after(){
  const scan=ME&&S.scr==='code'&&S.cm==='scan'&&!S.got;
  if(scan){
    if(Date.now()<holdUntil)return;
    if(stream&&stream.active){const v=$('#vid');if(v&&v.srcObject!==stream){v.srcObject=stream;v.play().catch(()=>{})}}
    else startScan()}
  else stopScan();
  clearInterval(cdT);if(S.gen){tick();cdT=setInterval(tick,1000)}}

/* ---------- Acciones ---------- */
async function act(a,v){
try{
if(a==='mode'){S.mode=v;S.err=''}
else if(a==='eye'){['p','p2','np'].forEach(i=>{const x=$('#'+i);if(x)x.type=x.type==='password'?'text':'password'});return}
else if(a==='login'||a==='reg'){await ready;const up=a==='reg',ids=up?['n','e','p','p2']:['e','p'],bad=ids.filter(i=>chk(i));
 if(bad.length){$('#'+bad[0]).focus();toast('Revisa los campos marcados');return}
 const b=$('#go');b.disabled=true;
 try{const j=await api(up?'registro':'login',up?{n:$('#n').value.trim(),e:$('#e').value.trim(),p:$('#p').value}:{e:$('#e').value.trim(),p:$('#p').value});
  enter(j.user);await load(S.scr);if(up)toast('¡Cuenta creada! 🌱')}
 catch(err){if(err.field)setErr(err.field,err.message);else toast(err.message);b.disabled=false;return}}
else if(a==='go'){if(!ME)return;if(!ALLOW[ME.rol].includes(v))v=HOME[ME.rol];S.prod=null;S.got=null;S.det=null;S.gen=null;S.scanErr='';if(v==='code')S.cm='type';S.scr=v;await load(v)}
else if(a==='out'){await logout();return}
/* usuario */
else if(a==='cm'){S.cm=v;S.scanErr='';holdUntil=0}
else if(a==='redeemc'){const c=($('#cc').value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
 if(c.length!==10){setErr('cc','El código tiene 10 letras y números (por ejemplo K7M2Q-9XP3A).');$('#cc').focus();return}
 try{await redeem(c)}catch(err){if(err.code===401||err.code===403)throw err;setErr('cc',err.message);return}}
else if(a==='gotok'){S.got=null;S.scr='home'}
else if(a==='buy')S.prod=parseInt(v);
else if(a==='close')S.prod=null;
else if(a==='redeem'){const q=PROD[S.prod];if(U().b<q[2]||q[3]<1)return;
 try{const j=await api('canje',{producto:q[4]});ME=j.user;setCat(j.catalogo);S.rc=j.recibo;S.prod=null;S.scr='rc'}
 catch(err){try{const j=await api('init');setCat(j.catalogo);if(j.user)ME=j.user}catch(_){}S.prod=null;throw err}}
/* administrador: entrega y código */
else if(a==='mat')S.mat=v;
else if(a==='kg')S.kg=Math.max(0,Math.round((S.kg+parseFloat(v))*10)/10);
else if(a==='add'){if(!S.mat||S.kg<=0)return;const ex=S.cart.find(x=>x.mat===S.mat);if(ex)ex.kg=Math.round((ex.kg+S.kg)*10)/10;else S.cart.push({mat:S.mat,kg:S.kg});S.mat=null;S.kg=0}
else if(a==='rm')S.cart.splice(parseInt(v),1);
else if(a==='gen'){const j=await api('entrega_crear',{items:S.cart});S.gen=j.codigo;api('entregas').then(r=>{S.ent=r.entregas}).catch(()=>{})}
else if(a==='genok'){S.gen=null;S.cart=[];S.mat=null;S.kg=0;await load('entrega')}
else if(a==='void'){if(!confirm('¿Anular este código? Ya no se podrá usar.'))return;await api('entrega_anular',{id:S.gen.id});S.gen=null;await load('entrega');toast('Código anulado')}
else if(a==='det'){const j=await api('usuario_detalle',{id:parseInt(v)});S.det=j.perfil}
else if(a==='detx')S.det=null;
else if(a==='mku'){
 try{await api('usuario_crear',{n:$('#nn').value.trim(),e:$('#ne').value.trim(),p:$('#np').value,rol:$('#nr').value});await load('usuarios');toast('Cuenta creada ✅')}
 catch(err){if(err.field&&$('#x-n'+err.field)){setErr('n'+err.field,err.message);return}throw err}}
/* proveedor */
else if(a==='sp')S.sp=parseInt(v);
else if(a==='q'){const i=$('#qi');S.q=Math.min(10000,Math.max(1,(parseInt(i&&i.value)||0)+parseInt(v)))}
else if(a==='sup'){const n=parseInt(($('#qi')||{}).value)||0;if(S.sp===null||n<1){toast('Elige un producto y una cantidad');return}
 const j=await api('abastecer',{id:PROD[S.sp][4],n});setCat(j.catalogo);S.q=1;const l=await api('abastecimientos');S.sup=l.lista;toast('Agregado al inventario: +'+n)}
}catch(err){
 if(err.code===401){wipe(err.message);return}
 toast(err.message||'Ocurrió un error')}
render()}

document.addEventListener('click',e=>{const b=e.target.closest('[data-a]');if(b&&!b.disabled)act(b.dataset.a,b.dataset.v)});
document.addEventListener('submit',e=>e.preventDefault());
document.addEventListener('keydown',e=>{if(e.key!=='Enter')return;
 if(e.target.closest&&e.target.closest('#f')){e.preventDefault();const g=$('#go');if(g&&!g.disabled)g.click()}
 else if(e.target.id==='cc'){e.preventDefault();const g=document.querySelector('[data-a="redeemc"]');if(g)g.click()}});
document.addEventListener('input',e=>{const i=e.target.id;
 if(i==='cc'){const c=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,10);e.target.value=c.length>5?c.slice(0,5)+'-'+c.slice(5):c;setErr('cc','');return}
 if(!e.target.closest('#f'))return;if(i==='p'){rl();if($('#p2')&&$('#p2').value)chk('p2')}const x=$('#x-'+i);if(x&&x.textContent)chk(i)});
document.addEventListener('focusout',e=>{if(e.target.closest&&e.target.closest('#f')&&e.target.id&&S.scr==='login')chk(e.target.id)});
document.addEventListener('change',async e=>{const t=e.target,k=t.dataset.rate,s=t.dataset.stock,ro=t.dataset.role;
 if(k){const v=Math.min(1000,Math.max(1,parseInt(t.value)||1));try{await api('tasa',{mat:k,v});R[k]=v;t.value=v;toast('Tasa actualizada')}catch(er){if(er.code===401)wipe(er.message);else toast(er.message)}}
 else if(s){const v=Math.max(0,parseInt(t.value)||0);try{await api('stock',{id:+s,n:v});const p=PROD.find(x=>x[4]===+s);if(p)p[3]=v;t.value=v;toast('Inventario actualizado')}catch(er){if(er.code===401)wipe(er.message);else toast(er.message)}}
 else if(ro){try{await api('usuario_rol',{id:+ro,rol:t.value});toast('Rol actualizado');await load('usuarios');render()}catch(er){if(er.code===401){wipe(er.message);return}toast(er.message);await load('usuarios').catch(()=>{});render()}}
 else if(t.id==='qi'){S.q=Math.min(10000,Math.max(1,parseInt(t.value)||1));t.value=S.q}});
