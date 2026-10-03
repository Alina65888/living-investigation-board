// «Связи»: dependency map drawn as an investigation board — one case zone per project, yarn between tasks.
import {CorkBoard} from './corkboard.js?v=30';

const CARD_W=4.1,CARD_H=3.05,GAP_X=1.75,GAP_Y=.6,PAD=.6,HEAD=1.5,ZONE_GAP=1.6,ROW_MAX=30;
const plural=(n,one,few,many)=>{const a=Math.abs(n)%100,b=a%10;return `${n} ${a>10&&a<20?many:b===1?one:b>=2&&b<=4?few:many}`};
const overdue=t=>!!t?.dueDate&&t.status!=='done'&&new Date(t.dueDate+'T23:59:59')<Date.now();
// Column = how many tasks must finish first, so every project reads left → right like a chain of evidence.
function levels(tasks,relations){
  const ids=new Set(tasks.map(t=>t.id)),edges=[],level=new Map(tasks.map(t=>[t.id,0]));
  for(const r of relations){const[a,b]=r.type==='depends'?[r.targetId,r.sourceId]:[r.sourceId,r.targetId];if(r.type!=='related'&&ids.has(a)&&ids.has(b))edges.push([a,b])}
  for(let k=0;k<tasks.length;k++){let changed=false;for(const[a,b]of edges)if(level.get(b)<level.get(a)+1){level.set(b,level.get(a)+1);changed=true}if(!changed)break}
  return level;
}

export class HQView{
  constructor(el,cb={}){
    this.cb=cb;
    this.board=new CorkBoard(el,{cards:[],links:[]},{
      onSelect:id=>cb.onSelect?.(id),
      onEdit:id=>cb.onOpen?.(id),
      onMove:(id,pos)=>cb.onMove?.(id,pos),
      onConnect:(a,b)=>cb.onCreateRelation?.(a,b),
      onLink:link=>cb.onLink?.(link),
      onMode:mode=>cb.onMode?.(mode)
    },{insets:()=>({top:matchMedia('(max-width: 760px)').matches?64:78,bottom:16})});
  }
  get mode(){return this.board.mode}
  get selectedLink(){return this.board.selectedLink}
  title(id){return this.board.cards.get(id)?.title||'Задача'}
  setData({projects,tasks,relations,stages=[]}){
    const cards=[],byProject=new Map(projects.map(p=>[p.id,[]])),stageName=new Map(stages.map(s=>[s.id,s.name]));
    for(const t of tasks){if(!byProject.has(t.projectId))byProject.set(t.projectId,[]);byProject.get(t.projectId).push(t)}
    const zones=[...byProject.keys()].map(id=>({id,project:projects.find(p=>p.id===id),list:byProject.get(id)})).filter(z=>z.project||z.list.length);
    for(const z of zones){
      const lv=levels(z.list,relations),cols=[];
      for(const t of z.list){const c=lv.get(t.id);(cols[c]??=[]).push(t)}
      z.cols=cols.filter(Boolean);z.w=PAD*2+Math.max(1,z.cols.length)*(CARD_W+GAP_X)-GAP_X;z.h=HEAD+PAD*2+Math.max(1,...z.cols.map(c=>c.length))*(CARD_H+GAP_Y)-GAP_Y;
    }
    const rowMax=matchMedia('(max-width: 760px)').matches?0:ROW_MAX,rows=[];for(const z of zones){const row=rows.at(-1);if(row&&row.w+ZONE_GAP+z.w<=rowMax){row.items.push(z);row.w+=ZONE_GAP+z.w}else rows.push({items:[z],w:z.w})}
    let top=0;
    for(const row of rows){
      const rowH=Math.max(...row.items.map(z=>z.h));let left=-row.w/2;
      for(const z of row.items){
        const p=z.project,risks=z.list.filter(t=>t.status==='blocked'||overdue(t)).length;
        cards.push({id:`zone:${z.id}`,entityType:'zone',fixed:true,x:left+z.w/2,y:-(top+rowH/2),w:z.w,h:rowH,title:p?.name||'Без проекта',body:`${plural(z.list.length,'задача','задачи','задач')} · ${plural(risks,'риск','риска','рисков')}`,color:p?.color});
        z.cols.forEach((col,ci)=>col.forEach((t,ri)=>{
          const x=left+PAD+CARD_W/2+ci*(CARD_W+GAP_X),y=-(top+HEAD+PAD+CARD_H/2+ri*(CARD_H+GAP_Y));
          cards.push({id:t.id,entityType:'task',compact:true,x:t.relationsPos?.x??x,y:t.relationsPos?.y??y,w:CARD_W,h:CARD_H,title:t.title,kicker:stageName.get(t.stageId)||'',status:t.status,assignee:t.assignee||'Без ответственного',dueDate:t.dueDate||'',overdue:overdue(t),priority:t.priority});
        }));
        left+=z.w+ZONE_GAP;
      }
      top+=rowH+ZONE_GAP+.6;
    }
    const risky=new Set(tasks.filter(t=>t.status==='blocked'||overdue(t)).map(t=>t.id));
    const links=relations.map(r=>({a:r.sourceId,b:r.targetId,type:r.type,id:r.id,risk:risky.has(r.sourceId)||risky.has(r.targetId)}));
    this.board.setData({cards,links});
  }
  get view(){return{...this.board.view}}
  restore(view){this.board.view={...view};this.board.apply()}
  select(id){this.board.select(id)}
  setMode(mode){this.board.setMode(mode)}
  fit(){this.board.fit()}
  focus(id){this.board.focus(id)}
  destroy(){this.board.destroy()}
}
