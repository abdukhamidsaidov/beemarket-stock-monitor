/* BeeMarket Stock Monitor — data flow: upload, local storage, snapshot import/export, demo, boot.
   Сервера нет: всё считается и хранится в браузере пользователя (GitHub Pages отдаёт только статику). */
(function(){
"use strict";
const BM=window.BM, S=BM.S, UI=BM.UI, PZ=BM.parse, {el,$,fmtD,todayISO}=BM.H;
const msg=(t,kind)=>{const b=$("uploadMsg");b.textContent="";if(t)b.append(el("div",{class:"msg "+(kind||"info"),text:t}));};

/* ================= storage: IndexedDB для снимка (может весить мегабайты), localStorage для мелочей ================= */
const LS={
  get(k,def){ try{ const v=localStorage.getItem(k); return v==null?def:JSON.parse(v); }catch(_){ return def; } },
  set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); return true; }catch(_){ return false; } },
  del(k){ try{ localStorage.removeItem(k); }catch(_){} }
};
const IDB=(()=>{
  let dbp=null;
  const open=()=>{ if(!dbp) dbp=new Promise((res,rej)=>{ try{ const r=indexedDB.open("beemarket-stock-monitor",1); r.onupgradeneeded=()=>r.result.createObjectStore("kv"); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }catch(e){ rej(e); } }); return dbp; };
  const tx=(mode,fn)=>open().then(db=>new Promise((res,rej)=>{ const t=db.transaction("kv",mode), s=t.objectStore("kv"), q=fn(s); t.oncomplete=()=>res(q&&q.result); t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error); }));
  return { get:k=>tx("readonly",s=>s.get(k)).catch(()=>null), set:(k,v)=>tx("readwrite",s=>s.put(v,k)).then(()=>true).catch(()=>false), del:k=>tx("readwrite",s=>s.delete(k)).catch(()=>null) };
})();

/* ================= empty state ================= */
function emptyState(){
  $("stamp").textContent="Данных пока нет";
  document.querySelectorAll(".view:not(#v-settings)").forEach(v=>{
    if(v.querySelector(".empty.boot")) return;
    const box=el("div",{class:"empty boot"});
    box.append(el("p",{text:"Загрузите «Отчёт об остатках на складах» и «Отчёт по продажам» из ERP — дашборд посчитается прямо в браузере. Или откройте демо с вымышленными данными, чтобы посмотреть, как всё устроено."}));
    const acts=el("div",{class:"acts"});
    const b1=el("button",{type:"button",class:"btn",text:"Загрузить выгрузки"}); b1.onclick=()=>UI.selectTab("settings");
    const b2=el("button",{type:"button",class:"btn ghost",text:"Показать демо"}); b2.onclick=loadDemo;
    acts.append(b1,b2); box.append(acts); v.prepend(box);
  });
}
function clearEmpty(){ document.querySelectorAll(".empty.boot").forEach(e=>e.remove()); }
function afterData(){ clearEmpty(); UI.fillFilters(); UI.renderParams(); UI.renderAll(); $("btnExport").disabled=!S.data; }

/* ================= history ================= */
function historyDoc(data,src){
  const saveF=S.filt; S.filt={cat:"",brand:"",chan:""}; const prev=S.data; S.data=data; const M=BM.compute(); S.data=prev; S.filt=saveF;
  return {date:data.meta.stockDate,label:fmtD(M.dFrom).slice(0,5)+"–"+fmtD(M.dTo),st:M.T.st,cogs:M.T.cogs,days:M.days,cov:M.T.cov,dead:M.T.dead,rev:M.T.rev,marP:M.T.marP,src:src||("Загрузка "+new Date().toLocaleDateString("ru-RU"))};
}
const upsertHist=(arr,h)=>arr.filter(x=>x.date!==h.date).concat([h]);
const validHist=h=>Array.isArray(h)?h.filter(x=>x&&typeof x==="object"&&/^\d{4}-\d{2}-\d{2}$/.test(String(x.date||""))&&isFinite(x.st)):[];

/* ================= persist real data ================= */
async function commitData(data,hist,note){
  S.demo=false; S.data=data; S.history=hist;
  const okHist=LS.set("bm-history",hist);
  const okSnap=await IDB.set("snapshot",data);
  afterData();
  const saved=okSnap&&okHist;
  msg(note+(saved?" Снимок сохранён в этом браузере — после перезагрузки страницы данные останутся.":" Сохранить в браузере не удалось (приватный режим или запрет хранилища) — данные пропадут после перезагрузки."),saved?"ok":"info");
}

/* ================= upload flow ================= */
const drops={stock:["dropStock","fileStock","fnStock"],sales:["dropSales","fileSales","fnSales"]};
async function takeFile(file){
  if(/\.json$/i.test(file.name)) return importSnapshot(file);
  try{
    msg("Читаю «"+file.name+"»…","info");
    const sh=await PZ.readSheet(file); const kind=PZ.detect(sh.head);
    if(!kind){ msg("Не узнал файл «"+file.name+"»: в нём нет колонок «Остаток»/«Филиал» или «Сумма»/«Название филиала».","err"); return; }
    S.pending[kind]={file,sh};
    $(drops[kind][2]).textContent="✓ "+file.name+" · "+sh.rows.length.toLocaleString("ru-RU")+" строк"+(kind==="sales"&&!sh.head.includes("Разница")?" · ⚠ нет колонки «Разница»":"");
    if(kind==="stock"){ const m=file.name.match(/(\d{10})/); const d=m?new Date(Number(m[1])*1000):null; $("stockDate").value = d&&!isNaN(d) ? new Date(d.getTime()+5*3600e3).toISOString().slice(0,10) : todayISO(); }
    msg(""); updateApply();
  }catch(e){ msg("Не удалось прочитать «"+file.name+"»: "+(e&&e.message||e),"err"); }
}
function updateApply(){ const ok=!!(S.pending.stock&&S.pending.sales); $("btnApply").disabled=!ok; $("applyNote").textContent= ok ? "Данные сохранятся только в этом браузере" : "Нужны оба файла"; }
Object.entries(drops).forEach(([k,[d,f]])=>{
  const dz=$(d), inp=$(f);
  inp.addEventListener("change",()=>{ if(inp.files[0]) takeFile(inp.files[0]); });
  dz.addEventListener("dragover",e=>{e.preventDefault();dz.classList.add("over");});
  dz.addEventListener("dragleave",()=>dz.classList.remove("over"));
  dz.addEventListener("drop",e=>{e.preventDefault();dz.classList.remove("over");[...e.dataTransfer.files].forEach(takeFile);});
});
/* файл, брошенный мимо зоны загрузки, не должен открываться вместо сайта */
window.addEventListener("dragover",e=>e.preventDefault());
window.addEventListener("drop",e=>{ if(!e.target.closest||!e.target.closest(".drop")) e.preventDefault(); });

$("btnApply").addEventListener("click",async()=>{
  const btn=$("btnApply"); btn.disabled=true;
  try{
    const sd=$("stockDate").value||todayISO();
    const data=PZ.buildCompact(S.pending.stock.sh,S.pending.sales.sh,{stockDate:sd,stockFile:S.pending.stock.file.name,salesFile:S.pending.sales.file.name,uploadedAt:new Date().toISOString()});
    const hist=upsertHist(S.demo?[]:S.history,historyDoc(data));
    S.pending={stock:null,sales:null}; $("fnStock").textContent=""; $("fnSales").textContent=""; $("fileStock").value=""; $("fileSales").value="";
    await commitData(data,hist,"Готово: сток на "+fmtD(sd)+", "+data.meta.stockRows.toLocaleString("ru-RU")+" строк остатков и "+data.meta.salesRows.toLocaleString("ru-RU")+" строк продаж.");
  }catch(e){
    msg("Не удалось обновить: "+((e&&e.message)||String(e)),"err");
  } finally { updateApply(); }
});

/* ================= snapshot import / export ================= */
async function importSnapshot(file){
  try{
    if(file.size>50*1024*1024) throw new Error("файл больше 50 МБ — это не похоже на снимок");
    const j=JSON.parse(await file.text());
    if(Array.isArray(j)){ // history.json
      const h=validHist(j); if(!h.length) throw new Error("в файле нет записей истории");
      let hist=S.demo?[]:S.history.slice(); h.forEach(x=>hist=upsertHist(hist,x));
      S.history=hist; LS.set("bm-history",hist); UI.renderAll(); UI.renderHistory();
      msg("История загрузок дополнена: "+h.length+" записей.","ok"); return;
    }
    const data = j&&j.data&&j.data.meta ? j.data : j; // формат сайта {format,data,history} и формат артефакта {ver,data}
    if(!PZ.validSnapshot(data)) throw new Error("структура файла не похожа на снимок BeeMarket Stock Monitor");
    if(!data.meta.stockDate) data.meta.stockDate=todayISO();
    let hist=S.demo?[]:S.history.slice();
    validHist(j.history).forEach(x=>hist=upsertHist(hist,x));
    if(!hist.some(x=>x.date===data.meta.stockDate)) hist=upsertHist(hist,historyDoc(data,"Снимок "+file.name));
    await commitData(data,hist,"Снимок «"+file.name+"» открыт: сток на "+fmtD(data.meta.stockDate)+".");
  }catch(e){ msg("Не удалось открыть снимок: "+((e&&e.message)||String(e)),"err"); }
}
$("fileSnap").addEventListener("change",e=>{ const f=e.target.files[0]; if(f) importSnapshot(f); e.target.value=""; });
$("btnExport").addEventListener("click",()=>{
  if(!S.data) return;
  const body=JSON.stringify({format:"beemarket-stock-snapshot",version:1,exportedAt:new Date().toISOString(),demo:S.demo||undefined,data:S.data,history:S.demo?[]:S.history});
  const url=URL.createObjectURL(new Blob([body],{type:"application/json"}));
  const a=el("a",{href:url,download:"beemarket-snapshot-"+(S.data.meta.stockDate||todayISO())+(S.demo?"-demo":"")+".json"});
  document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),4000);
});
$("btnClear").addEventListener("click",async()=>{
  if(!window.confirm("Удалить сохранённый снимок, историю и параметры из этого браузера? Исходные файлы на компьютере не затрагиваются.")) return;
  await IDB.del("snapshot"); LS.del("bm-history"); LS.del("bm-params");
  S.data=null; S.history=[]; S.demo=false; S.params=JSON.parse(JSON.stringify(BM.DEF));
  UI.renderParams(); UI.renderAll(); UI.renderHistory(); $("btnExport").disabled=true; emptyState();
  msg("Данные удалены из браузера.","ok");
});

/* ================= parameters ================= */
$("btnSaveParams").addEventListener("click",()=>{
  const p=UI.readParams(); S.params=p; UI.fillFilters(); UI.renderAll();
  $("paramsNote").textContent = LS.set("bm-params",p) ? "Сохранено в этом браузере" : "Применено до перезагрузки страницы (хранилище браузера недоступно)";
});
$("btnResetParams").addEventListener("click",()=>{
  S.params=JSON.parse(JSON.stringify(BM.DEF)); LS.del("bm-params"); UI.renderParams(); UI.fillFilters(); UI.renderAll();
  $("paramsNote").textContent="Стандартные параметры восстановлены";
});

/* ================= demo: вымышленные данные, ничего не сохраняется ================= */
function rng(seed){ return ()=>{ seed|=0; seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function demoSheets(){
  const R=rng(20261119), pick=a=>a[Math.floor(R()*a.length)];
  const brands=["Apple","Samsung","Honor","Xiaomi","Redmi","POCO","ZTE","Tecno","Infinix"];
  const cats=[["Смартфоны","Телефоны"],["Планшеты","Телефоны"],["Наушники","Аксессуары"],["Чехлы","Аксессуары"],["Зарядные устройства","Аксессуары"],["Умные часы","Гаджеты"]];
  const mats=["NEW","Active","Active","Active","EOL_Active","EOL_Clearance","OLD","0"];
  const brs=["Онлайн склад (ГО)","IT-Park","Uzum FBO","Uzum FBS/DBS","Демо-филиал Север","Демо-филиал Юг","Демо-филиал Восток","Демо-филиал Запад","Демо-филиал Центр","Демо-филиал Река","Демо-филиал Парк","Демо-филиал Рынок"];
  const pays=["Наличные","Карта Uzcard","Карта Humo","Alif nasiya 6","Alif nasiya 12","TBC nasiya 12","Click","Payme"];
  const sts=["done","done","done","done","done","done","packed","placed","pick_up","cancelled"];
  const srcs=["Сайт","Приложение","Маркетплейс",null];
  const skus=[]; for(let i=0;i<90;i++){ const b=pick(brands), c=pick(cats); skus.push({ess:String(900000+i),name:b+" Демо "+c[0].toLowerCase()+" "+String(i+1).padStart(3,"0"),b,c:c[0],c1:c[1],m:pick(mats),cost:pick([180e3,420e3,950e3,2.4e6,4.9e6,8.7e6,13.5e6]),prov:R()<.15?"Комиссионный":"Собственный",pop:R()}); }
  const stH=["Название товара","Категория","Остаток","Бренд","Филиал","Product ESS ID","Тип провайдера","Цена","Матрица"], stR=[];
  for(const s of skus){ const n=1+Math.floor(R()*5); for(let j=0;j<n;j++){ const q=1+Math.floor(R()*(s.pop<.2?14:7)); const uc=s.cost*(R()<.2?1.07:1); stR.push([s.name,s.c,q,s.b,pick(brs),s.ess,s.prov,Math.round(uc*q),s.m]); } }
  for(const s of skus.slice(0,6)) s.oos=true; // продаются, но нет на складе
  const saH=["Дата выдачи","Название продукта","Название филиала","ESS_ID","Сумма","Тип оплаты","Статус заказа","Категория","Бренд","Тип провайдера","Матрица","Разница","Источник продажи","Категория 1 уровня"], saR=[];
  const end=new Date(todayISO()+"T00:00:00Z");
  for(let d=29;d>=0;d--){ const day=new Date(end.getTime()-(d+1)*864e5).toISOString().slice(0,10);
    for(const s of skus){ if(s.pop<.22) continue; const k=Math.floor(R()*s.pop*2.6); for(let j=0;j<k;j++){ const price=s.cost*(0.95+R()*0.3); saR.push([day,s.name,pick(brs),s.ess,Math.round(price),pick(pays),pick(sts),s.c,s.b,s.prov,s.m,Math.round(price-s.cost),pick(srcs),s.c1]); } } }
  const oosSet=new Set(skus.filter(s=>s.oos).map(s=>s.name));
  return {st:{head:stH,rows:stR.filter(r=>!oosSet.has(r[0]))},sa:{head:saH,rows:saR}};
}
function loadDemo(){
  try{
    const {st,sa}=demoSheets();
    const data=PZ.buildCompact(st,sa,{stockDate:todayISO(),stockFile:"demo",salesFile:"demo",uploadedAt:new Date().toISOString(),demo:true});
    S.demo=true; S.data=data;
    const h0=historyDoc(data,"Демо"); const hist=[];
    for(let i=4;i>=1;i--){ const d=new Date(new Date(h0.date+"T00:00:00Z").getTime()-i*7*864e5).toISOString().slice(0,10); const f=1+i*0.06; hist.push(Object.assign({},h0,{date:d,label:fmtD(d).slice(0,5),st:h0.st*f,cov:h0.cov!=null?h0.cov*f:null,src:"Демо"})); }
    hist.push(h0); S.history=hist;
    afterData();
    UI.selectTab("overview");
    msg("Открыты демо-данные: все товары, филиалы и суммы вымышленные. Они не сохраняются — загрузите свои выгрузки, чтобы заменить их.","info");
  }catch(e){ console.error(e); msg("Не удалось построить демо: "+(e&&e.message||e),"err"); }
}
$("btnDemo").addEventListener("click",loadDemo);

/* ================= boot ================= */
(async function boot(){
  const p=LS.get("bm-params",null); if(p&&typeof p==="object"&&Array.isArray(p.online)&&p.norms) S.params=Object.assign(JSON.parse(JSON.stringify(BM.DEF)),p);
  S.history=validHist(LS.get("bm-history",[]));
  UI.renderParams(); updateApply();
  let tab="overview"; try{ tab=localStorage.getItem("bm-tab")||tab; }catch(_){}
  UI.selectTab(tab,{scroll:false});
  const snap=await IDB.get("snapshot");
  if(snap&&PZ.validSnapshot(snap)){ S.data=snap; afterData(); }
  else { emptyState(); UI.renderHistory(); }
  if(new URLSearchParams(location.search).has("demo")&&!S.data) loadDemo(); // ссылка ?demo сразу открывает демо
})();
})();
