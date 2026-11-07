/* Throwaway graph interaction for the fixed Issue #1 demo. All state is in memory. */
window.PrototypeGraph = (() => {
  const views = new Map();
  let instances = [];

  function mount(svg) {
    if (svg.dataset.mounted) return;
    svg.dataset.mounted = 'true';
    const shell = svg.closest('.graph-shell');
    const key = svg.dataset.viewKey;
    const state = views.get(key) || {positions:{},camera:null,labels:true,neighbors:false};
    views.set(key,state);
    const dots = [...svg.querySelectorAll('.node')];
    const edges = [...svg.querySelectorAll('.edge')];
    const selected = dots.find(n => n.classList.contains('selected'));
    const selectedId = selected?.dataset.select;
    const connected = new Set([selectedId]);
    edges.forEach(edge => {
      if (edge.dataset.from === selectedId) connected.add(edge.dataset.to);
      if (edge.dataset.to === selectedId) connected.add(edge.dataset.from);
    });
    dots.forEach(dot => {
      const id = dot.dataset.select;
      state.positions[id] ||= {x:Number(dot.dataset.x),y:Number(dot.dataset.y)};
    });
    let camera = state.camera;
    let drag = null;
    let ignoreClickUntil = 0;
    const point = event => {
      const p = svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;
      return p.matrixTransform(svg.getScreenCTM().inverse());
    };
    const visible = () => dots.filter(n => !state.neighbors || connected.has(n.dataset.select));
    function fit(items=visible(),padding=svg.classList.contains('local-svg')?55:80) {
      if (!items.length) return;
      const positions=items.map(n=>state.positions[n.dataset.select]);
      const minX=Math.min(...positions.map(p=>p.x))-padding;
      const maxX=Math.max(...positions.map(p=>p.x))+padding;
      const minY=Math.min(...positions.map(p=>p.y))-padding;
      const maxY=Math.max(...positions.map(p=>p.y))+padding+25;
      const aspect=Math.max(.4,svg.clientWidth/Math.max(1,svg.clientHeight));
      let w=Math.max(230,maxX-minX),h=Math.max(200,maxY-minY);
      if(w/h<aspect)w=h*aspect;else h=w/aspect;
      if(svg.clientWidth/w>1.25){w=svg.clientWidth/1.25;h=w/aspect;}
      camera={x:(minX+maxX-w)/2,y:(minY+maxY-h)/2,w,h};
      applyCamera();
    }
    function applyCamera() {
      if (!camera) return;
      state.camera=camera;
      svg.setAttribute('viewBox',`${camera.x} ${camera.y} ${camera.w} ${camera.h}`);
      const scale=Math.round(svg.clientWidth/camera.w*100);
      const indicator=shell.querySelector('[data-zoom-level]');
      if(indicator) indicator.textContent=scale+'%';
    }
    function draw() {
      dots.forEach(dot=>{
        const p=state.positions[dot.dataset.select];
        dot.setAttribute('transform',`translate(${p.x},${p.y})`);
        dot.classList.toggle('outside-focus',state.neighbors&&!connected.has(dot.dataset.select));
      });
      edges.forEach(edge=>{
        const a=state.positions[edge.dataset.from],b=state.positions[edge.dataset.to];
        if(!a||!b)return;
        const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1;
        const from=Number(edge.dataset.fromRadius)+3,to=Number(edge.dataset.toRadius)+6;
        const x1=a.x+dx/d*from,y1=a.y+dy/d*from,x2=b.x-dx/d*to,y2=b.y-dy/d*to;
        const bend=Number(edge.dataset.bend);
        edge.setAttribute('d',`M ${x1} ${y1} Q ${(x1+x2)/2-dy/d*bend} ${(y1+y2)/2+dx/d*bend} ${x2} ${y2}`);
        edge.classList.toggle('outside-focus',state.neighbors&&(!connected.has(edge.dataset.from)||!connected.has(edge.dataset.to)));
      });
      svg.classList.toggle('hide-labels',!state.labels);
      shell.querySelector('[data-graph-action="labels"]')?.setAttribute('aria-pressed',String(state.labels));
      shell.querySelector('[data-graph-action="neighbors"]')?.setAttribute('aria-pressed',String(state.neighbors));
    }
    function zoom(factor,anchor) {
      if(!camera)return;
      const w=Math.min(2200,Math.max(170,camera.w*factor));
      factor=w/camera.w;
      const p=anchor||{x:camera.x+camera.w/2,y:camera.y+camera.h/2};
      camera={x:p.x+(camera.x-p.x)*factor,y:p.y+(camera.y-p.y)*factor,w,h:camera.h*factor};
      applyCamera();
    }
    shell.addEventListener('click',event=>{
      const control=event.target.closest('[data-graph-action]');
      if(!control)return;
      event.stopPropagation();
      const action=control.dataset.graphAction;
      if(action==='in')zoom(.8);
      if(action==='out')zoom(1.25);
      if(action==='fit')fit();
      if(action==='focus')fit(dots.filter(n=>connected.has(n.dataset.select)),75);
      if(action==='labels'){state.labels=!state.labels;draw();}
      if(action==='neighbors'){state.neighbors=!state.neighbors;draw();fit();}
    });
    svg.addEventListener('wheel',event=>{event.preventDefault();zoom(Math.exp(event.deltaY*.001),point(event));},{passive:false});
    svg.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      const node=event.target.closest('.node');
      drag={id:node?.dataset.select,start:point(event),clientX:event.clientX,clientY:event.clientY,camera:{...camera},position:node?{...state.positions[node.dataset.select]}:null,moved:false};
      (node||svg).setPointerCapture(event.pointerId);
      svg.classList.add('is-dragging');
    });
    svg.addEventListener('pointermove',event=>{
      if(!drag)return;
      if(Math.hypot(event.clientX-drag.clientX,event.clientY-drag.clientY)>4)drag.moved=true;
      if(!drag.moved)return;
      if(drag.id){
        const p=point(event);
        state.positions[drag.id]={x:drag.position.x+p.x-drag.start.x,y:drag.position.y+p.y-drag.start.y};
        draw();
      }else{
        const scale=drag.camera.w/svg.clientWidth;
        camera={...drag.camera,x:drag.camera.x-(event.clientX-drag.clientX)*scale,y:drag.camera.y-(event.clientY-drag.clientY)*scale};
        applyCamera();
      }
    });
    const endDrag=()=>{if(drag?.moved)ignoreClickUntil=performance.now()+150;drag=null;svg.classList.remove('is-dragging');};
    svg.addEventListener('pointerup',endDrag);
    svg.addEventListener('pointercancel',endDrag);
    svg.addEventListener('click',event=>{if(performance.now()<ignoreClickUntil){event.preventDefault();event.stopPropagation();}},true);
    draw();
    if(camera)applyCamera();else fit();
    if(svg.dataset.focus==='true')fit(dots.filter(n=>connected.has(n.dataset.select)),svg.classList.contains('local-svg')?55:75);
    const observer=new ResizeObserver(()=>{if(camera){const h=camera.w*svg.clientHeight/Math.max(1,svg.clientWidth);camera={...camera,y:camera.y+(camera.h-h)/2,h};applyCamera();}});
    observer.observe(svg);
    instances.push({svg,observer,fit});
  }
  return {
    mountAll(){instances=instances.filter(instance=>{if(!instance.svg.isConnected){instance.observer.disconnect();return false;}return true;});document.querySelectorAll('svg.graph-svg').forEach(mount);},
    dispose(){instances.forEach(instance=>instance.observer.disconnect());instances=[];},
    focus(){instances.filter(instance=>!instance.svg.closest('dialog')||instance.svg.closest('dialog').open).forEach(instance=>{const selected=instance.svg.querySelector('.selected');const ids=new Set([selected?.dataset.select]);instance.svg.querySelectorAll('.edge.connected').forEach(e=>{ids.add(e.dataset.from);ids.add(e.dataset.to);});instance.fit([...instance.svg.querySelectorAll('.node')].filter(n=>ids.has(n.dataset.select)),75);});},
    reset(){views.clear();},
    snapshot(){return [...views].map(([key,state])=>({key,camera:state.camera,labels:state.labels,neighbors:state.neighbors}));}
  };
})();
