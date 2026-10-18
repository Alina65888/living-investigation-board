// Trusted renderer code, loaded into the nonce-protected, opaque preview/print page.
// Positions are sheet percentages, so the same placement survives screen scaling.
const signatureImages=[...document.querySelectorAll('img[data-letter-signature]')];
let signaturePlacement=initialPlacement,signatureDefault=null,signatureReady=false,signatureRatio=1;
function clampSignature(p){
 const width=Math.max(3,Math.min(50,100/signatureRatio,Number(p.width)||18));
 return {x:Math.max(0,Math.min(100-width,Number(p.x)||0)),y:Math.max(0,Math.min(100-width*signatureRatio,Number(p.y)||0)),width};
}
function applySignature(p,notify=true){
 signaturePlacement=clampSignature(p);
 for(const img of signatureImages){
  const paper=img.closest('.letter-paper');
  // Keep the original slot in the template, but put the signature over the sheet.
  if(img.parentElement!==paper)paper.append(img);
  img.style.cssText=`position:absolute;left:${signaturePlacement.x}%;top:${signaturePlacement.y}%;width:${signaturePlacement.width}%;height:auto;max-width:none;max-height:none;object-fit:contain;z-index:1000000;${signatureEditor?'cursor:grab;touch-action:none;user-select:none;outline:2px dashed #6550a2;outline-offset:4px;':''}`;
 }
 if(signatureEditor&&notify&&parent!==window)parent.postMessage({type:'letter-signature-position',placement:signaturePlacement,ready:signatureReady},'*');
}
const signatureLayoutReady=signatureImages.length?Promise.all([document.fonts.ready,...signatureImages.map(i=>i.decode())]).then(()=>{
  const img=signatureImages[0],paper=img.closest('.letter-paper'),r=paper.getBoundingClientRect(),b=img.getBoundingClientRect();
  signatureRatio=(w/h)*(img.naturalHeight/img.naturalWidth);
  signatureDefault=clampSignature({x:(b.left-r.left)/r.width*100,y:(b.top-r.top)/r.height*100,width:Math.max(3,b.width/r.width*100)});
  signatureReady=true;
  // Older approved letters retain their original inline placement.
  if(initialPlacement||signatureEditor)applySignature(initialPlacement||signatureDefault);
  if(!signatureEditor){fit();return;}
  img.tabIndex=0;img.setAttribute('role','img');img.setAttribute('aria-label','Подпись. Перетащите или переместите стрелками клавиатуры.');img.draggable=false;
  let drag=null;
  img.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();const rect=paper.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX,y:e.clientY,start:{...signaturePlacement},rect};img.setPointerCapture(e.pointerId);img.focus();});
  img.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;applySignature({...drag.start,x:drag.start.x+(e.clientX-drag.x)/drag.rect.width*100,y:drag.start.y+(e.clientY-drag.y)/drag.rect.height*100});});
  const end=()=>{drag=null;};img.addEventListener('pointerup',end);img.addEventListener('pointercancel',end);img.addEventListener('lostpointercapture',end);
  img.addEventListener('keydown',e=>{const keys={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]},delta=keys[e.key];if(!delta)return;e.preventDefault();const step=e.shiftKey?1:.2;applySignature({...signaturePlacement,x:signaturePlacement.x+delta[0]*step,y:signaturePlacement.y+delta[1]*step});});
  addEventListener('message',e=>{if(e.source!==parent)return;if(e.data?.type==='letter-signature-set')applySignature(e.data.placement||{});if(e.data?.type==='letter-signature-reset')applySignature(signatureDefault);});
  fit();
 }).catch(()=>{if(signatureEditor)parent.postMessage({type:'letter-signature-error',message:'Не удалось загрузить изображение подписи. Загрузите его заново.'},'*');}):Promise.resolve();
