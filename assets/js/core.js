/* BeeMarket Stock Monitor — core: state, helpers, ERP parsing, model */
(function(){
"use strict";
/* ================= state ================= */
const DEF = {
  online:["Онлайн склад (ГО)","IT-Park","Uzum FBO","Uzum FBS/DBS"],
  statuses:["done","packed","placed","pick_up"],
  keyBrands:["Apple","Samsung","Honor","Xiaomi","Redmi","POCO","ZTE"],
  norms:{"NEW":[2,0.75],"Active":[1.5,0.5],"EOL_Active":[1,0.25],"EOL_Clearance":[0.5,0],"OLD":[0.5,0],"Без матрицы":[1,0.25]},
  K:1.5, rate:0.20, abcA:0.8, abcB:0.95
};
const MATRIX = ["NEW","Active","EOL_Active","EOL_Clearance","OLD","Без матрицы"];
const STATUS = ["Норма","Излишек","Дефицит","OOS","NEW без продаж","Dead stock"];
const S = { data:null, params:JSON.parse(JSON.stringify(DEF)), history:[], demo:false, filt:{cat:"",brand:"",chan:""}, pending:{stock:null,sales:null}, tab:"overview" };

/* ================= helpers ================= */
const $ = id => document.getElementById(id);
const el = (tag, attrs, ...kids) => { const e=document.createElement(tag); if(attrs) for(const k in attrs){ if(k==="class") e.className=attrs[k]; else if(k==="text") e.textContent=attrs[k]; else e.setAttribute(k,attrs[k]); } kids.forEach(c=>{ if(c==null) return; e.append(c.nodeType?c:document.createTextNode(String(c))); }); return e; };
const fmtM = v => (v==null||!isFinite(v)) ? "—" : (v/1e6).toLocaleString("ru-RU",{minimumFractionDigits:1,maximumFractionDigits:1});
const fmtI = v => (v==null||!isFinite(v)) ? "—" : Math.round(v).toLocaleString("ru-RU");
const fmtP = v => (v==null||!isFinite(v)) ? "—" : (v*100).toLocaleString("ru-RU",{minimumFractionDigits:1,maximumFractionDigits:1})+"%";
const fmt1 = v => (v==null||!isFinite(v)) ? "—" : v.toLocaleString("ru-RU",{minimumFractionDigits:1,maximumFractionDigits:1});
const fmtD = iso => { if(!iso||!/^\d{4}-\d{2}-\d{2}/.test(iso)) return "—"; const [y,m,d]=iso.slice(0,10).split("-"); return d+"."+m+"."+y; };
const sum = (a,f) => a.reduce((s,x)=>s+(f?f(x):x),0);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const toNum = v => { if(v==null||v==="") return null; if(typeof v==="number") return isFinite(v)?v:null; const n=Number(String(v).replace(/[\s ]/g,"").replace(",",".")); return isFinite(n)?n:null; };
const str = v => v==null ? "" : String(v).trim();
const mat = v => { const s=str(v); return (s && s!=="0") ? s : "Без матрицы"; };
const payGroup = p => { p=str(p); return p.startsWith("Alif") ? "Alif nasiya" : p.startsWith("TBC") ? "TBC nasiya" : (p||"Не указано"); };
const statusClass = s => "s-"+(String(s).split(" ")[0]);
/* local calendar date (Asia/Tashkent etc.), not UTC */
const todayISO = () => { const d=new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10); };

/* ================= lazy SheetJS (≈880 КБ грузится только когда нужен Excel) ================= */
let xlsxP=null;
function loadXLSX(){
  if(window.XLSX) return Promise.resolve(window.XLSX);
  if(!xlsxP) xlsxP=new Promise((res,rej)=>{
    const s=document.createElement("script"); s.src="assets/vendor/xlsx.full.min.js"; s.async=true;
    s.onload=()=>window.XLSX?res(window.XLSX):rej(new Error("модуль чтения Excel не инициализировался"));
    s.onerror=()=>{ xlsxP=null; rej(new Error("не удалось загрузить модуль чтения Excel — проверьте интернет")); };
    document.head.append(s);
  });
  return xlsxP;
}

/* ================= parse ERP files ================= */
/* Excel serial date → ISO (1900 date system, the one ERP exports use) */
const excelDate = n => { const d=new Date(Math.round((n-25569)*864e5)); return isNaN(d) ? "" : d.toISOString().slice(0,10); };
function normDate(v){
  if(v==null||v==="") return "";
  if(typeof v==="number") return (v>20000&&v<80000) ? excelDate(v) : "";
  let d=str(v);
  let m=d.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) return m[1]+"-"+m[2]+"-"+m[3];
  m=d.match(/^(\d{2})\.(\d{2})\.(\d{4})/); if(m) return m[3]+"-"+m[2]+"-"+m[1];
  m=d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if(m) return m[3]+"-"+m[1].padStart(2,"0")+"-"+m[2].padStart(2,"0");
  return "";
}
async function readSheet(file){
  const X = await loadXLSX();
  const isCsv = /\.csv$/i.test(file.name);
  /* CSV читаем как UTF-8 текст: иначе кириллица в заголовках превращается в «кракозябры» */
  const wb = isCsv ? X.read(await file.text(),{type:"string",raw:true}) : X.read(await file.arrayBuffer(),{type:"array",cellDates:false});
  const ws = wb.Sheets[wb.SheetNames[0]];
  if(!ws) throw new Error("в файле нет листов");
  const aoa = X.utils.sheet_to_json(ws,{header:1,raw:true,defval:null,blankrows:false});
  const head = (aoa[0]||[]).map(h=>str(h));
  return {head, rows:aoa.slice(1).filter(r=>r.some(v=>v!==null&&v!==""))};
}
function detect(head){
  if(head.includes("Остаток") && head.includes("Филиал")) return "stock";
  if(head.includes("Сумма") && head.includes("Название филиала")) return "sales";
  return null;
}
const NEED_STOCK=["Название товара","Категория","Остаток","Бренд","Филиал","Product ESS ID","Тип провайдера","Цена","Матрица"];
const NEED_SALES=["Дата выдачи","Название продукта","Название филиала","ESS_ID","Сумма","Тип оплаты","Статус заказа","Категория","Бренд","Тип провайдера","Матрица"];
function buildCompact(st, sa, meta){
  const I = h => { const m={}; h.forEach((k,i)=>{ if(!(k in m)) m[k]=i; }); return m; };
  const SI=I(st.head), XI=I(sa.head);
  const miss=[...NEED_STOCK.filter(k=>!(k in SI)).map(k=>"остатки: «"+k+"»"),...NEED_SALES.filter(k=>!(k in XI)).map(k=>"продажи: «"+k+"»")];
  if(miss.length) throw new Error("Не найдены колонки — "+miss.join(", "));
  const skus=[],skuIdx=new Map(),brs=[],brIdx=new Map(),lists={pt:[],st:[],pay:[],src:[],c1:[]};
  const L=(n,v)=>{const a=lists[n];let i=a.indexOf(v);if(i<0){i=a.length;a.push(v);}return i;};
  const B=n=>{if(!brIdx.has(n)){brIdx.set(n,brs.length);brs.push(n);}return brIdx.get(n);};
  const K=(ess,name,brand,cat,m)=>{const k=ess?ess:"N:"+name;if(!skuIdx.has(k)){skuIdx.set(k,skus.length);skus.push([k,name,brand,cat,m]);}return skuIdx.get(k);};
  const g=(r,M,k)=> k in M ? r[M[k]] : null;
  const srt=st.rows.slice().sort((a,b)=>(toNum(g(b,SI,"Цена"))||0)-(toNum(g(a,SI,"Цена"))||0));
  const agg=new Map();
  for(const r of srt){
    const si=K(str(g(r,SI,"Product ESS ID")),str(g(r,SI,"Название товара")),str(g(r,SI,"Бренд")),str(g(r,SI,"Категория")),mat(g(r,SI,"Матрица")));
    const key=[B(str(g(r,SI,"Филиал"))),si,L("pt",str(g(r,SI,"Тип провайдера")))].join("|");
    const a=agg.get(key)||[0,0]; a[0]+=toNum(g(r,SI,"Остаток"))||0; a[1]+=toNum(g(r,SI,"Цена"))||0; agg.set(key,a);
  }
  const stock=[...agg].map(([k,v])=>{const p=k.split("|").map(Number);return [p[0],p[1],+v[0].toFixed(3),+v[1].toFixed(2),p[2]];});
  const hasMarCol = "Разница" in XI;
  const sagg=new Map(); let badDates=0;
  for(const r of sa.rows){
    const si=K(str(g(r,XI,"ESS_ID")),str(g(r,XI,"Название продукта")),str(g(r,XI,"Бренд")),str(g(r,XI,"Категория")),mat(g(r,XI,"Матрица")));
    const d=normDate(g(r,XI,"Дата выдачи")); if(!d) badDates++;
    const mar = hasMarCol ? toNum(g(r,XI,"Разница")) : null;
    const key=[d,B(str(g(r,XI,"Название филиала"))),si,L("st",str(g(r,XI,"Статус заказа"))),L("pay",str(g(r,XI,"Тип оплаты"))),L("src",str(g(r,XI,"Источник продажи"))),L("pt",str(g(r,XI,"Тип провайдера"))),L("c1",str(g(r,XI,"Категория 1 уровня"))),mar!=null?1:0].join("|");
    const a=sagg.get(key)||[0,0,0]; a[0]+=1; a[1]+=toNum(g(r,XI,"Сумма"))||0; a[2]+=mar||0; sagg.set(key,a);
  }
  const sales=[...sagg].map(([k,v])=>{const p=k.split("|");return [p[0],+p[1],+p[2],+p[3],+p[4],+p[5],+p[6],+p[7],v[0],+v[1].toFixed(2),+v[2].toFixed(2),+p[8]];});
  return {meta:Object.assign({stockRows:st.rows.length,salesRows:sa.rows.length,hasMarCol,badDates},meta),skus,branches:brs,lists,stock,sales};
}

/* sanity check for snapshots opened from a .json file */
function validSnapshot(d){
  if(!d||typeof d!=="object"||!d.meta||typeof d.meta!=="object") return false;
  const arr=x=>Array.isArray(x);
  if(!arr(d.skus)||!arr(d.stock)||!arr(d.sales)||!arr(d.branches)||!d.lists) return false;
  for(const k of ["pt","st","pay","src","c1"]) if(!arr(d.lists[k])) return false;
  const nS=d.skus.length, nB=d.branches.length;
  if(!d.skus.every(s=>arr(s)&&s.length>=5&&typeof s[0]==="string")) return false;
  if(!d.stock.every(r=>arr(r)&&r.length>=5&&r[0]<nB&&r[1]<nS)) return false;
  if(!d.sales.every(r=>arr(r)&&r.length>=12&&r[1]<nB&&r[2]<nS)) return false;
  return true;
}

/* ================= model ================= */
function compute(){
  const D=S.data, P=S.params; if(!D) return null;
  const F=S.filt, onl=new Set(P.online), stOK=new Set(P.statuses), kb=new Set(P.keyBrands);
  const chanOf = bi => onl.has(D.branches[bi]) ? "Online" : "Offline";
  const skuOK = D.skus.map(s => (!F.cat || s[3]===F.cat) && (!F.brand || (kb.has(s[2])?s[2]:"Others")===F.brand));
  // dates
  const counted = D.sales.filter(r=>stOK.has(D.lists.st[r[3]]));
  const dates = counted.map(r=>r[0]).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const dFrom = dates[0]||null, dTo = dates[dates.length-1]||null;
  const days = dFrom ? Math.round((new Date(dTo)-new Date(dFrom))/864e5)+1 : 30;
  // avg unit cost per sku from full stock (for sales lacking Разница)
  const ucQ=new Float64Array(D.skus.length), ucC=new Float64Array(D.skus.length);
  for(const r of D.stock){ ucQ[r[1]]+=r[2]; ucC[r[1]]+=r[3]; }
  // fallback COGS ratio
  let kr=0,kc=0; for(const r of counted){ if(r[11]){kr+=r[9];kc+=r[9]-r[10];} else if(ucQ[r[2]]>0){kr+=r[9];kc+=r[8]*ucC[r[2]]/ucQ[r[2]];} }
  const fb = kr>0 ? kc/kr : 0.93;
  const cogsOf = r => r[11] ? r[9]-r[10] : (ucQ[r[2]]>0 ? r[8]*ucC[r[2]]/ucQ[r[2]] : r[9]*fb);
  const src = r => r[11] ? "erp" : (ucQ[r[2]]>0 ? "stock" : "ratio");
  // per-sku
  const A=D.skus.map((s,i)=>({i,k:s[0],n:s[1],b:s[2],kb:kb.has(s[2])?s[2]:"Others",c:s[3],m:s[4],qOn:0,qOff:0,cOn:0,cOff:0,sq:0,rev:0,cogs:0,ucMin:Infinity,ucMax:0}));
  for(const r of D.stock){ if(!skuOK[r[1]]) continue; const ch=chanOf(r[0]); if(F.chan && ch!==F.chan) continue; const a=A[r[1]];
    if(ch==="Online"){a.qOn+=r[2];a.cOn+=r[3];} else {a.qOff+=r[2];a.cOff+=r[3];}
    if(r[2]>0 && r[3]>0){ const u=r[3]/r[2]; if(u<a.ucMin)a.ucMin=u; if(u>a.ucMax)a.ucMax=u; } }
  const fs = counted.filter(r=>skuOK[r[2]] && (!F.chan || chanOf(r[1])===F.chan));
  const srcCnt={erp:0,stock:0,ratio:0};
  for(const r of fs){ const a=A[r[2]]; a.sq+=r[8]; a.rev+=r[9]; const c=cogsOf(r); a.cogs+=c; srcCnt[src(r)]+=r[9]; }
  const m30 = 30/days;
  const L=[];
  for(const a of A){
    if(!skuOK[a.i]) continue;
    a.q=a.qOn+a.qOff; a.st=a.cOn+a.cOff; if(a.q===0&&a.st===0&&a.sq===0) continue;
    const mc=a.cogs*m30; a.mcogs=mc;
    a.cov = a.cogs>0 ? a.st/mc : null; a.doh = a.cogs>0 ? a.st/(a.cogs/days) : null;
    a.turn = a.st>0 ? a.cogs*365/days/a.st : null;
    const nm=P.norms[a.m]||P.norms["Без матрицы"]||[1,0.25]; a.tgt=nm[0]; a.min=nm[1];
    a.status = (a.st===0&&a.cogs===0) ? "Нет движения" : a.st===0 ? "OOS" : a.cogs===0 ? (a.m==="NEW"?"NEW без продаж":"Dead stock") : a.cov<a.min ? "Дефицит" : a.cov>a.tgt*P.K ? "Излишек" : "Норма";
    a.excess = a.cogs===0 ? a.st : Math.max(0,a.st-a.tgt*mc);
    a.need = (a.status==="OOS"||a.status==="Дефицит") ? Math.max(0,a.tgt*mc-a.st) : 0;
    a.carry = a.excess*P.rate/12;
    a.mar = a.rev-a.cogs; a.marP = a.rev>0 ? a.mar/a.rev : null;
    a.gmroi = (a.rev>0&&a.st>0) ? a.mar*365/days/a.st : null;
    if(!isFinite(a.ucMin)) a.ucMin=null; a.spread = (a.ucMin&&a.ucMax) ? a.ucMax/a.ucMin-1 : null;
    a.ppv = a.ucMin ? Math.max(0,a.st-a.ucMin*a.q) : 0;
    a.onShare = a.st>0 ? a.cOn/a.st : 0;
    L.push(a);
  }
  // ABC by revenue
  const totRev=sum(L,a=>a.rev); let cum=0;
  L.slice().sort((x,y)=>y.rev-x.rev).forEach(a=>{ if(a.rev<=0){a.abc="—";return;} cum+=a.rev; const s=cum/totRev; a.abc = s<=P.abcA+1e-9?"A": s<=P.abcB+1e-9?"B":"C"; });
  // branches
  const BR=new Map();
  const gb = bi => { let b=BR.get(bi); if(!b){ b={name:D.branches[bi],ch:chanOf(bi),rows:0,q:0,st:0,dead:0,old:0,sq:0,rev:0,cogs:0}; BR.set(bi,b);} return b; };
  const stOf = new Map(L.map(a=>[a.i,a]));
  for(const r of D.stock){ if(!skuOK[r[1]]) continue; if(F.chan && chanOf(r[0])!==F.chan) continue; const b=gb(r[0]); const a=stOf.get(r[1]); b.rows++; b.q+=r[2]; b.st+=r[3];
    if(a && a.status==="Dead stock") b.dead+=r[3]; const m=D.skus[r[1]][4]; if(m.startsWith("EOL")||m==="OLD") b.old+=r[3]; }
  for(const r of fs){ const b=gb(r[1]); b.sq+=r[8]; b.rev+=r[9]; b.cogs+=cogsOf(r); }
  const branches=[...BR.values()].map(b=>Object.assign(b,{cov:b.cogs>0?b.st/(b.cogs*m30):null, deadP:b.st>0?b.dead/b.st:null, marP:b.rev>0?1-b.cogs/b.rev:null})).sort((x,y)=>y.st-x.st);
  // sales cuts
  const cut = f => { const m=new Map(); for(const r of fs){ const k=f(r); const o=m.get(k)||{k,q:0,rev:0,cogs:0}; o.q+=r[8]; o.rev+=r[9]; o.cogs+=cogsOf(r); m.set(k,o);} return [...m.values()].map(o=>Object.assign(o,{mar:o.rev-o.cogs,marP:o.rev>0?(o.rev-o.cogs)/o.rev:null,avg:o.q>0?o.rev/o.q:null})).sort((a,b)=>b.rev-a.rev); };
  const byDay=cut(r=>r[0]).filter(x=>x.k).sort((a,b)=>a.k<b.k?-1:1);
  const byPay=cut(r=>payGroup(D.lists.pay[r[4]]));
  const bySrc=cut(r=>D.lists.src[r[5]]||"Прямая продажа");
  const byPt=cut(r=>D.lists.pt[r[6]]||"—");
  const byCh=cut(r=>chanOf(r[1]));
  const byC1=cut(r=>D.lists.c1[r[7]]||"—");
  // totals
  const T={};
  T.st=sum(L,a=>a.st); T.q=sum(L,a=>a.q); T.cogs=sum(L,a=>a.cogs); T.rev=sum(L,a=>a.rev); T.mar=T.rev-T.cogs; T.sq=sum(L,a=>a.sq);
  T.cov=T.cogs>0?T.st/(T.cogs*m30):null; T.doh=T.cogs>0?T.st/(T.cogs/days):null; T.turn=T.st>0?T.cogs*365/days/T.st:null;
  T.marP=T.rev>0?T.mar/T.rev:null; T.gmroi=T.st>0?T.mar*365/days/T.st:null;
  T.on=sum(L,a=>a.cOn)/(T.st||1);
  const bySt=s=>L.filter(a=>a.status===s);
  T.dead=sum(bySt("Dead stock"),a=>a.st); T.newNo=sum(bySt("NEW без продаж"),a=>a.st);
  T.excess=sum(L,a=>a.excess); T.carry=sum(L,a=>a.carry); T.need=sum(L,a=>a.need);
  T.oosN=bySt("OOS").length; T.oosCogs=sum(bySt("OOS"),a=>a.cogs); T.defN=bySt("Дефицит").length;
  T.ppv=sum(L,a=>a.ppv); T.lossN=L.filter(a=>a.rev>0&&a.mar<0).length; T.loss=sum(L.filter(a=>a.mar<0&&a.rev>0),a=>a.mar);
  T.inst=sum(byPay.filter(p=>p.k.endsWith("nasiya")),p=>p.rev)/(T.rev||1);
  T.onRev=sum(byCh.filter(c=>c.k==="Online"),c=>c.rev)/(T.rev||1);
  const comm=new Set(D.lists.pt.map((p,i)=>/^Комисс|^commission/i.test(p)?i:-1).filter(i=>i>=0));
  T.comm=sum(D.stock.filter(r=>comm.has(r[4])&&skuOK[r[1]]&&(!F.chan||chanOf(r[0])===F.chan)),r=>r[3]);
  T.srcErp=(srcCnt.erp)/(T.rev||1);
  // QC
  const QC=[
    ["Строк в выгрузке остатков", D.meta.stockRows, null],
    ["Строк в выгрузке продаж", D.meta.salesRows, null],
    ["Колонка «Разница» в продажах", D.meta.hasMarCol!==false?"есть":"нет — себестоимость из остатков", D.meta.hasMarCol===false?"warn":"ok"],
    ["Выручка с себестоимостью из ERP", fmtP(T.srcErp), T.srcErp>0.99?"ok":"warn"],
    ["Продажи с нераспознанной датой, строк", D.meta.badDates||0, D.meta.badDates?"warn":"ok"],
    ["Продажи в неучтённых статусах, шт", sum(D.sales.filter(r=>!stOK.has(D.lists.st[r[3]])),r=>r[8]), null],
    ["SKU без Product ESS ID (ключ по названию)", D.skus.filter(s=>s[0].startsWith("N:")).length, null],
    ["SKU со стоком без матрицы", L.filter(a=>a.m==="Без матрицы"&&a.st>0).length, null],
    ["SKU с разбросом себестоимости > 20%", L.filter(a=>a.spread>0.2).length, null],
    ["SKU, проданные ниже себестоимости", T.lossN, T.lossN?"warn":"ok"],
    ["Резервная доля COGS (если нет ни «Разницы», ни остатка)", fmtP(fb), null]
  ];
  return {L,T,branches,byDay,byPay,bySrc,byPt,byCh,byC1,days,dFrom,dTo,QC,m30};
}

window.BM = { S, DEF, MATRIX, STATUS,
  H:{fmtM,fmtI,fmtP,fmt1,fmtD,el,$,sum,css,MATRIX,STATUS,payGroup,statusClass,todayISO},
  parse:{readSheet,detect,buildCompact,validSnapshot,loadXLSX},
  compute };
})();
