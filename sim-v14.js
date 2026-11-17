(() => {
  'use strict';
  const canvas=document.getElementById('map'),ctx=canvas.getContext('2d');
  const W=920,H=650,OX=100,OY=100,SCALE=207/5.4;
  const P=(x,y)=>({x:x-OX,y:y-OY});
  // 지도 구조는 원본 평면도에서 독립적으로 다시 작성한 layout-v5.js 한 곳에 둔다.
  const layout=window.WIFI_LAYOUT;
  const reflection=window.WIFI_REFLECTION;
  const elements=layout.structure.map(item=>item.kind==='block'
    ?{...item,x:item.x-OX,y:item.y-OY}
    :{...item,x1:item.x1-OX,y1:item.y1-OY,x2:item.x2-OX,y2:item.y2-OY});
  const DB={
    concrete:{'2.4':9,'5':16,source:'2.4 실험 8.97 / 5 NHS 경량 콘크리트'},
    partition:{'2.4':2.5,'5':3.5,source:'NHS 경량 건식벽 가정'},
    glass:{'2.4':3.6,'5':4.9,source:'NHS 일반 유리'},
    wood:{'2.4':1.9,'5':3.2,source:'NHS 나무문'},
    iron:{'2.4':16,'5':28,source:'Motorola 철제 방화문 참고'},
    metal:{'2.4':6,'5':12,source:'2.4 ITU 금속 사무실문 / 5 추정'}
  };
  const BASELINE={'2.4':-26,'5':-24.5},NEAR={'2.4':-9,'5':-15};
  const GRID=5,GW=W/GRID,GH=H/GRID;
  const materialCodes=['',...Object.keys(DB)];
  const names={concrete:'콘크리트',partition:'가벽',glass:'유리',wood:'나무',iron:'철문',metal:'금속 추정'};
  const colors={concrete:'#394b58',partition:'#82939d',glass:'#43a9c4',wood:'#b97a46',iron:'#704696',metal:'#68798c'};
  const doors=layout.doors.map(d=>({...d,open:false,progress:0}));
  const navigation=layout.navigation.map(([x,y])=>P(x,y));
  const originRouter=P(...layout.router),originProbe=P(...layout.probe);
  let router={...originRouter},probe={...originProbe},drag=null,paused=true,band='2.4',speed=1,view='wave',phase=0,front=0,reflective=false,waveStyle='basic',waveGain=8,concreteProfile='reference';
  const gridMode=()=>waveStyle==='continuous'||waveStyle==='reflectOnly';
  let zoom=1,panX=0,panY=0,panPointer=null;
  const FIELD=10,FW=W/FIELD,FH=H/FIELD,field=document.createElement('canvas');
  field.width=FW;field.height=FH;const fctx=field.getContext('2d');
  const WW=320,WH=226,waveField=document.createElement('canvas');
  waveField.width=WW;waveField.height=WH;const wctx=waveField.getContext('2d');
  const BW=160,BH=113,bounceField=document.createElement('canvas');
  bounceField.width=BW;bounceField.height=BH;const bctx=bounceField.getContext('2d');
  const PAD=250,CG=4,CW=Math.ceil((W+2*PAD)/CG),CH=Math.ceil((H+2*PAD)/CG),N=CW*CH,continuousField=document.createElement('canvas');
  continuousField.width=CW;continuousField.height=CH;const cctx=continuousField.getContext('2d');
  let previous=new Float32Array(N),currentWave=new Float32Array(N),nextWave=new Float32Array(N);
  const waveEnergy=new Float32Array(N);
  const velocity=new Float32Array(N),damping=new Float32Array(N),edgeRight=new Float32Array(N),edgeDown=new Float32Array(N);
  let waveMediaDirty=true,waveTick=0,waveAccumulator=0,waveSettledAt=120,waveReferenceIndex=0,continuousPowerTick=-1;
  let doorWaveEvents=[];
  const levelField=document.createElement('canvas');levelField.width=FW;levelField.height=FH;
  const lctx=levelField.getContext('2d'),waveDistance=new Float32Array(WW*WH);
  let levelsDirty=true,geometryDirty=true;
  let heat=new Float32Array(FW*FH),model=null,heatDirty=true,heatWork=null,readoutDirty=true;
  const RF=20,RW=W/RF,RH=Math.ceil(H/RF),reflectedHeat=new Float32Array(FW*FH);
  let reflectWork=null,reflectReady=false;
  let bounceDirty=true,bounceWork=null,bounceReady=false;
  const bounceDistance=new Float32Array(BW*BH),bounceStrength=new Float32Array(BW*BH),bouncePhase=new Float32Array(BW*BH);
  const EG=4,EW=Math.ceil((W+2*PAD)/EG),EH=Math.ceil((H+2*PAD)/EG),AG=10,AW=Math.ceil((W+2*PAD)/AG),AH=Math.ceil((H+2*PAD)/AG),outerField=document.createElement('canvas');
  outerField.width=EW;outerField.height=EH;const octx=outerField.getContext('2d');
  const outerDistance=new Float32Array(EW*EH),outerAmplitude=new Float32Array(EW*EH),outerCoarse=new Float32Array(AW*AH);
  let outerDirty=true,outerReady=false,outerWork=null;
  heat.fill(-95);
  const ref=()=>{
    const n=Number(document.getElementById(band==='2.4'?'reference24':'reference5').value);
    return Number.isFinite(n)&&n>=-95&&n<=-10?n:BASELINE[band];
  };
  // 공유기 위 실측과 1m 실측 사이의 표시용 보간. 1m 이상은 기존 거리 모형.
  function distanceLoss(distance){
    const metres=distance/SCALE;
    return metres<1?(ref()-NEAR[band])*(1-metres):20*Math.log10(metres);
  }
  function applyConcreteProfile(value){
    concreteProfile=value;
    DB.concrete['5']=value==='reinforced'?55:16;
    DB.concrete.source=value==='reinforced'
      ?'2.4 주거 실험 8.97 / 5 영국 연구 203mm 철근콘크리트 55'
      :'2.4 주거 실험 8.97 / 5 NHS 경량 콘크리트 16';
    document.getElementById('materialRows').innerHTML=Object.entries(DB).map(([key,v])=>`<tr><td>${names[key]}</td><td>${v['2.4']}</td><td>${v['5']}</td><td>${v.source}</td></tr>`).join('');
  }
  function doorSeg(d){return {x1:d.x1-OX,y1:d.y1-OY,x2:d.x2-OX,y2:d.y2-OY,material:d.material,width:8};}
  function residual(d){
    const s=doorSeg(d),mx=(s.x1+s.x2)/2,my=(s.y1+s.y2)/2;
    if(d.mechanism==='tripleStack')return [{...s,x2:s.x1+(s.x2-s.x1)/3}];
    if(d.mechanism==='halfSlideLeft')return [{...s,x2:mx,y2:my}];
    if(d.mechanism==='halfVertical')return [{...s,y2:my}];
    return [];
  }
  function buildModel(mode){
    const barriers=[...elements],waypoints=[];
    for(const d of doors){
      const open=mode==='open'||(mode==='current'&&d.open);
      if(open){
        barriers.push(...residual(d));
        let x=(d.x1+d.x2)/2-OX,y=(d.y1+d.y2)/2-OY;
        if(d.mechanism==='tripleStack')x=d.x1-OX+(d.x2-d.x1)*.68;
        if(d.mechanism==='halfSlideLeft')x=d.x1-OX+(d.x2-d.x1)*.75;
        if(d.mechanism==='halfVertical')y=d.y1-OY+(d.y2-d.y1)*.75;
        waypoints.push({x,y});
      } else barriers.push(doorSeg(d));
    }
    const unique=[],seen=new Set();
    for(const b of barriers){
      const k=b.kind==='block'
        ?['block',b.x,b.y,b.w,b.h,b.material].join(',')
        :['segment',b.x1,b.y1,b.x2,b.y2,b.material].join(',');
      if(!seen.has(k)){seen.add(k);unique.push(b);}
    }
    const m={grid:buildRaster(unique),waypoints,surfaces:reflection.surfaces(unique),barriers:unique};
    m.routes=waypoints.map(p=>{
      let dist=Math.hypot(router.x-p.x,router.y-p.y),part=crossLoss(router,p,m);
      let best=distanceLoss(dist)+part;
      for(const q of navigation.concat(waypoints)){
        if(Math.hypot(q.x-p.x,q.y-p.y)<5)continue;
        const trialDist=Math.hypot(router.x-q.x,router.y-q.y)+Math.hypot(q.x-p.x,q.y-p.y);
        const trialPart=crossLoss(router,q,m)+crossLoss(q,p,m);
        const trial=distanceLoss(trialDist)+trialPart;
        if(trial<best){best=trial;dist=trialDist;part=trialPart;}
      }
      return {p,dist,part};
    });
    return m;
  }
  function buildRaster(barriers){
    const grid=new Uint8Array(GW*GH);
    for(const s of barriers){
      let left,top,right,bottom;
      if(s.kind==='block'){left=s.x;top=s.y;right=s.x+s.w;bottom=s.y+s.h;}
      else{
        const r=(s.width||8)/2;
        left=Math.min(s.x1,s.x2)-r;right=Math.max(s.x1,s.x2)+r;
        top=Math.min(s.y1,s.y2)-r;bottom=Math.max(s.y1,s.y2)+r;
      }
      const code=materialCodes.indexOf(s.material);
      const x0=Math.max(0,Math.floor(left/GRID)),x1=Math.min(GW-1,Math.floor(right/GRID));
      const y0=Math.max(0,Math.floor(top/GRID)),y1=Math.min(GH-1,Math.floor(bottom/GRID));
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        const px=(x+.5)*GRID,py=(y+.5)*GRID,i=y*GW+x;
        if(px>=left&&px<=right&&py>=top&&py<=bottom&&
           (!grid[i]||DB[s.material][band]>DB[materialCodes[grid[i]]][band]))grid[i]=code;
      }
    }
    return grid;
  }
  function crossLoss(a,b,m){
    const dx=b.x-a.x,dy=b.y-a.y,steps=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))/GRID));
    const sx=dx/steps,sy=dy/steps,grid=m.grid;
    let x=a.x+sx,y=a.y+sy,total=0,inside=false,peak=0;
    for(let j=1;j<steps;j++,x+=sx,y+=sy){
      const gx=Math.floor(x/GRID),gy=Math.floor(y/GRID);
      const code=gx>=0&&gx<GW&&gy>=0&&gy<GH?grid[gy*GW+gx]:0;
      if(code){inside=true;peak=Math.max(peak,DB[materialCodes[code]][band]);}
      else if(inside){total+=peak;peak=0;inside=false;}
    }
    return total+(inside?peak:0);
  }
  function predictAt(point,m,directOnly=false){
    const directD=Math.hypot(point.x-router.x,point.y-router.y);
    let best=distanceLoss(directD)+crossLoss(router,point,m);
    if(!directOnly)for(const r of m.routes){
      const distance=r.dist+Math.hypot(point.x-r.p.x,point.y-r.p.y);
      const candidate=distanceLoss(distance)+r.part+crossLoss(r.p,point,m);
      if(candidate<best)best=candidate;
    }
    return Math.max(-110,Math.min(0,ref()-best));
  }
  function predictWithReflection(point,m,base=predictAt(point,m)){
    return reflection.predict(point,router,ref(),m,m.surfaces,band,SCALE,crossLoss,base).dbm;
  }
  function predictWithTwo(point,m,one=predictWithReflection(point,m)){
    return reflection.predictTwo(point,router,ref(),m,m.surfaces,band,SCALE,crossLoss,one).dbm;
  }
  function estimateAt(point,m){
    if(gridMode())return repeatedDbm(point);
    const base=predictAt(point,m);
    if(waveStyle==='basic')return base;
    const one=predictWithReflection(point,m,base);
    return waveStyle==='two'?predictWithTwo(point,m,one):one;
  }
  const activeHeat=()=>reflective&&reflectReady?reflectedHeat:heat;
  function refreshDuringDrag(){
    model=buildModel('current');heatWork=null;
    const step=6,cw=Math.ceil((FW-1)/step)+1,ch=Math.ceil((FH-1)/step)+1;
    const coarse=new Float32Array(cw*ch);
    for(let cy=0;cy<ch;cy++)for(let cx=0;cx<cw;cx++){
      const x=Math.min(FW-1,cx*step),y=Math.min(FH-1,cy*step);
      coarse[cy*cw+cx]=predictAt({x:(x+.5)*FIELD,y:(y+.5)*FIELD},model,true);
    }
    for(let y=0;y<FH;y++)for(let x=0;x<FW;x++){
      const cx=Math.min(cw-2,Math.floor(x/step)),cy=Math.min(ch-2,Math.floor(y/step));
      const x0=cx*step,x1=Math.min(FW-1,(cx+1)*step);
      const y0=cy*step,y1=Math.min(FH-1,(cy+1)*step);
      const tx=(x-x0)/(x1-x0),ty=(y-y0)/(y1-y0);
      const a=coarse[cy*cw+cx],b=coarse[cy*cw+cx+1];
      const c=coarse[(cy+1)*cw+cx],d=coarse[(cy+1)*cw+cx+1];
      heat[y*FW+x]=(a+(b-a)*tx)*(1-ty)+(c+(d-c)*tx)*ty;
    }
    heatDirty=true;reflectReady=false;reflectWork=null;bounceDirty=true;bounceReady=false;bounceWork=null;waveMediaDirty=true;outerDirty=true;outerWork=null;
    levelsDirty=true;
  }
  function refineHeat(){
    if(!heatWork)heatWork={row:0,model:buildModel('current')};
    const start=performance.now(),work=heatWork;
    for(let count=0;count<4&&work.row<FH;count++){
      const y=work.row++;
      for(let x=0;x<FW;x++)heat[y*FW+x]=predictAt({x:(x+.5)*FIELD,y:(y+.5)*FIELD},work.model);
      if(count>=1&&performance.now()-start>8)break;
    }
    levelsDirty=true;
    if(work.row===FH){model=work.model;heatDirty=false;heatWork=null;}
  }
  function refineReflection(){
    if(!reflectWork){reflectWork={row:0,coarse:new Float32Array(RW*RH),model:model||buildModel('current')};
      document.getElementById('reflectionStatus').textContent='반사 계산 중';}
    const work=reflectWork,start=performance.now();
    for(let rows=0;rows<2&&work.row<RH;rows++){
      const y=work.row++;
      for(let x=0;x<RW;x++){
        const point={x:Math.min(W-1,(x+.5)*RF),y:Math.min(H-1,(y+.5)*RF)};
        const one=predictWithReflection(point,work.model);
        work.coarse[y*RW+x]=waveStyle==='two'?predictWithTwo(point,work.model,one):one;
      }
      if(performance.now()-start>9)break;
    }
    if(work.row<RH)return;
    for(let y=0;y<FH;y++)for(let x=0;x<FW;x++){
      const xx=Math.max(0,Math.min(RW-1,(x+.5)*FIELD/RF-.5));
      const yy=Math.max(0,Math.min(RH-1,(y+.5)*FIELD/RF-.5));
      const x0=Math.floor(xx),y0=Math.floor(yy),x1=Math.min(RW-1,x0+1),y1=Math.min(RH-1,y0+1),tx=xx-x0,ty=yy-y0;
      const a=work.coarse[y0*RW+x0],b=work.coarse[y0*RW+x1],c=work.coarse[y1*RW+x0],d=work.coarse[y1*RW+x1];
      reflectedHeat[y*FW+x]=(a+(b-a)*tx)*(1-ty)+(c+(d-c)*tx)*ty;
    }
    reflectReady=true;reflectWork=null;levelsDirty=true;
    document.getElementById('reflectionStatus').textContent=waveStyle==='two'?'2회 반사 적용':'반사 파동 계산 중';
  }
  function refreshWaveLevels(){
    const img=lctx.createImageData(FW,FH),out=img.data;
    // 직접파와 반사파는 별도 층에 그린다. 반사 전력을 직접파의 동심원에 섞지 않는다.
    const values=heat;
    for(let i=0;i<values.length;i++){
      // dBm은 전력의 로그 척도다. 동일한 수신 조건에서 전계 진폭의 상대비는 10^(ΔdB/20).
      const amplitude=Math.min(1,Math.pow(10,(values[i]-ref())/20)),j=i*4;
      out[j]=out[j+1]=out[j+2]=255;
      out[j+3]=Math.min(235,Math.round(255*amplitude*waveGain));
    }
    lctx.putImageData(img,0,0);
    levelsDirty=false;
  }
  function refreshWaveGeometry(){
    for(let y=0;y<WH;y++)for(let x=0;x<WW;x++){
      const px=(x+.5)*W/WW,py=(y+.5)*H/WH;
      waveDistance[y*WW+x]=Math.hypot(px-router.x,py-router.y)/SCALE;
    }
    geometryDirty=false;
  }
  function refineOuter(){
    if(!outerWork)outerWork={row:0,model:model||buildModel('current')};
    const work=outerWork,start=performance.now();
    for(let rows=0;rows<4&&work.row<AH;rows++){
      const y=work.row++;
      for(let x=0;x<AW;x++){
        const px=(x+.5)*AG-PAD,py=(y+.5)*AG-PAD,i=y*AW+x;
        const point={x:px,y:py},dbm=predictAt(point,work.model,true);
        outerCoarse[i]=Math.min(1,Math.pow(10,(dbm-ref())/20));
      }
      if(performance.now()-start>8)break;
    }
    if(work.row===AH){
      for(let y=0;y<EH;y++)for(let x=0;x<EW;x++){
        const i=y*EW+x,xx=Math.max(0,Math.min(AW-1,((x+.5)*EG)/AG-.5));
        const yy=Math.max(0,Math.min(AH-1,((y+.5)*EG)/AG-.5));
        const x0=Math.floor(xx),x1=Math.min(AW-1,x0+1),y0=Math.floor(yy),y1=Math.min(AH-1,y0+1),tx=xx-x0,ty=yy-y0;
        const a=outerCoarse[y0*AW+x0],b=outerCoarse[y0*AW+x1],c=outerCoarse[y1*AW+x0],d=outerCoarse[y1*AW+x1];
        outerAmplitude[i]=(a+(b-a)*tx)*(1-ty)+(c+(d-c)*tx)*ty;
        outerDistance[i]=Math.hypot((x+.5)*EG-PAD-router.x,(y+.5)*EG-PAD-router.y)/SCALE;
      }
      outerDirty=false;outerReady=true;outerWork=null;
    }
  }
  function drawOuter(){
    if(!outerReady)return;
    const img=octx.createImageData(EW,EH),out=img.data;
    for(let i=0;i<outerDistance.length;i++){
      const x=i%EW,y=Math.floor(i/EW),d=Math.hypot((x+.5)*EG-PAD-router.x,(y+.5)*EG-PAD-router.y)/SCALE,j=i*4;
      if(!d||d>front)continue;
      const wave=Math.sin(d*(band==='2.4'?7.2:12.5)-phase);
      if(wave>0){out[j]=240;out[j+1]=100;out[j+2]=78;}
      else{out[j]=58;out[j+1]=134;out[j+2]=215;}
      out[j+3]=Math.min(235,Math.round(255*outerAmplitude[i]*waveGain*Math.abs(wave)));
    }
    octx.putImageData(img,0,0);ctx.imageSmoothingEnabled=true;ctx.drawImage(outerField,-PAD,-PAD,EW*EG,EH*EG);
  }
  function rebuildContinuousMedia(){
    const currentModel=model||buildModel('current'),barriers=currentModel.barriers,media=new Uint8Array(N);
    for(const s of barriers){
      let left,top,right,bottom;
      if(s.kind==='block'){left=s.x;top=s.y;right=s.x+s.w;bottom=s.y+s.h;}
      else{const r=(s.width||8)/2;left=Math.min(s.x1,s.x2)-r;top=Math.min(s.y1,s.y2)-r;right=Math.max(s.x1,s.x2)+r;bottom=Math.max(s.y1,s.y2)+r;}
      const code=materialCodes.indexOf(s.material);
      for(let y=Math.max(0,Math.floor((top+PAD)/CG));y<=Math.min(CH-1,Math.floor((bottom+PAD)/CG));y++)
        for(let x=Math.max(0,Math.floor((left+PAD)/CG));x<=Math.min(CW-1,Math.floor((right+PAD)/CG));x++){
          const px=(x+.5)*CG-PAD,py=(y+.5)*CG-PAD,i=y*CW+x;
          if(px>=left&&px<=right&&py>=top&&py<=bottom&&
             (!media[i]||DB[s.material][band]>DB[materialCodes[media[i]]][band]))media[i]=code;
        }
    }
    const dielectric={concrete:5.24,partition:2.73,glass:6.31,wood:1.99,iron:80,metal:80};
    for(let y=0;y<CH;y++)for(let x=0;x<CW;x++){
      const i=y*CW+x,material=materialCodes[media[i]];
      velocity[i]=waveStyle==='reflectOnly'&&material?0:.22/(material?dielectric[material]:1);
      const materialDamping=material?1-Math.pow(10,-DB[material][band]/90):0;
      const margin=Math.min(x,y,CW-1-x,CH-1-y),sponge=Math.max(0,(18-margin)/18);
      damping[i]=waveStyle==='reflectOnly'&&material?.88:Math.min(.88,.006+materialDamping+.55*sponge*sponge);
    }
    const harmonic=(a,b)=>a+b?2*a*b/(a+b):0;
    for(let y=0;y<CH;y++)for(let x=0;x<CW;x++){
      const i=y*CW+x;
      edgeRight[i]=x<CW-1?harmonic(velocity[i],velocity[i+1]):0;
      edgeDown[i]=y<CH-1?harmonic(velocity[i],velocity[i+CW]):0;
    }
    const directions=[[1,0],[-1,0],[0,1],[0,-1],[.707,.707],[.707,-.707],[-.707,.707],[-.707,-.707]];
    let best=Infinity;
    for(const [dx,dy] of directions){
      const point={x:router.x+dx*SCALE,y:router.y+dy*SCALE};
      if(point.x<5||point.x>W-5||point.y<5||point.y>H-5)continue;
      const gx=Math.floor((point.x+PAD)/CG),gy=Math.floor((point.y+PAD)/CG),i=gy*CW+gx;
      const score=crossLoss(router,point,currentModel)+(media[i]?50:0);
      if(score<best){best=score;waveReferenceIndex=i;}
    }
    continuousPowerTick=-1;
    waveMediaDirty=false;
  }
  function resetContinuous(){previous.fill(0);currentWave.fill(0);nextWave.fill(0);waveEnergy.fill(0);waveTick=0;waveAccumulator=0;waveSettledAt=120;continuousPowerTick=-1;doorWaveEvents=[];updateDoorArrivalStatus();}
  function advanceContinuous(){
    for(let y=1;y<CH-1;y++)for(let x=1;x<CW-1;x++){
      const i=y*CW+x,v=currentWave[i],flux=
        edgeRight[i]*(currentWave[i+1]-v)+edgeRight[i-1]*(currentWave[i-1]-v)+
        edgeDown[i]*(currentWave[i+CW]-v)+edgeDown[i-CW]*(currentWave[i-CW]-v);
      nextWave[i]=2*v-previous[i]+flux-damping[i]*(v-previous[i]);
    }
    const sx=Math.max(1,Math.min(CW-2,Math.floor((router.x+PAD)/CG)));
    const sy=Math.max(1,Math.min(CH-2,Math.floor((router.y+PAD)/CG)));
    nextWave[sy*CW+sx]+=.42*Math.sin(waveTick*2*Math.PI/(band==='2.4'?18:11));
    [previous,currentWave,nextWave]=[currentWave,nextWave,previous];waveTick++;
    for(let i=0;i<N;i++)waveEnergy[i]=.98*waveEnergy[i]+.02*currentWave[i]*currentWave[i];
    const instant=instantaneousDbm(probe);
    document.getElementById('instantStrength').textContent=instant===null?'파동 도착 전':Math.round(instant)+' dBm 환산';
    if(waveTick%10===0)readoutDirty=true;
  }
  function instantaneousDbm(point){
    if(!gridMode()||waveTick===0)return null;
    const reference=waveEnergy[waveReferenceIndex];
    const distance=Math.hypot(point.x-router.x,point.y-router.y);
    if(waveTick<distance/(Math.sqrt(.22)*CG)||reference<1e-10)return null;
    const x=Math.max(0,Math.min(CW-1,Math.floor((point.x+PAD)/CG)));
    const y=Math.max(0,Math.min(CH-1,Math.floor((point.y+PAD)/CG)));
    const value=currentWave[y*CW+x];
    return Math.max(-110,Math.min(0,ref()+10*Math.log10(Math.max(1e-12,value*value)/reference)));
  }
  function repeatedDbm(point){
    const distance=Math.hypot(point.x-router.x,point.y-router.y)/SCALE;
    if(distance<1&&(waveStyle!=='reflectOnly'||crossLoss(router,point,model||buildModel('current'))===0))return NEAR[band]+(ref()-NEAR[band])*distance;
    const reference=waveEnergy[waveReferenceIndex];
    const arrivalTicks=distance*SCALE/(Math.sqrt(.22)*CG);
    if(waveTick<waveSettledAt+arrivalTicks||reference<1e-10)return null;
    const x=Math.max(0,Math.min(CW-1,Math.floor((point.x+PAD)/CG)));
    const y=Math.max(0,Math.min(CH-1,Math.floor((point.y+PAD)/CG)));
    const ratio=Math.max(1e-12,waveEnergy[y*CW+x])/reference;
    return Math.max(-110,Math.min(0,ref()+10*Math.log10(ratio)));
  }
  function drawContinuousPower(){
    if(continuousPowerTick>=0&&waveTick<continuousPowerTick+10){ctx.drawImage(continuousField,-PAD,-PAD,CW*CG,CH*CG);return;}
    const reference=waveEnergy[waveReferenceIndex];
    if(waveTick<waveSettledAt||reference<1e-10)return;
    const img=cctx.createImageData(CW,CH),out=img.data;
    for(let i=0;i<N;i++){
      const dbm=Math.max(-110,Math.min(0,ref()+10*Math.log10(Math.max(1e-12,waveEnergy[i])/reference)));
      const j=i*4,level=Math.max(0,Math.min(1,(dbm+95)/55));
      out[j]=Math.round(55+195*level);out[j+1]=Math.round(134-65*level);
      out[j+2]=Math.round(220-151*level);out[j+3]=125;
    }
    cctx.putImageData(img,0,0);continuousPowerTick=waveTick;
    ctx.drawImage(continuousField,-PAD,-PAD,CW*CG,CH*CG);
  }
  function drawContinuous(){
    const img=cctx.createImageData(CW,CH),out=img.data;
    for(let i=0;i<N;i++){
      const v=currentWave[i],j=i*4;
      if(v>=0){out[j]=240;out[j+1]=100;out[j+2]=78;}
      else{out[j]=58;out[j+1]=134;out[j+2]=215;}
      out[j+3]=Math.min(225,Math.round(Math.abs(v)*450*waveGain));
    }
    cctx.putImageData(img,0,0);continuousPowerTick=-1;
    ctx.imageSmoothingEnabled=true;ctx.drawImage(continuousField,-PAD,-PAD,CW*CG,CH*CG);
  }
  function refineBounceGeometry(){
    if(!bounceWork){
      const current=model||buildModel('current');
      bounceWork={row:0,surfaces:current.surfaces,model:current};
    }
    const work=bounceWork,start=performance.now();
    for(let rows=0;rows<4&&work.row<BH;rows++){
      const y=work.row++;
      for(let x=0;x<BW;x++){
        const point={x:(x+.5)*W/BW,y:(y+.5)*H/BH},i=y*BW+x;
        let best=0,bestRay=null,bestCoeff=null;
        for(const s of work.surfaces){
          const ray=reflection.path(router,point,s);if(!ray)continue;
          const coeff=reflection.coefficient(s.material,band,ray.angle);
          const strength=coeff.amplitude/Math.max(1,ray.distance/SCALE);
          if(strength>best){best=strength;bestRay=ray;bestCoeff=coeff;}
        }
        bounceDistance[i]=bestRay?bestRay.distance/SCALE:0;
        if(bestRay){
          const hit=bestRay.hit,d1=Math.hypot(router.x-hit.x,router.y-hit.y),d2=Math.hypot(point.x-hit.x,point.y-hit.y);
          const nearSource={x:router.x+(hit.x-router.x)*Math.max(0,d1-7)/d1,y:router.y+(hit.y-router.y)*Math.max(0,d1-7)/d1};
          const nearPoint={x:point.x+(hit.x-point.x)*Math.max(0,d2-7)/d2,y:point.y+(hit.y-point.y)*Math.max(0,d2-7)/d2};
          const walls=crossLoss(router,nearSource,work.model)+crossLoss(point,nearPoint,work.model);
          bounceStrength[i]=Math.min(.65,best*1.2*Math.pow(10,-walls/20));
        }else bounceStrength[i]=0;
        bouncePhase[i]=bestCoeff?bestCoeff.phase:0;
      }
      if(performance.now()-start>8)break;
    }
    if(work.row===BH){bounceDirty=false;bounceReady=true;bounceWork=null;document.getElementById('reflectionStatus').textContent=waveStyle==='two'?'2회 반사 적용':'1회 반사 적용';}
  }
  function drawBounce(){
    if((waveStyle!=='reflection'&&waveStyle!=='two')||!bounceReady)return;
    const img=bctx.createImageData(BW,BH),out=img.data;
    for(let i=0;i<bounceDistance.length;i++){
      const distance=bounceDistance[i],j=i*4;
      if(!distance||distance>front)continue;
      const wave=Math.sin(distance*(band==='2.4'?7.2:12.5)-phase+bouncePhase[i]);
      if(wave>0){out[j]=235;out[j+1]=83;out[j+2]=59;}
      else{out[j]=45;out[j+1]=111;out[j+2]=211;}
      out[j+3]=Math.min(220,Math.round(220*bounceStrength[i]*Math.sqrt(waveGain)*Math.abs(wave)));
    }
    bctx.putImageData(img,0,0);
    ctx.drawImage(bounceField,0,0,W,H);
  }
  function drawField(){
    if(view==='power'&&gridMode()){
      drawContinuousPower();
    }else if(view==='power'){
      const img=fctx.createImageData(FW,FH),out=img.data;
      const values=activeHeat();
      for(let i=0;i<values.length;i++){
        const j=i*4,level=Math.max(0,Math.min(1,(values[i]+95)/55));
        out[j]=Math.round(55+195*level);out[j+1]=Math.round(134-65*level);
        out[j+2]=Math.round(220-151*level);out[j+3]=125;
      }
      fctx.putImageData(img,0,0);ctx.imageSmoothingEnabled=true;ctx.drawImage(field,0,0,W,H);
    }else if(gridMode()){
      drawContinuous();
    }else if(waveStyle==='basic'){
      drawOuter();
    }else{
      if(levelsDirty)refreshWaveLevels();
      if(geometryDirty)refreshWaveGeometry();
      const img=wctx.createImageData(WW,WH),out=img.data;
      for(let y=0;y<WH;y++)for(let x=0;x<WW;x++){
        const i=y*WW+x,j=i*4,distance=waveDistance[i];
        const wave=Math.sin(distance*(band==='2.4'?7.2:12.5)-phase);
        const alpha=distance<=front?Math.round(Math.abs(wave)*255):0;
        if(wave>0){out[j]=240;out[j+1]=100;out[j+2]=78;}
        else{out[j]=58;out[j+1]=134;out[j+2]=215;}
        out[j+3]=alpha;
      }
      wctx.putImageData(img,0,0);
      wctx.globalCompositeOperation='destination-in';wctx.imageSmoothingEnabled=true;
      wctx.drawImage(levelField,0,0,WW,WH);
      wctx.globalCompositeOperation='source-over';
      ctx.imageSmoothingEnabled=true;ctx.drawImage(waveField,0,0,W,H);
      drawBounce();
    }
  }
  function rect(s,color){
    ctx.fillStyle=color;
    if(s.kind==='block'){ctx.fillRect(s.x,s.y,s.w,s.h);return;}
    const r=s.width/2;
    ctx.fillRect(Math.min(s.x1,s.x2)-r,Math.min(s.y1,s.y2)-r,Math.abs(s.x2-s.x1)+2*r,Math.abs(s.y2-s.y1)+2*r);
  }
  function leaf(a,b,color,width=5){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='butt';ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
  function movingLeaf(hinge,closedEnd,direction,progress,color,width=6){
    const length=Math.hypot(closedEnd.x-hinge.x,closedEnd.y-hinge.y);
    const start=Math.atan2(closedEnd.y-hinge.y,closedEnd.x-hinge.x);
    const target={right:0,down:Math.PI/2,left:Math.PI,up:-Math.PI/2}[direction];
    let delta=target-start;
    while(delta>Math.PI)delta-=2*Math.PI;
    while(delta< -Math.PI)delta+=2*Math.PI;
    const angle=start+delta*progress;
    leaf(hinge,{x:hinge.x+length*Math.cos(angle),y:hinge.y+length*Math.sin(angle)},color,width);
    ctx.fillStyle='#fff';ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(hinge.x,hinge.y,3,0,2*Math.PI);ctx.fill();ctx.stroke();
  }
  function drawDoor(d){
    const s=doorSeg(d),color=colors[d.material],len=Math.hypot(s.x2-s.x1,s.y2-s.y1),t=d.progress;
    if(d.mechanism==='tripleStack'){
      const third=len/3;
      for(let k=0;k<3;k++){
        const x=s.x1+k*third*(1-t),y=s.y1+(k-1)*2.3;
        leaf({x,y},{x:x+third,y},color,3.5);
      }
    }else if(d.mechanism==='halfSlideLeft'){
      const half=len/2,start=s.x1+half*(1-t);
      leaf({x:s.x1,y:s.y1-2},{x:s.x1+half,y:s.y1-2},color,5);
      leaf({x:start,y:s.y1+2},{x:start+half,y:s.y1+2},color,5);
    }else if(d.mechanism==='halfVertical'){
      const half=len/2,start=s.y1+half*(1-t);
      leaf({x:s.x1-2,y:s.y1},{x:s.x1-2,y:s.y1+half},color,5);
      leaf({x:s.x1+2,y:start},{x:s.x1+2,y:start+half},color,5);
    }else if(d.mechanism==='doubleVertical'){
      const mid=(s.y1+s.y2)/2;
      const width=d.id==='closet'?10:6;
      movingLeaf({x:s.x1,y:s.y1},{x:s.x1,y:mid},d.direction,t,color,width);
      movingLeaf({x:s.x2,y:s.y2},{x:s.x2,y:mid},d.direction,t,color,width);
    }else if(d.mechanism==='doubleHorizontal'){
      const mid=(s.x1+s.x2)/2;
      movingLeaf({x:s.x1,y:s.y1},{x:mid,y:s.y1},d.direction,t,color);
      movingLeaf({x:s.x2,y:s.y2},{x:mid,y:s.y2},d.direction,t,color);
    }else{
      const first=d.hinge==='left'||d.hinge==='top';
      const hinge=first?{x:s.x1,y:s.y1}:{x:s.x2,y:s.y2};
      const closedEnd=first?{x:s.x2,y:s.y2}:{x:s.x1,y:s.y1};
      movingLeaf(hinge,closedEnd,d.direction,t,color,d.id==='bath'?10:6);
    }
  }
  function rounded(x,y,w,h,r){
    ctx.beginPath();
    if(ctx.roundRect)ctx.roundRect(x,y,w,h,r);
    else {ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);}
    ctx.closePath();
  }
  function overlapsBarrier(box){
    for(const s of elements){
      let ax,ay,bx,by;
      if(s.kind==='block'){ax=s.x;ay=s.y;bx=s.x+s.w;by=s.y+s.h;}
      else{const r=s.width/2;ax=Math.min(s.x1,s.x2)-r;ay=Math.min(s.y1,s.y2)-r;bx=Math.max(s.x1,s.x2)+r;by=Math.max(s.y1,s.y2)+r;}
      if(box.x<bx&&box.x+box.w>ax&&box.y<by&&box.y+box.h>ay)return true;
    }
    return false;
  }
  function marker(p,color,label,other){
    ctx.save();ctx.fillStyle='#fff';ctx.shadowColor='#17395455';ctx.shadowBlur=10;
    ctx.beginPath();ctx.arc(p.x,p.y,14,0,2*Math.PI);ctx.fill();ctx.shadowBlur=0;
    ctx.fillStyle=color;ctx.beginPath();ctx.arc(p.x,p.y,9,0,2*Math.PI);ctx.fill();
    ctx.font='600 12px system-ui';const w=Math.ceil(ctx.measureText(label).width)+18,h=26;
    const choices=[{x:p.x+18,y:p.y-13},{x:p.x-w-18,y:p.y-13},{x:p.x-w/2,y:p.y-43},{x:p.x-w/2,y:p.y+18}];
    let box=choices.find(q=>q.x>=3&&q.y>=3&&q.x+w<W-3&&q.y+h<H-3&&!overlapsBarrier({...q,w,h})&&!(other.x>q.x-10&&other.x<q.x+w+10&&other.y>q.y-10&&other.y<q.y+h+10));
    if(!box)box={x:Math.max(3,Math.min(W-w-3,choices[0].x)),y:Math.max(3,Math.min(H-h-3,choices[0].y))};
    ctx.shadowColor='#17395444';ctx.shadowBlur=8;ctx.fillStyle='#ffffffeb';rounded(box.x,box.y,w,h,6);ctx.fill();
    ctx.shadowBlur=0;ctx.fillStyle='#27394d';ctx.fillText(label,box.x+9,box.y+17);ctx.restore();
  }
  function draw(){
    ctx.clearRect(0,0,W,H);ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
    ctx.save();ctx.translate(panX,panY);ctx.scale(zoom,zoom);
    drawField();
    // 창문 유리는 벽보다 먼저 그려 양쪽 끝 모두 벽 아래에 놓는다.
    for(const s of elements)if(s.material==='glass')rect(s,colors[s.material]);
    for(const s of elements)if(s.material!=='glass')rect(s,colors[s.material]);
    for(const d of doors)drawDoor(d);
    ctx.save();ctx.setLineDash([6,5]);ctx.strokeStyle='#ffffff';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(router.x,router.y);ctx.lineTo(probe.x,probe.y);ctx.stroke();
    ctx.strokeStyle='#576a7e';ctx.lineWidth=1.7;ctx.beginPath();ctx.moveTo(router.x,router.y);ctx.lineTo(probe.x,probe.y);ctx.stroke();ctx.restore();
    if(Math.hypot(router.x-probe.x,router.y-probe.y)>75){
      const text=(Math.hypot(router.x-probe.x,router.y-probe.y)/SCALE).toFixed(1)+' m';
      ctx.save();ctx.font='600 12px system-ui';const w=ctx.measureText(text).width+14,h=22;
      const mx=(router.x+probe.x)/2,my=(router.y+probe.y)/2;
      const choices=[{x:mx-w/2,y:my-31},{x:mx-w/2,y:my+10}];
      const box=choices.find(q=>q.x>3&&q.x+w<W-3&&q.y>3&&q.y+h<H-3&&!overlapsBarrier({...q,w,h}))||choices[0];
      ctx.fillStyle='#fff';ctx.shadowColor='#243b5470';ctx.shadowBlur=6;rounded(box.x,box.y,w,h,6);ctx.fill();
      ctx.shadowBlur=0;ctx.fillStyle='#43576b';ctx.fillText(text,box.x+7,box.y+15);ctx.restore();
    }
    marker(router,'#e6574d','공유기',probe);marker(probe,'#e6b630','관찰점',router);
    ctx.restore();
  }
  function updateReadout(){
    if(!readoutDirty)return;
    const current=model||buildModel('current');
    const base=predictAt(probe,current);
    const repeated=gridMode()?repeatedDbm(probe):null;
    const selected=waveStyle==='basic'?base:repeated;
    document.getElementById('currentStrength').textContent=selected===null?'파동 계산 중':Math.round(selected)+' dBm';
    document.getElementById('baseStrength').textContent=Math.round(base)+' dBm';
    const instant=gridMode()?instantaneousDbm(probe):null;
    document.getElementById('instantStrength').textContent=!gridMode()?'파동 모드에서 표시':instant===null?'파동 도착 전':Math.round(instant)+' dBm 환산';
    document.getElementById('repeatedStrength').textContent=repeated===null?'시작 후 계산':Math.round(repeated)+' dBm';
    if(gridMode())document.getElementById('reflectionStatus').textContent=repeated===null?'파동 평균 계산 중':waveStyle==='reflectOnly'?'완전 반사 모형':'반사·투과 모형';
    document.getElementById('openStrength').textContent=gridMode()?'파동 모드에서는 미계산':Math.round(estimateAt(probe,buildModel('open')))+' dBm';
    document.getElementById('closedStrength').textContent=gridMode()?'파동 모드에서는 미계산':Math.round(estimateAt(probe,buildModel('closed')))+' dBm';
    document.getElementById('distance').textContent='약 '+(Math.hypot(router.x-probe.x,router.y-probe.y)/SCALE).toFixed(1)+' m';
    document.getElementById('routerPos').textContent=`지도 좌표 ${Math.round(router.x)}, ${Math.round(router.y)}`;
    document.getElementById('probePos').textContent=`지도 좌표 ${Math.round(probe.x)}, ${Math.round(probe.y)}`;
    readoutDirty=false;
  }
  function updateDoorArrivalStatus(){
    const label=document.getElementById('doorArrivalStatus');
    doorWaveEvents=doorWaveEvents.filter(event=>waveTick<event.arrival+80);
    if(!gridMode()||doorWaveEvents.length===0){label.textContent='';return;}
    label.textContent=doorWaveEvents.some(event=>waveTick<event.arrival)
      ?'문 변화가 관찰점에 아직 도착하지 않음 (모형 추정)'
      :'문 변화 도착 · 최근 평균 반영 중';
  }
  function markDoorChanges(changed){
    if(!gridMode()||waveTick===0)return;
    const airCellsPerTick=Math.sqrt(.22);
    for(const door of changed){
      const stepsToDoor=Math.ceil(distToSeg(router,door)/(CG*airCellsPerTick));
      const stepsToProbe=Math.max(1,Math.ceil(distToSeg(probe,door)/(CG*airCellsPerTick)));
      doorWaveEvents.push({arrival:Math.max(waveTick,stepsToDoor)+stepsToProbe});
    }
    updateDoorArrivalStatus();
  }
  function invalidate(preserveWaveReadout=false){
    heatDirty=true;heatWork=null;model=null;reflectReady=false;reflectWork=null;bounceDirty=true;bounceReady=false;bounceWork=null;waveMediaDirty=true;outerDirty=true;outerWork=null;levelsDirty=true;readoutDirty=true;
    // 문 변화는 현재 파동 격자에 전파된다. 관찰점에 아직 도착하지 않은
    // 변화를 이유로 기존 평균 신호를 즉시 숨기지 않는다.
    if(gridMode()&&!preserveWaveReadout)waveSettledAt=Math.max(waveSettledAt,waveTick+80);
    if(!preserveWaveReadout){doorWaveEvents=[];updateDoorArrivalStatus();}
    updateReadout();
  }
  function toggle(d){markDoorChanges([d]);d.open=!d.open;invalidate(true);}
  function screenPos(e){const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*W/r.width,y:(e.clientY-r.top)*H/r.height};}
  function pos(e){const s=screenPos(e);return {x:(s.x-panX)/zoom,y:(s.y-panY)/zoom};}
  function clampPan(){
    const mx=zoom===1?140:70,my=zoom===1?100:50;
    panX=Math.max(W*(1-zoom)-mx,Math.min(mx,panX));
    panY=Math.max(H*(1-zoom)-my,Math.min(my,panY));
  }
  const touchPointers=new Map();
  let pinch=null,touchDoor=null;
  function hitRadius(e,mouse,touch){
    return (e.pointerType==='touch'?touch:mouse)*W/canvas.getBoundingClientRect().width/zoom;
  }
  function startPinch(){
    const [a,b]=[...touchPointers.values()];
    const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom,world:{x:(mid.x-panX)/zoom,y:(mid.y-panY)/zoom}};
    drag='pinch';panPointer=null;touchDoor=null;
  }
  canvas.addEventListener('wheel',e=>{
    const cursor=screenPos(e),world=pos(e),next=Math.max(1,Math.min(5,zoom*(e.deltaY<0?1.18:1/1.18)));
    zoom=next;panX=cursor.x-world.x*zoom;panY=cursor.y-world.y*zoom;clampPan();
    document.getElementById('zoomReadout').textContent=Math.round(zoom*100)+'%';
    e.preventDefault();
  },{passive:false});
  function distToSeg(p,d){const s=doorSeg(d),vx=s.x2-s.x1,vy=s.y2-s.y1,t=Math.max(0,Math.min(1,((p.x-s.x1)*vx+(p.y-s.y1)*vy)/(vx*vx+vy*vy)));return Math.hypot(p.x-s.x1-t*vx,p.y-s.y1-t*vy);}
  canvas.addEventListener('pointerdown',e=>{
    if(e.pointerType==='touch'){
      touchPointers.set(e.pointerId,screenPos(e));
      if(touchPointers.size===2){startPinch();canvas.setPointerCapture(e.pointerId);e.preventDefault();return;}
      if(touchPointers.size>2){canvas.setPointerCapture(e.pointerId);e.preventDefault();return;}
    }
    const p=pos(e);
    if(Math.hypot(p.x-router.x,p.y-router.y)<hitRadius(e,19,28))drag='router';
    else if(Math.hypot(p.x-probe.x,p.y-probe.y)<hitRadius(e,19,28))drag='probe';
    else{
      const d=doors.find(x=>distToSeg(p,x)<hitRadius(e,12,22));
      if(d){
        if(e.pointerType==='touch'){
          drag='doorTap';touchDoor={pointerId:e.pointerId,door:d,start:screenPos(e),moved:false};
          canvas.setPointerCapture(e.pointerId);
        }else toggle(d);
        e.preventDefault();return;
      }
      drag='pan';panPointer=screenPos(e);
    }
    canvas.setPointerCapture(e.pointerId);canvas.style.cursor='grabbing';e.preventDefault();
  });
  canvas.addEventListener('pointermove',e=>{
    if(touchPointers.has(e.pointerId))touchPointers.set(e.pointerId,screenPos(e));
    if(drag==='pinch'){
      if(touchPointers.size>=2&&pinch){
        const [a,b]=[...touchPointers.values()],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
        const distance=Math.hypot(a.x-b.x,a.y-b.y);
        zoom=Math.max(1,Math.min(5,pinch.zoom*distance/pinch.distance));
        panX=mid.x-pinch.world.x*zoom;panY=mid.y-pinch.world.y*zoom;clampPan();
        document.getElementById('zoomReadout').textContent=Math.round(zoom*100)+'%';
      }
      e.preventDefault();return;
    }
    if(drag==='doorTap'){
      if(touchDoor&&e.pointerId===touchDoor.pointerId){
        const s=screenPos(e);
        if(Math.hypot(s.x-touchDoor.start.x,s.y-touchDoor.start.y)>18)touchDoor.moved=true;
      }
      e.preventDefault();return;
    }
    const p=pos(e);
    if(drag==='pan'){
      const s=screenPos(e);panX+=s.x-panPointer.x;panY+=s.y-panPointer.y;panPointer=s;clampPan();e.preventDefault();
    }else if(drag){
      const target=drag==='router'?router:probe;
      target.x=Math.max(10,Math.min(W-10,p.x));target.y=Math.max(10,Math.min(H-10,p.y));
      if(drag==='router'){geometryDirty=true;invalidate();}else{doorWaveEvents=[];updateDoorArrivalStatus();readoutDirty=true;updateReadout();}
      e.preventDefault();
    }else canvas.style.cursor=(Math.hypot(p.x-router.x,p.y-router.y)<hitRadius(e,19,28)||Math.hypot(p.x-probe.x,p.y-probe.y)<hitRadius(e,19,28))?'grab':doors.some(d=>distToSeg(p,d)<hitRadius(e,12,22))?'pointer':'grab';
  });
  function endDrag(e,commit=true){
    if(commit&&drag==='doorTap'&&touchDoor&&e&&e.pointerId===touchDoor.pointerId&&!touchDoor.moved)toggle(touchDoor.door);
    touchDoor=null;
    if(e)touchPointers.delete(e.pointerId);else touchPointers.clear();
    if(drag==='pinch'&&touchPointers.size>=2)return;
    if(drag==='pinch'&&touchPointers.size===1){
      drag='pan';panPointer=[...touchPointers.values()][0];pinch=null;return;
    }
    drag=null;panPointer=null;pinch=null;canvas.style.cursor='grab';
  }
  canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',e=>endDrag(e,false));
  function home(which){if(which==='router'){router={...originRouter};geometryDirty=true;}else probe={...originProbe};invalidate();}
  document.getElementById('resetRouter').onclick=()=>home('router');
  document.getElementById('resetProbe').onclick=()=>home('probe');
  document.getElementById('restart').onclick=()=>{phase=0;front=0;resetContinuous();paused=false;document.getElementById('play').textContent='일시 정지';readoutDirty=true;updateReadout();};
  document.getElementById('allOpen').onclick=()=>{markDoorChanges(doors.filter(d=>!d.open));doors.forEach(d=>d.open=true);invalidate(true);};
  document.getElementById('allClosed').onclick=()=>{markDoorChanges(doors.filter(d=>d.open));doors.forEach(d=>d.open=false);invalidate(true);};
  document.getElementById('resetAll').onclick=()=>{
    router={...originRouter};probe={...originProbe};geometryDirty=true;
    doors.forEach(d=>{d.open=false;d.progress=0;});
    band='2.4';speed=1;view='wave';reflective=false;waveStyle='basic';waveGain=8;phase=0;front=0;paused=true;zoom=1;panX=0;panY=0;resetContinuous();
    document.getElementById('band').value='2.4';document.getElementById('speed').value='1';document.getElementById('waveGain').value='8';
    document.getElementById('concreteProfile').value='reference';applyConcreteProfile('reference');
    document.getElementById('view').value='wave';document.getElementById('reference24').value=String(BASELINE['2.4']);
    document.getElementById('propagation').value='basic';document.getElementById('reflectionStatus').textContent='';
    document.getElementById('reference5').value=String(BASELINE['5']);document.getElementById('play').textContent='시작';
    document.getElementById('waveLegend').style.display='flex';document.getElementById('powerLegend').style.display='none';
    document.getElementById('zoomReadout').textContent='100%';invalidate();
  };
  document.getElementById('play').onclick=e=>{paused=!paused;e.currentTarget.textContent=paused?(front===0?'시작':'계속'):'일시 정지';};
  document.getElementById('band').onchange=e=>{band=e.target.value;resetContinuous();invalidate();};
  document.getElementById('speed').onchange=e=>{speed=Number(e.target.value);};
  document.getElementById('waveGain').onchange=e=>{waveGain=Number(e.target.value);levelsDirty=true;};
  document.getElementById('concreteProfile').onchange=e=>{applyConcreteProfile(e.target.value);invalidate();};
  document.getElementById('view').onchange=e=>{
    view=e.target.value;
    document.getElementById('waveLegend').style.display=view==='wave'?'flex':'none';
    document.getElementById('powerLegend').style.display=view==='power'?'flex':'none';
    draw();
  };
  document.getElementById('propagation').onchange=e=>{
    waveStyle=e.target.value;
    reflective=false;reflectReady=false;reflectWork=null;bounceDirty=true;bounceReady=false;bounceWork=null;levelsDirty=true;readoutDirty=true;waveMediaDirty=true;
    if(gridMode())resetContinuous();
    else{doorWaveEvents=[];updateDoorArrivalStatus();}
    document.getElementById('reflectionStatus').textContent=gridMode()?'파동 평균 계산 중':'';
    updateReadout();
  };
  for(const id of ['reference24','reference5'])document.getElementById(id).addEventListener('change',()=>{invalidate();});
  const help=document.getElementById('helpDialog');
  document.getElementById('helpButton').onclick=()=>help.showModal();
  document.getElementById('helpClose').onclick=()=>help.close();
  const mapPanel=document.getElementById('mapPanel'),metricsPanel=document.getElementById('metricsPanel');
  const syncPanelHeight=()=>{metricsPanel.style.height=window.innerWidth<=930?'':Math.ceil(mapPanel.getBoundingClientRect().height)+'px';};
  syncPanelHeight();
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(syncPanelHeight).observe(mapPanel);
  applyConcreteProfile('reference');
  function frame(){
    if(drag==='router')refreshDuringDrag();
    else if(heatDirty)refineHeat();
    else if(reflective&&!reflectReady)refineReflection();
    else if((waveStyle==='reflection'||waveStyle==='two')&&bounceDirty)refineBounceGeometry();
    if(waveStyle==='basic'&&outerDirty)refineOuter();
    if(gridMode()&&waveMediaDirty)rebuildContinuousMedia();
    for(const d of doors){
      const target=d.open?1:0;
      if(Math.abs(d.progress-target)>.001)d.progress+=Math.sign(target-d.progress)*Math.min(.12,Math.abs(target-d.progress));
      else d.progress=target;
    }
    if(!paused){
      phase+=speed*.11;front+=speed*.05;
      if(gridMode()){
        waveAccumulator+=speed;
        while(waveAccumulator>=1){advanceContinuous();waveAccumulator-=1;}
      }
    }
    if(doorWaveEvents.length)updateDoorArrivalStatus();
    draw();updateReadout();requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
