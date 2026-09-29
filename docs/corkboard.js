// Investigation corkboard: a Miro-like 2D canvas (pan, zoom, drag) with pinned paper cards and yarn strings.
// Model coordinates keep the board units used by the former 3D board (y up, 1 unit = U px),
// so layouts saved earlier stay where people left them.
export const U=64;
export const STATUS={planned:'Запланирована',doing:'В работе',blocked:'Заблокирована',approval:'На согласовании',done:'Выполнена'};
export const LINKS={
  blocks:{label:'блокирует',color:'#c0262d'},
  depends:{label:'зависит от',color:'#2c5d8a'},
  approval:{label:'согласование',color:'#c7820e'},
  related:{label:'связано',color:'#5f5247'},
  visual:{label:'',color:'#b0232b'}
};
const MIN_Z=.2,MAX_Z=2.4;
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const initials=name=>String(name||'').trim().split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0].toUpperCase()).join('')||'—';
const tilt=id=>{let h=7;for(const ch of String(id))h=(h*31+ch.charCodeAt(0))%100003;return(h%240)/100-1.2};
const shortDate=d=>{if(!d)return'';const x=new Date(d+'T12:00:00');return isNaN(x)?d:x.toLocaleDateString('ru-RU',{day:'numeric',month:'short'})};
const isMobile=()=>matchMedia('(max-width: 760px)').matches;

function taskHTML(c){
  const st=c.status||'planned',due=c.dueDate?`<span class="ib-due${c.overdue?' late':''}">${c.overdue?'просрочено · ':''}до ${esc(shortDate(c.dueDate))}</span>`:'<span class="ib-due none">без срока</span>';
  return `<i class="ib-pin"></i>${c.kicker?`<div class="ib-kicker">${esc(c.kicker)}</div>`:''}<h3 class="ib-title">${esc(c.title||'Без названия')}</h3>${c.body?`<p class="ib-body">${esc(c.body)}</p>`:'<span class="ib-body-gap"></span>'}<div class="ib-meta"><span class="ib-chip st-${st}">${esc(STATUS[st]||st)}</span>${c.priority==='high'&&st!=='done'?'<span class="ib-chip hot">срочно</span>':''}${due}</div><div class="ib-who"><b>${esc(initials(c.assignee))}</b><span>${esc(c.assignee||'Без ответственного')}</span></div>`;
}
function noteHTML(c){
  if(c.kind==='photo')return `<i class="ib-tape"></i><div class="ib-photo-img">${c.image?`<img src="${esc(c.image)}" alt="" draggable="false">`:'<span>фото</span>'}</div><h3 class="ib-title">${esc(c.title)}</h3>`;
  return `<i class="ib-tape"></i>${c.kicker?`<div class="ib-kicker">${esc(c.kicker)}</div>`:''}<h3 class="ib-title">${esc(c.title)}</h3>${c.body?`<p class="ib-body">${esc(c.body)}</p>`:''}`;
}
function personHTML(c){
  const m=clamp(c.meter??0,0,1),lvl=m>.72?'high':m>.45?'mid':'low';
  return `<i class="ib-pin"></i><div class="ib-mug">${esc(c.initials||initials(c.title))}</div><div class="ib-person-text"><div class="ib-kicker">Досье · исполнитель</div><h3 class="ib-title">${esc(c.title)}</h3><p class="ib-body">${esc(c.body)}</p></div><div class="ib-load ${lvl}"><span style="width:${Math.max(4,m*100)}%"></span></div>`;
}
function cardHTML(c){
  switch(c.entityType){
    case 'task':return taskHTML(c);
    case 'note':return noteHTML(c);
    case 'person':return personHTML(c);
    case 'projectHeader':return `<i class="ib-pin"></i><div class="ib-kicker">Дело</div><h3 class="ib-title">${esc(c.title)}</h3><p class="ib-body">${esc(c.body)}</p>`;
    case 'stageHeader':return `<h3 class="ib-title">${esc(c.title)}</h3>`;
    case 'zone':return `<div class="ib-zone-tab"${c.color?` style="--zone:${esc(c.color)}"`:''}><b>${esc(c.title)}</b><span>${esc(c.body)}</span></div>`;
    default:return `<h3 class="ib-title">${esc(c.title)}</h3>`;
  }
}
function cardClass(c){
  const t=c.entityType;
  if(t==='task')return `ib-card ib-task st-${c.status||'planned'}${c.overdue?' is-late':''}${c.compact?' is-compact':''}`;
  if(t==='note')return `ib-card ib-note kind-${c.kind==='photo'?'photo':'sticky'}`;
  if(t==='person')return 'ib-card ib-person';
  if(t==='projectHeader')return 'ib-card ib-case';
  if(t==='stageHeader')return 'ib-card ib-stage';
  if(t==='zone')return 'ib-zone';
  return 'ib-card';
}

export class CorkBoard{
  constructor(host,model,cb={},opts={}){
    this.host=host;this.cb=cb;this.opts=opts;this.view={x:0,y:0,z:1};this.mode='select';this.connectFrom=null;this.selected=null;this.selectedLink=null;this.pointers=new Map;this.gesture=null;this.anim=0;
    host.classList.add('ib-host');
    host.innerHTML=`<div class="ib-viewport" tabindex="0" aria-label="Доска расследования"><div class="ib-world"><div class="ib-zones"></div><svg class="ib-strings" aria-hidden="true"></svg><div class="ib-tags"></div><div class="ib-cards"></div><svg class="ib-strings ib-strings-top" aria-hidden="true"></svg><div class="ib-tags ib-tags-top"></div></div><div class="ib-vignette"></div><div class="ib-hint" hidden></div><div class="ib-zoombar"><button data-z="-1" title="Отдалить (−)">−</button><button data-z="fit" class="ib-zoom-val" title="Показать всё (0)">100%</button><button data-z="1" title="Приблизить (+)">+</button></div></div>`;
    this.vp=host.querySelector('.ib-viewport');this.world=host.querySelector('.ib-world');this.zonesEl=host.querySelector('.ib-zones');this.cardsEl=host.querySelector('.ib-cards');this.svg=host.querySelector('.ib-strings');this.svgTop=host.querySelector('.ib-strings-top');this.tagsEl=host.querySelector('.ib-tags');this.tagsTopEl=host.querySelector('.ib-tags-top');this.hintEl=host.querySelector('.ib-hint');this.zoomVal=host.querySelector('.ib-zoom-val');
    host.querySelectorAll('[data-z]').forEach(b=>b.onclick=()=>b.dataset.z==='fit'?this.fit():this.zoomBy(b.dataset.z>0?1.25:.8));
    this.bind();this.setData(model);this.apply();
  }
  get model(){return this._model}
  set model(m){this._model=m}
  setData(model){this._model=model;this.rebuild()}
  rebuild(){
    const m=this._model||{cards:[],links:[]};
    this.cards=new Map(m.cards.map(c=>[c.id,{...c}]));this.links=(m.links||[]).filter(l=>this.cards.has(l.a)&&this.cards.has(l.b)&&l.a!==l.b);
    const zones=[],cards=[];
    for(const c of this.cards.values()){
      const w=c.w*U,h=c.h*U,style=`left:${c.x*U-w/2}px;top:${-c.y*U-h/2}px;width:${w}px;height:${h}px;--tilt:${c.fixed||c.entityType==='zone'?0:(c.rot?c.rot*57.3:tilt(c.id)).toFixed(2)}deg`;
      const html=`<div class="${cardClass(c)}${c.fixed?' is-fixed':''}" data-id="${esc(c.id)}" style="${style}">${cardHTML(c)}</div>`;
      (c.entityType==='zone'?zones:cards).push(html);
    }
    this.zonesEl.innerHTML=zones.join('');this.cardsEl.innerHTML=cards.join('');
    this.els=new Map([...this.world.querySelectorAll('[data-id]')].map(el=>[el.dataset.id,el]));
    if(this.selected&&!this.cards.has(this.selected))this.selected=null;
    if(this.selectedLink&&!this.links.some(l=>this.sameLink(l,this.selectedLink)))this.selectedLink=null;
    this.drawLinks();this.paintSelection();
  }
  sameLink(a,b){return a===b||(!!a&&!!b&&(a.id&&b.id?a.id===b.id:a.a===b.a&&a.b===b.b&&a.type===b.type))}
  anchor(id){const c=this.cards.get(id);return{x:c.x*U,y:-c.y*U-c.h*U/2+(c.entityType==='stageHeader'?c.h*U/2:14)}}
  curve(a,b){const d=Math.hypot(b.x-a.x,b.y-a.y),sag=Math.min(110,d*.14)+10,c={x:(a.x+b.x)/2,y:(a.y+b.y)/2+sag};return{d:`M${a.x.toFixed(1)} ${a.y.toFixed(1)}Q${c.x.toFixed(1)} ${c.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`,mid:{x:.25*a.x+.5*c.x+.25*b.x,y:.25*a.y+.5*c.y+.25*b.y},ang:Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI}}
  drawLinks(){
    const focus=this.selected,under=[],over=[],tags=[],tagsTop=[];
    this.links.forEach((l,i)=>{
      const kind=LINKS[l.type]?l.type:'related',spec=LINKS[kind],{d,mid,ang}=this.curve(this.anchor(l.a),this.anchor(l.b));
      const hot=(focus&&(l.a===focus||l.b===focus))||this.sameLink(l,this.selectedLink),dim=(focus||this.selectedLink)&&!hot;
      const yarn=`<path class="ib-yarn-shade" d="${d}"/><path class="ib-yarn" d="${d}" stroke="${spec.color}"/>`;
      under.push(`<g class="ib-link k-${kind}${l.risk?' is-risk':''}${dim?' is-dim':''}" data-link="${i}">${yarn}<path class="ib-hit" d="${d}"/></g>`);
      if(hot)over.push(`<g class="ib-link k-${kind} is-hot">${yarn}</g>`);
      if(spec.label)(hot?tagsTop:tags).push(`<button class="ib-tag k-${kind}${dim?' is-dim':''}${hot?' is-hot':''}" data-link="${i}" style="left:${mid.x.toFixed(1)}px;top:${mid.y.toFixed(1)}px;--c:${spec.color}"><svg viewBox="0 0 10 10" style="transform:rotate(${ang.toFixed(1)}deg)"><path d="M1 1.5 9 5 1 8.5z"/></svg>${esc(spec.label)}</button>`);
    });
    this.svg.innerHTML=under.join('');this.svgTop.innerHTML=over.join('');this.tagsEl.innerHTML=tags.join('');this.tagsTopEl.innerHTML=tagsTop.join('');
    this.sizeSvg();
  }
  sizeSvg(){
    let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
    for(const c of this.cards.values()){const w=c.w*U/2,h=c.h*U/2;x1=Math.min(x1,c.x*U-w);x2=Math.max(x2,c.x*U+w);y1=Math.min(y1,-c.y*U-h);y2=Math.max(y2,-c.y*U+h)}
    if(!isFinite(x1)){x1=y1=0;x2=y2=1}
    x1-=200;y1-=200;x2+=200;y2+=400;
    for(const s of [this.svg,this.svgTop]){s.setAttribute('viewBox',`${x1} ${y1} ${x2-x1} ${y2-y1}`);Object.assign(s.style,{left:x1+'px',top:y1+'px',width:(x2-x1)+'px',height:(y2-y1)+'px'})}
  }
  paintSelection(){
    const focus=this.selected,linked=new Set;
    if(focus)for(const l of this.links)if(l.a===focus||l.b===focus){linked.add(l.a);linked.add(l.b)}
    if(this.selectedLink){linked.add(this.selectedLink.a);linked.add(this.selectedLink.b)}
    const dimming=linked.size>0;
    for(const[id,el]of this.els){el.classList.toggle('is-selected',id===focus);el.classList.toggle('is-source',id===this.connectFrom);el.classList.toggle('is-linked',linked.has(id)&&id!==focus);el.classList.toggle('is-dim',dimming&&!linked.has(id)&&id!==focus&&!el.classList.contains('ib-zone'))}
  }
  select(id,notify=false){this.selected=id&&this.cards.has(id)?id:null;this.selectedLink=null;this.drawLinks();this.paintSelection();if(notify){this.cb.onSelect?.(this.selected);this.cb.onLink?.(null)}}
  selectLink(l){this.selectedLink=l;this.selected=null;this.drawLinks();this.paintSelection();this.cb.onSelect?.(null);this.cb.onLink?.(l)}
  setMode(m){this.mode=m;this.connectFrom=null;this.vp.classList.toggle('is-connecting',m==='connect');this.hint(m==='connect'?'Нажмите на первую карточку — от неё протянется нить':'');this.clearPreview();this.paintSelection();this.cb.onMode?.(m)}
  hint(text){this.hintEl.hidden=!text;this.hintEl.textContent=text||''}
  clearPreview(){this.svgTop.querySelector('.ib-preview')?.remove()}
  preview(p){if(!this.connectFrom)return;const a=this.anchor(this.connectFrom),{d}=this.curve(a,p);let el=this.svgTop.querySelector('.ib-preview');if(!el){el=document.createElementNS('http://www.w3.org/2000/svg','path');el.setAttribute('class','ib-preview');this.svgTop.appendChild(el)}el.setAttribute('d',d)}
  // --- view ---
  toWorld(e){const r=this.vp.getBoundingClientRect();return{x:(e.clientX-r.left-this.view.x)/this.view.z,y:(e.clientY-r.top-this.view.y)/this.view.z}}
  apply(){const{x,y,z}=this.view;this.world.style.transform=`translate(${x}px,${y}px) scale(${z})`;this.vp.style.backgroundPosition=`${x}px ${y}px,${x*.6}px ${y*.6}px`;this.vp.classList.toggle('is-far',z<.72);this.vp.classList.toggle('is-near',z>1.35);this.zoomVal.textContent=Math.round(z*100)+'%'}
  zoomAt(z,sx,sy){z=clamp(z,MIN_Z,MAX_Z);const v=this.view;v.x=sx-(sx-v.x)*z/v.z;v.y=sy-(sy-v.y)*z/v.z;v.z=z;this.apply()}
  zoomBy(f){const r=this.vp.getBoundingClientRect();this.animateTo(null,f,r.width/2,r.height/2)}
  animateTo(target,factor,sx,sy){
    cancelAnimationFrame(this.anim);const from={...this.view};let to=target;
    if(!to){const z=clamp(from.z*factor,MIN_Z,MAX_Z);to={z,x:sx-(sx-from.x)*z/from.z,y:sy-(sy-from.y)*z/from.z}}
    const t0=performance.now(),dur=matchMedia('(prefers-reduced-motion: reduce)').matches?0:260;
    const step=now=>{const k=dur?Math.min(1,(now-t0)/dur):1,e=1-Math.pow(1-k,3);this.view={x:from.x+(to.x-from.x)*e,y:from.y+(to.y-from.y)*e,z:from.z+(to.z-from.z)*e};this.apply();if(k<1)this.anim=requestAnimationFrame(step)};
    this.anim=requestAnimationFrame(step);
  }
  insets(){const i={top:0,right:0,bottom:0,left:0,...(typeof this.opts.insets==='function'?this.opts.insets():this.opts.insets||{})};return i}
  frame(x1,y1,x2,y2,maxZ){const r=this.vp.getBoundingClientRect(),i=this.insets(),pad=36,w=Math.max(80,r.width-i.left-i.right-pad*2),h=Math.max(80,r.height-i.top-i.bottom-pad*2),z=clamp(Math.min(w/(x2-x1||1),h/(y2-y1||1)),MIN_Z,maxZ);return{z,x:i.left+pad+(w-(x2-x1)*z)/2-x1*z,y:i.top+pad+(h-(y2-y1)*z)/2-y1*z}}
  fit(){
    if(!this.cards.size)return this.reset();
    let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
    for(const c of this.cards.values()){const w=c.w*U/2,h=c.h*U/2;x1=Math.min(x1,c.x*U-w);x2=Math.max(x2,c.x*U+w);y1=Math.min(y1,-c.y*U-h-16);y2=Math.max(y2,-c.y*U+h)}
    const f=this.frame(x1,y1,x2,y2,1.1),minZ=isMobile()?.62:.42;
    if(f.z>=minZ)return this.animateTo(f);
    // Too big to read as a whole: start at the top-left of the board at a readable scale, like opening a case file.
    const r=this.vp.getBoundingClientRect(),i=this.insets(),z=minZ,w=(x2-x1)*z;
    this.animateTo({z,x:w<r.width-i.left-i.right?i.left+(r.width-i.left-i.right-w)/2-x1*z:i.left+16-x1*z,y:i.top+24-y1*z});
  }
  reset(){const r=this.vp.getBoundingClientRect(),i=this.insets();this.animateTo({z:isMobile()?.7:1,x:(r.width+i.left-i.right)/2,y:i.top+60})}
  focus(id){const c=this.cards.get(id);if(!c)return;const w=c.w*U/2,h=c.h*U/2;this.animateTo(this.frame(c.x*U-w*1.6,-c.y*U-h*1.4,c.x*U+w*1.6,-c.y*U+h*1.4,1.6));this.select(id,true)}
  // --- interaction ---
  moveCard(id,x,y){const c=this.cards.get(id),el=this.els.get(id);if(!c||!el)return;c.x=x;c.y=y;el.style.left=(x*U-c.w*U/2)+'px';el.style.top=(-y*U-c.h*U/2)+'px';this.drawLinks()}
  bind(){
    const vp=this.vp;
    vp.addEventListener('pointerdown',e=>{
      if(e.button>0&&e.pointerType==='mouse'&&e.button!==1)return;
      if(e.target.closest('.ib-zoombar'))return;
      vp.focus({preventScroll:true});vp.setPointerCapture?.(e.pointerId);this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(this.pointers.size===2){const[a,b]=[...this.pointers.values()];this.gesture={type:'pinch',dist:Math.hypot(a.x-b.x,a.y-b.y),z:this.view.z};return}
      const cardEl=e.target.closest('.ib-card'),linkEl=e.target.closest('[data-link]'),id=cardEl?.dataset.id||null;
      if(e.button===1){this.gesture={type:'pan',sx:e.clientX,sy:e.clientY,vx:this.view.x,vy:this.view.y,moved:true};return}
      if(id&&this.mode==='connect'){
        if(!this.connectFrom){this.connectFrom=id;this.select(id);this.hint('Теперь нажмите на вторую карточку · Esc — отмена')}
        else if(this.connectFrom!==id){const a=this.connectFrom;this.connectFrom=null;this.setMode('select');this.cb.onConnect?.(a,id)}
        return;
      }
      if(linkEl&&!id){this.selectLink(this.links[+linkEl.dataset.link]);return}
      if(id){const c=this.cards.get(id),p=this.toWorld(e);this.gesture={type:c.fixed?'tap':'drag',id,sx:e.clientX,sy:e.clientY,ox:c.x,oy:c.y,px:p.x,py:p.y,moved:false,vx:this.view.x,vy:this.view.y};return}
      this.gesture={type:'pan',sx:e.clientX,sy:e.clientY,vx:this.view.x,vy:this.view.y,moved:false};
    });
    vp.addEventListener('pointermove',e=>{
      if(this.mode==='connect'&&this.connectFrom){const p=this.toWorld(e);this.preview(p)}
      if(!this.pointers.has(e.pointerId))return;
      this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const g=this.gesture;if(!g)return;
      if(g.type==='pinch'&&this.pointers.size===2){const[a,b]=[...this.pointers.values()],r=vp.getBoundingClientRect();this.zoomAt(g.z*Math.hypot(a.x-b.x,a.y-b.y)/g.dist,(a.x+b.x)/2-r.left,(a.y+b.y)/2-r.top);return}
      const dx=e.clientX-g.sx,dy=e.clientY-g.sy;if(!g.moved&&Math.hypot(dx,dy)<4)return;
      if(!g.moved){g.moved=true;if(g.type==='drag'){this.select(g.id,true);this.els.get(g.id)?.classList.add('is-dragging')}if(g.type==='tap')Object.assign(g,{type:'pan'})}
      if(g.type==='pan'){cancelAnimationFrame(this.anim);this.view.x=g.vx+dx;this.view.y=g.vy+dy;this.apply();vp.classList.add('is-panning')}
      else if(g.type==='drag'){const p=this.toWorld(e);this.moveCard(g.id,g.ox+(p.x-g.px)/U,g.oy-(p.y-g.py)/U)}
    });
    const up=e=>{
      this.pointers.delete(e.pointerId);const g=this.gesture;if(this.pointers.size)return;this.gesture=null;vp.classList.remove('is-panning');if(!g)return;
      if(g.type==='drag'&&g.moved){this.els.get(g.id)?.classList.remove('is-dragging');const c=this.cards.get(g.id);this.cb.onMove?.(g.id,{x:c.x,y:c.y})}
      else if(g.type==='drag'){this.select(g.id,true)}
      else if(g.type==='tap'){this.select(g.id,true);this.cb.onEdit?.(g.id)}
      else if(g.type==='pan'&&!g.moved&&e.type==='pointerup'){this.select(null,true)}
    };
    vp.addEventListener('pointerup',up);vp.addEventListener('pointercancel',up);
    vp.addEventListener('dblclick',e=>{const id=e.target.closest('.ib-card')?.dataset.id;if(id&&this.mode!=='connect'&&!this.cards.get(id)?.fixed){this.cb.onEdit?.(id)}});
    vp.addEventListener('wheel',e=>{
      e.preventDefault();cancelAnimationFrame(this.anim);const r=vp.getBoundingClientRect();
      const trackpadPan=!e.ctrlKey&&e.deltaMode===0&&(Math.abs(e.deltaX)>0||Math.abs(e.deltaY)<40);
      if(trackpadPan){this.view.x-=e.deltaX;this.view.y-=e.deltaY;this.apply();return}
      const k=e.deltaMode===1?40:1;this.zoomAt(this.view.z*Math.exp(-e.deltaY*k*(e.ctrlKey?.01:.0018)),e.clientX-r.left,e.clientY-r.top);
    },{passive:false});
    vp.addEventListener('keydown',e=>{
      if(e.target.closest('input,textarea,select'))return;
      if(e.key==='Escape'&&(this.mode==='connect'||this.selected||this.selectedLink)){e.stopPropagation();if(this.mode==='connect')this.setMode('select');else this.select(null,true);return}
      if(e.key==='+'||e.key==='=')this.zoomBy(1.25);else if(e.key==='-'||e.key==='_')this.zoomBy(.8);else if(e.key==='0')this.fit();else if((e.key==='Enter'||e.key===' ')&&this.selected){e.preventDefault();this.cb.onEdit?.(this.selected)}else return;
    });
  }
  destroy(){cancelAnimationFrame(this.anim);this.host.innerHTML='';this.host.classList.remove('ib-host')}
}
