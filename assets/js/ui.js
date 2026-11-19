/* BeeMarket Stock Monitor — UI: tables, charts, views */
(function(){
"use strict";
const {S,H}=window.BM, {fmtM,fmtI,fmtP,fmt1,fmtD,el,$,sum,css,MATRIX,STATUS,statusClass}=H;
const charts={};
let M=null;
const narrow=()=>window.matchMedia("(max-width:640px)").matches;
const trunc=(s,n)=>{ s=String(s==null?"":s); return s.length>n ? s.slice(0,n-1)+"…" : s; };

/* ================= generic sortable table ================= */
function table(host, cols, rows, opts={}){
  const box=$(host); box.textContent="";
  if(!rows.length){ box.append(el("div",{class:"empty",text:opts.empty||"Нет данных для выбранных фильтров"})); return; }
  let sortKey=opts.sort||null, dir=opts.dir||-1;
  const t=el("table"); const thead=el("thead"); const tr=el("tr"); const ths=[];
  cols.forEach(c=>{ const th=el("th",{class:(c.n?"n ":"")+(c.l?"l":""),text:c.label,scope:"col",tabindex:"0"}); th.addEventListener("click",()=>{ if(sortKey===c.key) dir=-dir; else {sortKey=c.key; dir=c.n?-1:1;} draw(); }); th.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();th.click();}}); ths.push([th,c]); tr.append(th); });
  thead.append(tr); t.append(thead); const tb=el("tbody"); t.append(tb);
  if(opts.foot){ const tf=el("tfoot"); const r=el("tr"); cols.forEach((c,i)=>{ const v=opts.foot[c.key]; r.append(el("td",{class:(c.n?"n":"")+(c.l?" l":""),text: i===0?"Итого": v==null?"":(c.f?c.f(v):v)})); }); tf.append(r); t.append(tf); }
  function draw(){
    ths.forEach(([th,c])=>{ if(c.key===sortKey) th.setAttribute("aria-sort",dir>0?"ascending":"descending"); else th.removeAttribute("aria-sort"); });
    let rs=rows.slice(); if(sortKey){ const c=cols.find(x=>x.key===sortKey); const g=c.get||(r=>r[c.key]); rs.sort((a,b)=>{ const x=g(a),y=g(b); if(x==null&&y==null) return 0; if(x==null) return 1; if(y==null) return -1; return (x<y?-1:x>y?1:0)*dir; }); }
    if(opts.limit) rs=rs.slice(0,opts.limit);
    tb.textContent="";
    const frag=document.createDocumentFragment();
    for(const r of rs){ const row=el("tr"); for(const c of cols){ const v=(c.get||(x=>x[c.key]))(r); const td=el("td",{class:(c.n?"n ":"")+(c.l?"l ":"")+(c.cls||"")});
      if(c.render) c.render(td,v,r); else td.textContent = v==null?"—":(c.f?c.f(v):v); row.append(td);} frag.append(row); }
    tb.append(frag);
  }
  draw(); box.append(t);
}
const pill=(td,v)=>{ td.append(el("span",{class:"pill "+statusClass(v),text:v})); };
const covCell=(td,v,r)=>{ td.textContent=v==null?"—":fmt1(v); if(v!=null&&r.tgt!=null){ td.style.color = v>r.tgt*S.params.K? css("--bad") : v<r.min? css("--info") : css("--ok"); } };
const C={
  name:{key:"n",label:"Товар",l:1,cls:"name"}, ess:{key:"k",label:"ESS ID",l:1,get:r=>r.k.startsWith("N:")?"—":r.k},
  brand:{key:"kb",label:"Бренд",l:1}, cat:{key:"c",label:"Категория",l:1}, m:{key:"m",label:"Матрица",l:1},
  status:{key:"status",label:"Статус",l:1,render:pill}, abc:{key:"abc",label:"ABC",l:1},
  q:{key:"q",label:"Остаток, шт",n:1,f:fmtI}, st:{key:"st",label:"Сток, млн",n:1,f:fmtM}, on:{key:"onShare",label:"Онлайн",n:1,f:fmtP},
  sq:{key:"sq",label:"Продано, шт",n:1,f:fmtI}, rev:{key:"rev",label:"Выручка, млн",n:1,f:fmtM}, cogs:{key:"cogs",label:"COGS, млн",n:1,f:fmtM},
  cov:{key:"cov",label:"Покрытие, мес",n:1,render:covCell}, tgt:{key:"tgt",label:"Норма, мес",n:1,f:fmt1}, doh:{key:"doh",label:"Дней запаса",n:1,f:fmtI},
  turn:{key:"turn",label:"Оборот, раз/год",n:1,f:fmt1}, ex:{key:"excess",label:"Сверх нормы, млн",n:1,f:fmtM}, need:{key:"need",label:"Дозаказ, млн",n:1,f:fmtM},
  carry:{key:"carry",label:"Владение, млн/мес",n:1,f:v=>(v/1e6).toLocaleString("ru-RU",{maximumFractionDigits:2})}, mar:{key:"mar",label:"Маржа, млн",n:1,f:fmtM}, marP:{key:"marP",label:"Маржа, %",n:1,f:fmtP},
  gmroi:{key:"gmroi",label:"GMROI",n:1,f:v=>v.toLocaleString("ru-RU",{maximumFractionDigits:2})}, spread:{key:"spread",label:"Разброс себест.",n:1,f:fmtP}, ppv:{key:"ppv",label:"Переплата, млн",n:1,f:fmtM},
  ucMin:{key:"ucMin",label:"Мин. себест.",n:1,f:fmtI}, ucMax:{key:"ucMax",label:"Макс. себест.",n:1,f:fmtI}
};

/* ================= charts ================= */
function chart(id,cfg){
  if(charts[id]){ charts[id].destroy(); delete charts[id]; }
  const cv=$(id); if(!cv) return;
  if(typeof window.Chart==="undefined"){ // библиотека графиков не загрузилась — показываем заглушку, а не падаем
    const box=cv.parentElement; if(!box.querySelector(".nochart")) box.append(el("div",{class:"nochart",text:"График недоступен: не загрузилась библиотека Chart.js"})); return;
  }
  const ink=css("--ink"), mut=css("--muted"), line=css("--line");
  Chart.defaults.font.family=css("--f-body"); Chart.defaults.color=mut;
  cfg.options=Object.assign({responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{labels:{color:ink,boxWidth:12}},tooltip:{}}},cfg.options||{});
  const sc=cfg.options.scales||{}; for(const k in sc){ sc[k].grid=Object.assign({color:line},sc[k].grid||{}); sc[k].ticks=Object.assign({color:mut},sc[k].ticks||{}); }
  charts[id]=new Chart(cv,cfg);
}
const mln=v=>v/1e6;
const PAL=()=>({ok:css("--ok"),warn:css("--warn"),bad:css("--bad"),info:css("--info"),violet:css("--violet"),accent:css("--accent"),ink:css("--ink"),muted:css("--muted"),soft:css("--soft")});
const statusColor=s=>{const p=PAL();return {"Норма":p.ok,"Излишек":p.warn,"Дефицит":p.info,"OOS":p.violet,"NEW без продаж":p.accent,"Dead stock":p.bad}[s];};
const mlnTick={callback:v=>v.toLocaleString("ru-RU")};
/* длинные названия филиалов/категорий на узком экране обрезаем на оси, полное имя — в подсказке */
const catTick=()=>({callback:function(v){ return trunc(this.getLabelForValue(v), narrow()?16:34); }});

/* ================= KPI tiles ================= */
function tiles(host,list){ const b=$(host); b.textContent=""; for(const t of list){ const d=el("div",{class:"kpi "+(t.cls||"")}); d.append(el("span",{class:"lab",text:t.lab})); const v=el("span",{class:"val"}); v.append(t.val); if(t.u) v.append(el("small",{text:t.u})); d.append(v); if(t.sub) d.append(el("span",{class:"sub",text:t.sub})); b.append(d);} }

/* ================= views ================= */
function renderOverview(){
  const T=M.T, P=S.params;
  tiles("kpiMain",[
    {lab:"Сток по себестоимости",val:fmtM(T.st),u:"млн",sub:fmtI(T.q)+" шт · онлайн "+fmtP(T.on)},
    {lab:"Покрытие стока",val:fmt1(T.cov),u:"мес",sub:fmtI(T.doh)+" дней запаса",cls:T.cov>3?"attn":""},
    {lab:"Оборачиваемость",val:fmt1(T.turn),u:"раз/год",sub:"ориентир для электроники 6–10"},
    {lab:"Выручка за период",val:fmtM(T.rev),u:"млн",sub:fmtI(T.sq)+" шт · "+M.days+" дн."},
    {lab:"Валовая маржа",val:fmtP(T.marP),sub:fmtM(T.mar)+" млн · GMROI "+(T.gmroi==null?"—":T.gmroi.toFixed(2)),cls:(T.marP!=null&&T.marP<0.05)?"warn":""},
    {lab:"Dead stock",val:fmtM(T.dead),u:"млн",sub:fmtP(T.dead/(T.st||1))+" стока без продаж",cls:"bad attn"},
    {lab:"NEW без продаж",val:fmtM(T.newNo),u:"млн",sub:"новинки не стартовали"},
    {lab:"Сверх норматива",val:fmtM(T.excess),u:"млн",sub:"владение "+fmtM(T.carry)+" млн/мес при "+fmtP(P.rate)+" годовых",cls:"warn"},
    {lab:"OOS: спрос без стока",val:fmtI(T.oosN),u:"SKU",sub:fmtM(T.oosCogs)+" млн COGS продаж",cls:T.oosN?"attn":""},
    {lab:"Потребность дозаказа",val:fmtM(T.need),u:"млн",sub:T.defN+" SKU в дефиците + OOS"},
    {lab:"Рассрочка Alif + TBC",val:fmtP(T.inst),sub:"доля выручки · онлайн "+fmtP(T.onRev)},
    {lab:"Комиссионный сток",val:fmtM(T.comm),u:"млн",sub:"товар поставщика, входит в сток"}
  ]);
  // insights
  const I=[]; const L=M.L;
  const topDead=L.filter(a=>a.status==="Dead stock").sort((a,b)=>b.st-a.st)[0];
  if(topDead) I.push(["bad",`Крупнейший неликвид — ${topDead.n}: ${fmtI(topDead.q)} шт на ${fmtM(topDead.st)} млн без единой продажи за ${M.days} дн.`]);
  const mx=MATRIX.map(m=>{const r=L.filter(a=>a.m===m);const st=sum(r,a=>a.st),cg=sum(r,a=>a.cogs);return {m,cov:cg>0?st/(cg*M.m30):null,st,tgt:(S.params.norms[m]||[1])[0]};}).filter(x=>x.cov!=null&&x.st>0&&x.tgt>0).sort((a,b)=>b.cov/b.tgt-a.cov/a.tgt)[0];
  if(mx) I.push(["warn",`Матрица ${mx.m}: покрытие ${fmt1(mx.cov)} мес при нормативе ${fmt1(mx.tgt)} — в ${fmt1(mx.cov/mx.tgt)} раза выше.`]);
  if(T.lossN) I.push(["bad",`${T.lossN} SKU продано ниже себестоимости, убыток ${fmtM(-T.loss)} млн. Список — во вкладке «Действия».`]);
  const brw=M.branches.filter(b=>b.cov!=null&&b.st>50e6).sort((a,b)=>b.cov-a.cov)[0];
  if(brw) I.push(["warn",`Филиал ${brw.name}: ${fmtM(brw.st)} млн стока при покрытии ${fmt1(brw.cov)} мес — кандидат на перемещение товара.`]);
  const pay=M.byPay.filter(p=>p.rev>0.03*T.rev&&p.marP!=null).sort((a,b)=>a.marP-b.marP)[0];
  if(pay) I.push(["info",`Самая низкая маржа по оплате: ${pay.k} — ${fmtP(pay.marP)} (${fmtP(pay.rev/(T.rev||1))} выручки).`]);
  if(T.oosN) I.push(["info",`${T.oosN} SKU продаются, но закончились на складе; дозаказ до норматива — ${fmtM(T.need)} млн.`]);
  const ib=$("insights"); ib.textContent="";
  if(!I.length) ib.append(el("div",{class:"insight"},el("span",{class:"sev","aria-hidden":"true"}),el("span",{text:"Критичных отклонений не найдено."})));
  I.forEach(([s,t])=>{ const d=el("div",{class:"insight"}); d.append(el("span",{class:"sev "+s,"aria-hidden":"true"}),el("span",{text:t})); ib.append(d); });
  // status chart
  const p=PAL(); const sts=STATUS.map(s=>({s,v:sum(L.filter(a=>a.status===s),a=>a.st)}));
  chart("chStatus",{type:"bar",data:{labels:sts.map(x=>x.s),datasets:[{data:sts.map(x=>mln(x.v)),backgroundColor:sts.map(x=>statusColor(x.s)),borderRadius:4}]},options:{indexAxis:"y",plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt1(c.raw)+" млн · "+fmtP(sts[c.dataIndex].v/(T.st||1))}}},scales:{x:{ticks:mlnTick},y:{grid:{display:false}}}}});
  // matrix coverage
  const mm=MATRIX.map(m=>{const r=L.filter(a=>a.m===m);const st=sum(r,a=>a.st),cg=sum(r,a=>a.cogs);return {m,cov:cg>0?st/(cg*M.m30):0,tgt:(S.params.norms[m]||[1])[0]};});
  chart("chMatrixCov",{type:"bar",data:{labels:mm.map(x=>x.m),datasets:[{type:"bar",label:"Покрытие, мес",data:mm.map(x=>+x.cov.toFixed(2)),backgroundColor:mm.map(x=>x.cov>x.tgt*S.params.K?p.bad:x.cov>x.tgt?p.warn:p.ok),borderRadius:4},{type:"line",label:"Норматив",data:mm.map(x=>x.tgt),borderColor:p.ink,backgroundColor:p.ink,borderDash:[4,4],pointRadius:3,showLine:true}]},options:{scales:{y:{beginAtZero:true},x:{ticks:{autoSkip:false,maxRotation:narrow()?60:0}}}}});
  // brands
  const kbs=[...S.params.keyBrands,"Others"].map(b=>{const r=L.filter(a=>a.kb===b);const st=sum(r,a=>a.st),ex=sum(r,a=>a.excess);return {b,norm:st-ex,ex};}).sort((a,b)=>(b.norm+b.ex)-(a.norm+a.ex));
  chart("chBrands",{type:"bar",data:{labels:kbs.map(x=>x.b),datasets:[{label:"В пределах норматива",data:kbs.map(x=>mln(x.norm)),backgroundColor:p.ink,borderRadius:3},{label:"Сверх норматива",data:kbs.map(x=>mln(x.ex)),backgroundColor:p.warn,borderRadius:3}]},options:{scales:{x:{stacked:true,grid:{display:false}},y:{stacked:true,ticks:mlnTick}}}});
  // trend
  const h=S.history.slice().sort((a,b)=>a.date<b.date?-1:1);
  chart("chTrend",{type:"bar",data:{labels:h.map(x=>x.label||fmtD(x.date)),datasets:[{type:"bar",label:"Сток, млн",data:h.map(x=>mln(x.st)),backgroundColor:p.soft,borderColor:p.muted,borderWidth:1,yAxisID:"y",borderRadius:3},{type:"line",label:"Покрытие, мес",data:h.map(x=>x.cov!=null?+x.cov.toFixed(2):null),borderColor:p.accent,backgroundColor:p.accent,yAxisID:"y1",tension:.25,pointRadius:4}]},options:{scales:{y:{ticks:mlnTick,beginAtZero:true},y1:{position:"right",beginAtZero:true,grid:{display:false}}}}});
}

let agingChip="all", skuChip="all";
function chipRow(host,opts,get,set,draw){
  const chips=$(host); chips.textContent="";
  if(!opts.some(([k])=>k===get())) set("all");
  opts.forEach(([k,t])=>{const b=el("button",{type:"button",class:"chip","aria-pressed":String(k===get()),text:t});b.onclick=()=>{set(k);[...chips.children].forEach(c=>c.setAttribute("aria-pressed",String(c===b)));draw();};chips.append(b);});
}
function renderAging(){
  const L=M.L, dead=L.filter(a=>a.status==="Dead stock"||a.status==="NEW без продаж");
  const byM=m=>sum(dead.filter(a=>a.m===m),a=>a.st);
  tiles("kpiAging",[
    {lab:"Без продаж за период",val:fmtM(sum(dead,a=>a.st)),u:"млн",sub:dead.length+" SKU · "+fmtI(sum(dead,a=>a.q))+" шт",cls:"bad attn"},
    {lab:"из них Active",val:fmtM(byM("Active")),u:"млн",sub:"ядро ассортимента не продаётся"},
    {lab:"из них NEW",val:fmtM(byM("NEW")),u:"млн",sub:"проверить запуск"},
    {lab:"EOL / OLD без продаж",val:fmtM(byM("EOL_Active")+byM("EOL_Clearance")+byM("OLD")),u:"млн",sub:"кандидаты на уценку"},
    {lab:"Стоимость владения",val:fmtM(sum(dead,a=>a.carry)),u:"млн/мес",sub:"цена денег в неликвиде"}
  ]);
  $("agingNote").textContent=fmtD(M.dFrom)+" – "+fmtD(M.dTo)+", "+M.days+" дн.";
  const draw=()=>{ const q=$("agingSearch").value.trim().toLowerCase(); let r=dead; if(agingChip.startsWith("m:")) r=r.filter(a=>a.m===agingChip.slice(2)); else if(agingChip!=="all") r=r.filter(a=>a.status===agingChip); if(q) r=r.filter(a=>a.n.toLowerCase().includes(q)||a.k.toLowerCase().includes(q));
    table("agingTable",[C.name,C.ess,C.brand,C.m,C.status,C.q,C.st,C.on,C.carry],r,{sort:"st",foot:{q:sum(r,a=>a.q),st:sum(r,a=>a.st),carry:sum(r,a=>a.carry)}}); };
  chipRow("agingChips",[["all","Все"],["Dead stock","Dead stock"],["NEW без продаж","NEW без продаж"],...MATRIX.map(m=>["m:"+m,m])],()=>agingChip,v=>agingChip=v,draw);
  $("agingSearch").oninput=draw; draw();
  const cats=[...new Set(dead.map(a=>a.c))].map(c=>({c,v:sum(dead.filter(a=>a.c===c),a=>a.st)})).sort((a,b)=>b.v-a.v).slice(0,12);
  chart("chDeadCat",{type:"bar",data:{labels:cats.map(x=>x.c),datasets:[{data:cats.map(x=>mln(x.v)),backgroundColor:PAL().bad,borderRadius:4}]},options:{indexAxis:"y",plugins:{legend:{display:false}},scales:{x:{ticks:mlnTick},y:{grid:{display:false},ticks:catTick()}}}});
}

function groupRows(key,items){
  const L=M.L; const tot=M.T.st||1;
  return items.map(k=>{const r=L.filter(a=>a[key]===k);const st=sum(r,a=>a.st),cg=sum(r,a=>a.cogs),rev=sum(r,a=>a.rev);
    return {k,st,share:st/tot,rev,cogs:cg,marP:rev>0?(rev-cg)/rev:null,cov:cg>0?st/(cg*M.m30):null,tgt:key==="m"?(S.params.norms[k]||[null])[0]:null,min:key==="m"?(S.params.norms[k]||[0,0])[1]:null,dead:sum(r.filter(a=>a.status==="Dead stock"),a=>a.st),ex:sum(r,a=>a.excess),exP:st>0?sum(r,a=>a.excess)/st:null,n:r.length};}).filter(x=>x.n);
}
function renderMatrix(){
  const gcols=lab=>[{key:"k",label:lab,l:1},{key:"n",label:"SKU",n:1,f:fmtI},{key:"st",label:"Сток, млн",n:1,f:fmtM},{key:"share",label:"Доля стока",n:1,f:fmtP},{key:"rev",label:"Выручка, млн",n:1,f:fmtM},{key:"marP",label:"Маржа, %",n:1,f:fmtP},{key:"cov",label:"Покрытие, мес",n:1,render:covCell},{key:"tgt",label:"Норма, мес",n:1,f:fmt1},{key:"dead",label:"Dead, млн",n:1,f:fmtM},{key:"ex",label:"Сверх нормы, млн",n:1,f:fmtM},{key:"exP",label:"Доля сверх нормы",n:1,f:fmtP}];
  const foot=rs=>({n:sum(rs,x=>x.n),st:sum(rs,x=>x.st),share:1,rev:sum(rs,x=>x.rev),dead:sum(rs,x=>x.dead),ex:sum(rs,x=>x.ex)});
  const mr=groupRows("m",MATRIX); table("matrixTable",gcols("Матрица"),mr,{foot:foot(mr)});
  const br=groupRows("kb",[...S.params.keyBrands,"Others"]); table("brandTable",gcols("Бренд").filter(c=>c.key!=="tgt"),br,{sort:"st",foot:foot(br)});
  const cats=[...new Set(M.L.map(a=>a.c))]; const cr=groupRows("c",cats); table("catTable",gcols("Категория").filter(c=>c.key!=="tgt"),cr,{sort:"st",foot:foot(cr)});
  // heat: coverage
  const box=$("heatTable"); box.textContent=""; const t=el("table"); const th=el("tr"); th.append(el("th",{class:"l",text:"Бренд \\ матрица"})); MATRIX.forEach(m=>th.append(el("th",{class:"n",text:m}))); th.append(el("th",{class:"n",text:"Итого"})); const hd=el("thead"); hd.append(th); t.append(hd);
  const tb=el("tbody"); const p=PAL();
  for(const b of [...S.params.keyBrands,"Others"]){ const tr=el("tr"); tr.append(el("td",{class:"l",text:b}));
    for(const m of [...MATRIX,"*"]){ const r=M.L.filter(a=>a.kb===b&&(m==="*"||a.m===m)); const st=sum(r,a=>a.st),cg=sum(r,a=>a.cogs); const cov=cg>0?st/(cg*M.m30):null; const tgt=m==="*"?1.5:((S.params.norms[m]||[1])[0]||1);
      const td=el("td",{class:"n h"}); if(st===0){td.textContent="";} else if(cov==null){td.textContent="∞";td.style.background=css("--bad-soft");td.style.color=p.bad;td.title="Есть сток, нет продаж";} else {td.textContent=fmt1(cov); const x=cov/tgt; td.style.background= x<=1?css("--ok-soft"): x<=2?css("--warn-soft"):css("--bad-soft"); td.style.color= x<=1?p.ok:x<=2?p.warn:p.bad;}
      tr.append(td);} tb.append(tr);} t.append(tb); box.append(t);
  heatStock();
}
function heatStock(){
  const box=$("heatStock"); box.textContent=""; const t=el("table");
  const rowsK=[...S.params.keyBrands,"Others"], cols=[...MATRIX,"*"];
  const v=(b,m)=>sum(M.L.filter(a=>(b==="*"||a.kb===b)&&(m==="*"||a.m===m)),a=>a.st);
  const tot=v("*","*")||1;
  let mx=0; rowsK.forEach(b=>MATRIX.forEach(m=>{mx=Math.max(mx,v(b,m));}));
  const hd=el("thead"), th=el("tr"); th.append(el("th",{class:"l",text:"Бренд \\ матрица"})); MATRIX.forEach(m=>th.append(el("th",{class:"n",text:m}))); th.append(el("th",{class:"n",text:"Итого"}),el("th",{class:"n",text:"Доля"})); hd.append(th); t.append(hd);
  const tb=el("tbody");
  for(const b of rowsK){ const tr=el("tr"); tr.append(el("td",{class:"l",text:b}));
    for(const m of cols){ const x=v(b,m); const td=el("td",{class:"n h",text:x?fmtM(x):""});
      if(x){ td.title=b+" · "+(m==="*"?"все матрицы":m)+": "+fmtM(x)+" млн, "+fmtP(x/tot)+" стока"; if(m!=="*"){ const k=Math.round(8+72*Math.sqrt(x/(mx||1))); td.style.background="color-mix(in srgb, var(--accent) "+k+"%, var(--panel))"; } else td.style.fontWeight="600"; }
      tr.append(td);}
    tr.append(el("td",{class:"n",text:fmtP(v(b,"*")/tot)})); tb.append(tr);}
  t.append(tb);
  const tf=el("tfoot"), fr=el("tr"); fr.append(el("td",{class:"l",text:"Итого"})); cols.forEach(m=>fr.append(el("td",{class:"n",text:fmtM(v("*",m))}))); fr.append(el("td",{class:"n",text:"100,0%"})); tf.append(fr);
  const sr=el("tr"); sr.append(el("td",{class:"l",text:"Доля"})); cols.forEach(m=>sr.append(el("td",{class:"n",text:fmtP(v("*",m)/tot)}))); sr.append(el("td",{class:"n",text:""})); tf.append(sr); t.append(tf);
  box.append(t);
}

function renderCoverage(){
  const L=M.L.filter(a=>a.st>0), p=PAL();
  const bins=[["0–1",0,1],["1–2",1,2],["2–3",2,3],["3–6",3,6],["6–12",6,12],["12+",12,1e9],["без продаж",null,null]];
  const bv=bins.map(([l,a,b])=>({l,v:sum(L.filter(x=>a==null?x.cov==null:(x.cov!=null&&x.cov>=a&&x.cov<b)),x=>x.st)}));
  tiles("kpiCov",[
    {lab:"Покрытие стока",val:fmt1(M.T.cov),u:"мес",sub:fmtI(M.T.doh)+" дней"},
    {lab:"Сток с покрытием > 6 мес",val:fmtM(sum(L.filter(a=>a.cov!=null&&a.cov>6),a=>a.st)),u:"млн",cls:"warn"},
    {lab:"Сток без продаж",val:fmtM(bv[6].v),u:"млн",cls:"bad"},
    {lab:"A-товары в дефиците/OOS",val:fmtI(M.L.filter(a=>a.abc==="A"&&(a.status==="Дефицит"||a.status==="OOS")).length),u:"SKU",cls:"attn"}
  ]);
  chart("chCovHist",{type:"bar",data:{labels:bv.map(x=>x.l+(x.l.includes("без")?"":" мес")),datasets:[{data:bv.map(x=>mln(x.v)),backgroundColor:bv.map((x,i)=>i<2?p.ok:i<4?p.warn:p.bad),borderRadius:4}]},options:{plugins:{legend:{display:false}},scales:{y:{ticks:mlnTick},x:{grid:{display:false}}}}});
  const abc=["A","B","C","—"]; const sts=["Норма","Излишек","Дефицит","NEW без продаж","Dead stock"];
  chart("chAbc",{type:"bar",data:{labels:abc.map(x=>x==="—"?"Нет продаж":x),datasets:sts.map(s=>({label:s,data:abc.map(c=>mln(sum(M.L.filter(a=>a.abc===c&&a.status===s),a=>a.st))),backgroundColor:statusColor(s),borderRadius:2}))},options:{scales:{x:{stacked:true,grid:{display:false}},y:{stacked:true,ticks:mlnTick}}}});
  const draw=()=>{const q=$("skuSearch").value.trim().toLowerCase(); let r=M.L; if(skuChip!=="all") r=r.filter(a=>a.status===skuChip); if(q) r=r.filter(a=>a.n.toLowerCase().includes(q)||a.k.toLowerCase().includes(q));
    table("skuTable",[C.name,C.ess,C.brand,C.m,C.status,C.abc,C.q,C.st,C.sq,C.rev,C.marP,C.cov,C.tgt,C.turn,C.ex,C.need],r,{sort:"st",limit:400,foot:{q:sum(r,a=>a.q),st:sum(r,a=>a.st),sq:sum(r,a=>a.sq),rev:sum(r,a=>a.rev),excess:sum(r,a=>a.excess),need:sum(r,a=>a.need)}});};
  chipRow("skuChips",[["all","Все"],...STATUS.map(s=>[s,s])],()=>skuChip,v=>skuChip=v,draw);
  $("skuSearch").oninput=draw; draw();
}

function renderBranches(){
  const B=M.branches, p=PAL();
  const top=B.slice(0,20);
  chart("chBranchCov",{type:"bar",data:{labels:top.map(b=>b.name),datasets:[{data:top.map(b=>b.cov==null?0:+b.cov.toFixed(2)),backgroundColor:top.map(b=>b.cov==null||b.cov>4.5?p.bad:b.cov>2.25?p.warn:p.ok),borderRadius:3}]},options:{indexAxis:"y",plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>top[c.dataIndex].cov==null?"нет продаж":fmt1(top[c.dataIndex].cov)+" мес · сток "+fmtM(top[c.dataIndex].st)+" млн"}}},scales:{y:{grid:{display:false},ticks:catTick()}}}});
  const td=B.slice().sort((a,b)=>b.dead-a.dead).slice(0,20);
  chart("chBranchDead",{type:"bar",data:{labels:td.map(b=>b.name),datasets:[{label:"Dead stock",data:td.map(b=>mln(b.dead)),backgroundColor:p.bad,borderRadius:3},{label:"Остальной сток",data:td.map(b=>mln(b.st-b.dead)),backgroundColor:p.soft,borderColor:p.muted,borderWidth:1,borderRadius:3}]},options:{indexAxis:"y",scales:{x:{stacked:true,ticks:mlnTick},y:{stacked:true,grid:{display:false},ticks:catTick()}}}});
  table("branchTable",[{key:"name",label:"Филиал",l:1},{key:"ch",label:"Канал",l:1},{key:"rows",label:"Позиций",n:1,f:fmtI},{key:"q",label:"Остаток, шт",n:1,f:fmtI},{key:"st",label:"Сток, млн",n:1,f:fmtM},{key:"dead",label:"Dead, млн",n:1,f:fmtM},{key:"deadP",label:"Dead, %",n:1,f:fmtP},{key:"old",label:"EOL+OLD, млн",n:1,f:fmtM},{key:"sq",label:"Продано, шт",n:1,f:fmtI},{key:"rev",label:"Выручка, млн",n:1,f:fmtM},{key:"marP",label:"Маржа, %",n:1,f:fmtP},{key:"cov",label:"Покрытие, мес",n:1,render:(td,v)=>{td.textContent=v==null?"нет продаж":fmt1(v);td.style.color=v==null||v>4.5?css("--bad"):v>2.25?css("--warn"):css("--ok");}}],B,{sort:"st",foot:{rows:sum(B,b=>b.rows),q:sum(B,b=>b.q),st:sum(B,b=>b.st),dead:sum(B,b=>b.dead),old:sum(B,b=>b.old),sq:sum(B,b=>b.sq),rev:sum(B,b=>b.rev)}});
}

function renderSales(){
  const T=M.T, p=PAL();
  tiles("kpiSales",[
    {lab:"Выручка",val:fmtM(T.rev),u:"млн",sub:fmtI(T.sq)+" шт · средний чек "+fmtM(T.rev/(T.sq||1))+" млн"},
    {lab:"Себестоимость продаж",val:fmtM(T.cogs),u:"млн",sub:"из ERP: "+fmtP(T.srcErp)+" выручки"},
    {lab:"Валовая маржа",val:fmtM(T.mar),u:"млн",sub:fmtP(T.marP)+" от выручки",cls:(T.marP!=null&&T.marP<0.05)?"warn":""},
    {lab:"GMROI, годовой",val:T.gmroi==null?"—":T.gmroi.toFixed(2),sub:"маржа в год на 1 сум стока"},
    {lab:"Продано в убыток",val:fmtI(T.lossN),u:"SKU",sub:fmtM(-T.loss)+" млн потерь",cls:T.lossN?"bad":""}
  ]);
  const d=M.byDay;
  chart("chDays",{type:"bar",data:{labels:d.map(x=>fmtD(x.k).slice(0,5)),datasets:[{type:"bar",label:"Выручка",data:d.map(x=>mln(x.rev)),backgroundColor:p.ink,yAxisID:"y",borderRadius:3},{type:"bar",label:"Маржа",data:d.map(x=>mln(x.mar)),backgroundColor:p.accent,yAxisID:"y",borderRadius:3},{type:"line",label:"Маржа, %",data:d.map(x=>x.marP==null?null:+(x.marP*100).toFixed(1)),borderColor:p.warn,yAxisID:"y1",tension:.25,pointRadius:3}]},options:{scales:{y:{ticks:mlnTick},y1:{position:"right",grid:{display:false},ticks:{callback:v=>v+"%"}}}}});
  const pay=M.byPay.slice(0,9);
  chart("chPay",{type:"bar",data:{labels:pay.map(x=>x.k),datasets:[{type:"bar",label:"Выручка, млн",data:pay.map(x=>mln(x.rev)),backgroundColor:pay.map(x=>x.k.endsWith("nasiya")?p.info:p.muted),yAxisID:"y",borderRadius:3},{type:"line",label:"Маржа, %",data:pay.map(x=>x.marP==null?null:+(x.marP*100).toFixed(1)),borderColor:p.bad,backgroundColor:p.bad,showLine:false,pointRadius:5,yAxisID:"y1"}]},options:{scales:{y:{ticks:mlnTick},y1:{position:"right",beginAtZero:true,grid:{display:false},ticks:{callback:v=>v+"%"}},x:{ticks:{autoSkip:false,maxRotation:45,callback:function(v){return trunc(this.getLabelForValue(v),narrow()?10:18);}}}}}});
  const sc=lab=>[{key:"k",label:lab,l:1},{key:"q",label:"Шт",n:1,f:fmtI},{key:"rev",label:"Выручка, млн",n:1,f:fmtM},{key:"share",label:"Доля",n:1,f:fmtP,get:r=>r.rev/(T.rev||1)},{key:"mar",label:"Маржа, млн",n:1,f:fmtM},{key:"marP",label:"Маржа, %",n:1,f:fmtP},{key:"avg",label:"Ср. чек, млн",n:1,f:fmtM}];
  const ft=rs=>({q:sum(rs,x=>x.q),rev:sum(rs,x=>x.rev),share:1,mar:sum(rs,x=>x.mar)});
  table("tChannel",sc("Канал"),M.byCh,{foot:ft(M.byCh)}); table("tSource",sc("Источник заказа"),M.bySrc,{foot:ft(M.bySrc)});
  table("tPay",sc("Способ оплаты"),M.byPay,{foot:ft(M.byPay)}); table("tPtype",sc("Тип поставщика"),M.byPt,{foot:ft(M.byPt)});
}

function renderActions(){
  const L=M.L;
  table("actDead",[C.name,C.brand,C.m,C.q,C.st,C.carry,{key:"act",label:"Решение",l:1,get:a=>a.m==="Active"||a.m==="NEW"?"Промо/бандл, перемещение в онлайн":"Уценка, возврат поставщику"}],L.filter(a=>a.status==="Dead stock"),{sort:"st",limit:25,empty:"Неликвида нет"});
  table("actExcess",[C.name,C.brand,C.m,C.cov,C.tgt,C.st,C.ex,C.carry],L.filter(a=>a.status==="Излишек"),{sort:"excess",limit:25,empty:"Излишков нет"});
  table("actNeed",[C.name,C.brand,C.m,C.status,C.abc,C.sq,C.q,C.cov,C.need],L.filter(a=>(a.status==="Дефицит"||a.status==="OOS")&&!(a.m==="EOL_Clearance"||a.m==="OLD")),{sort:"need",limit:25,empty:"Дефицитных позиций нет"});
  table("actLoss",[C.name,C.brand,C.m,C.sq,C.rev,C.cogs,C.mar,C.marP],L.filter(a=>a.rev>0&&a.mar<0),{sort:"mar",dir:1,limit:25,empty:"Продаж ниже себестоимости нет"});
  table("actPpv",[C.name,C.brand,C.q,C.ucMin,C.ucMax,C.spread,C.ppv],L.filter(a=>a.spread>0.05),{sort:"ppv",limit:25,empty:"Разброса себестоимости нет"});
}

/* ================= settings ================= */
function renderParams(){
  const P=S.params, box=$("paramsBox"); box.textContent="";
  const ta=(id,lab,val,hint)=>{const l=el("label",{for:id});l.append(lab);const t=el("textarea",{id,spellcheck:"false"});t.value=val;l.append(t);if(hint)l.append(el("span",{class:"small",text:hint}));return l;};
  box.append(ta("pOnline","Онлайн-филиалы (по одному в строке; остальные — офлайн)",P.online.join("\n")));
  box.append(ta("pStatus","Статусы заказа, которые считаются продажей",P.statuses.join("\n"),"Статусы, найденные в последней выгрузке: "+(S.data?S.data.lists.st.join(", "):"—")));
  box.append(ta("pBrands","Ключевые бренды (остальные — Others)",P.keyBrands.join("\n")));
  const n=el("div",{class:"card"}); n.append(el("h3",{text:"Нормативы покрытия, мес"}),el("p",{class:"note",text:"Выше «норма × порог» — излишек, ниже минимума — дефицит"}));
  const t=el("table",{class:"norms"}); const hr=el("tr"); ["Матрица","Норма","Минимум"].forEach(x=>hr.append(el("th",{class:x==="Матрица"?"l":"n",text:x}))); t.append(hr);
  MATRIX.forEach((m,i)=>{const r=el("tr");r.append(el("td",{class:"l",text:m}));[0,1].forEach(j=>{const td=el("td",{class:"n"});const inp=el("input",{type:"number",step:"0.05",min:"0",inputmode:"decimal",id:"pN"+i+j,"aria-label":m+" — "+(j?"минимум":"норма")});inp.value=(P.norms[m]||[1,0])[j];td.append(inp);r.append(td);});t.append(r);});
  n.append(t); box.append(n);
  const g=el("div",{class:"card"}); g.append(el("h3",{text:"Финансовые параметры"}));
  const num=(id,lab,v,step)=>{const l=el("label",{for:id});l.append(lab);const i=el("input",{type:"number",id,step,inputmode:"decimal"});i.value=v;l.append(i);return l;};
  g.append(num("pK","Порог излишка (× нормы)",P.K,"0.1"),num("pRate","Стоимость капитала, % годовых",+(P.rate*100).toFixed(2),"0.5"),el("p",{class:"small muted",text:"Ставка — допущение, уточните у казначейства."}));
  box.append(g);
}
function readParams(){
  const lines=id=>$(id).value.split("\n").map(s=>s.trim()).filter(Boolean);
  const norms={}; MATRIX.forEach((m,i)=>{norms[m]=[Math.max(0,Number($("pN"+i+"0").value)||0),Math.max(0,Number($("pN"+i+"1").value)||0)];});
  return {online:lines("pOnline"),statuses:lines("pStatus"),keyBrands:lines("pBrands"),norms,K:Number($("pK").value)||1.5,rate:Math.max(0,(Number($("pRate").value)||0)/100),abcA:S.params.abcA,abcB:S.params.abcB};
}
function renderHistory(){
  const h=S.history.slice().sort((a,b)=>a.date<b.date?1:-1);
  table("histTable",[{key:"date",label:"Сток на",l:1,f:fmtD},{key:"label",label:"Период продаж",l:1},{key:"st",label:"Сток, млн",n:1,f:fmtM},{key:"cogs",label:"COGS за период, млн",n:1,f:fmtM},{key:"days",label:"Дней",n:1,f:fmtI},{key:"cov",label:"Покрытие, мес",n:1,f:fmt1},{key:"dead",label:"Dead, млн",n:1,f:fmtM},{key:"marP",label:"Маржа, %",n:1,f:fmtP},{key:"src",label:"Источник",l:1}],h,{empty:"История появится после первой загрузки"});
  table("qcTable",[{key:0,label:"Проверка",l:1},{key:1,label:"Значение",n:1,f:v=>typeof v==="number"?fmtI(v):v},{key:2,label:"",l:1,render:(td,v)=>{ if(v) td.append(el("span",{class:"pill "+(v==="ok"?"s-Норма":"s-Излишек"),text:v==="ok"?"ОК":"Проверить"})); }}],M?M.QC:[],{empty:"Проверки появятся после загрузки данных"});
}

/* ================= filters & orchestration ================= */
function fillFilters(){
  if(!S.data) return;
  const cats=[...new Set(S.data.skus.map(s=>s[3]))].filter(Boolean).sort((a,b)=>a.localeCompare(b,"ru"));
  const fc=$("fCat"), cur=fc.value; fc.length=1; cats.forEach(c=>fc.append(el("option",{value:c,text:c}))); fc.value=cats.includes(cur)?cur:"";
  const fb=$("fBrand"), cb=fb.value, bl=[...S.params.keyBrands,"Others"]; fb.length=1; bl.forEach(b=>fb.append(el("option",{value:b,text:b}))); fb.value=bl.includes(cb)?cb:"";
  S.filt={cat:fc.value,brand:fb.value,chan:$("fChan").value};
}
function renderAll(){
  if(!S.data){ M=null; return; }
  M=window.BM.compute();
  const md=S.data.meta, st=$("stamp"); st.textContent="";
  if(S.demo) st.append(el("span",{class:"demo",text:"ДЕМО"}));
  const upd=md.uploadedAt&&!isNaN(new Date(md.uploadedAt)) ? " · обновлено "+new Date(md.uploadedAt).toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : "";
  st.append("Сток на "+fmtD(md.stockDate)+" · продажи "+fmtD(M.dFrom)+"–"+fmtD(M.dTo)+" ("+M.days+" дн.)"+upd);
  const f=[S.filt.cat,S.filt.brand,S.filt.chan==="Online"?"онлайн-склады":S.filt.chan==="Offline"?"офлайн-филиалы":""].filter(Boolean);
  $("filterNote").textContent=f.length?"Фильтр: "+f.join(" · "):"";
  renderView(S.tab); renderHistory();
}
const VIEWS={overview:renderOverview,aging:renderAging,matrix:renderMatrix,coverage:renderCoverage,branches:renderBranches,sales:renderSales,actions:renderActions,settings:()=>{}};
function renderView(v){ if(!M||!VIEWS[v]) return; try{ VIEWS[v](); }catch(e){ console.error("Ошибка отрисовки «"+v+"»:",e); } }
function selectTab(v,opts={}){
  if(!VIEWS[v]) v="overview";
  S.tab=v;
  [...$("tabs").children].forEach(x=>{ const on=x.dataset.v===v; x.setAttribute("aria-selected",String(on)); x.tabIndex=on?0:-1; if(on&&opts.scroll!==false) centerTab(x); });
  document.querySelectorAll(".view").forEach(s=>s.classList.toggle("on",s.id==="v-"+v));
  $("filters").hidden=v==="settings";
  if(v==="settings") window.BM.parse.loadXLSX().catch(()=>{}); // подгружаем модуль Excel заранее, пока пользователь выбирает файлы
  renderView(v);
  try{ localStorage.setItem("bm-tab",v); }catch(_){}
}
$("tabs").addEventListener("click",e=>{const b=e.target.closest("button[data-v]");if(b) selectTab(b.dataset.v);});
$("tabs").addEventListener("keydown",e=>{ // стрелки ←/→ по вкладкам
  if(e.key!=="ArrowRight"&&e.key!=="ArrowLeft") return;
  const bs=[...$("tabs").children], i=bs.findIndex(b=>b.dataset.v===S.tab), j=(i+(e.key==="ArrowRight"?1:-1)+bs.length)%bs.length;
  e.preventDefault(); selectTab(bs[j].dataset.v); bs[j].focus();
});
["fCat","fBrand","fChan"].forEach(id=>$(id).addEventListener("change",()=>{S.filt={cat:$("fCat").value,brand:$("fBrand").value,chan:$("fChan").value};renderAll();}));
/* мобильная шапка: высота «сворачиваемой» части и подсказки, что вкладки прокручиваются */
const hdr=document.querySelector("header.top"), nav=$("tabs");
function centerTab(b){ const n=nav.getBoundingClientRect(), r=b.getBoundingClientRect(); nav.scrollLeft+= (r.left+r.width/2)-(n.left+n.width/2); }
function tabsEdges(){ nav.classList.toggle("more",nav.scrollLeft+nav.clientWidth<nav.scrollWidth-4); nav.classList.toggle("less",nav.scrollLeft>4); }
function fitHeader(){ const v=narrow()?Math.max(0,Math.round(nav.getBoundingClientRect().top-hdr.getBoundingClientRect().top-6)):0; document.documentElement.style.setProperty("--hdr-collapse",v+"px"); tabsEdges(); }
nav.addEventListener("scroll",tabsEdges,{passive:true});
if(window.ResizeObserver) new ResizeObserver(fitHeader).observe(hdr); else window.addEventListener("resize",fitHeader);
fitHeader();
/* Chart.js сам подстраивает размер графиков; полный перерендер нужен только при смене темы */
const mq=window.matchMedia("(prefers-color-scheme: dark)");
if(mq.addEventListener) mq.addEventListener("change",()=>renderView(S.tab));
new MutationObserver(()=>renderView(S.tab)).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});

window.BM.UI={renderAll,renderParams,readParams,renderHistory,fillFilters,selectTab,table,tiles};
})();
