// ITU-R P.2040-4 표 3, 식 (43a)/(44)에 따른 균일 단층판 반사 근사.
// 철근 배치, 다층 벽, 바닥/천장, 회절, 위상 간섭은 포함하지 않는다.
window.WIFI_REFLECTION=(()=>{
  'use strict';
  const C={
    concrete:{eps:5.24,c:.0462,d:.7822,thickness:.20},
    partition:{eps:2.73,c:.0085,d:.9395,thickness:.20},
    glass:{eps:6.31,c:.0036,d:1.3394,thickness:.01},
    wood:{eps:1.99,c:.0047,d:1.0718,thickness:.04},
    iron:{eps:1,c:1e7,d:0,thickness:.002},
    metal:{eps:1,c:1e7,d:0,thickness:.002}
  };
  const z=(re,im=0)=>({re,im}),add=(a,b)=>z(a.re+b.re,a.im+b.im),sub=(a,b)=>z(a.re-b.re,a.im-b.im);
  const mul=(a,b)=>z(a.re*b.re-a.im*b.im,a.re*b.im+a.im*b.re);
  const div=(a,b)=>{const d=b.re*b.re+b.im*b.im;return z((a.re*b.re+a.im*b.im)/d,(a.im*b.re-a.re*b.im)/d)};
  const sqrt=a=>{const r=Math.hypot(a.re,a.im);return z(Math.sqrt(Math.max(0,(r+a.re)/2)),Math.sign(a.im||1)*Math.sqrt(Math.max(0,(r-a.re)/2)))};
  const exp=a=>{const r=Math.exp(Math.max(-700,Math.min(700,a.re)));return z(r*Math.cos(a.im),r*Math.sin(a.im))};
  const abs2=a=>a.re*a.re+a.im*a.im;
  const cache=new Map();
  function coefficient(material,band,angle=0){
    const spec=C[material];if(!spec)return {power:0,phase:0,amplitude:0};
    const bin=Math.max(0,Math.min(80,Math.round(angle*180/Math.PI/5)*5));
    const key=`${material}/${band}/${bin}`;if(cache.has(key))return cache.get(key);
    const f=Number(band),theta=bin*Math.PI/180,cos=Math.cos(theta),sin=Math.sin(theta);
    const sigma=spec.c*Math.pow(f,spec.d),epsilon=z(spec.eps,-17.98*sigma/f);
    const normal=sqrt(sub(epsilon,z(sin*sin)));
    const rte=div(sub(z(cos),normal),add(z(cos),normal));
    const tmTop=mul(epsilon,z(cos)),rtm=div(sub(tmTop,normal),add(tmTop,normal));
    const wavelength=.299792458/f,q=mul(normal,z(2*Math.PI*spec.thickness/wavelength));
    const inside=exp(z(2*q.im,-2*q.re));
    const slab=r=>div(mul(r,sub(z(1),inside)),sub(z(1),mul(mul(r,r),inside)));
    const te=slab(rte),tm=slab(rtm),power=Math.max(0,Math.min(1,(abs2(te)+abs2(tm))/2));
    const result={power,amplitude:Math.sqrt(power),phase:Math.atan2(te.im,te.re)};
    cache.set(key,result);return result;
  }
  function surfaces(barriers){
    const raw=[];
    for(const b of barriers){
      if(b.kind==='block'){
        raw.push({x1:b.x,y1:b.y,x2:b.x+b.w,y2:b.y,material:b.material},
          {x1:b.x,y1:b.y+b.h,x2:b.x+b.w,y2:b.y+b.h,material:b.material},
          {x1:b.x,y1:b.y,x2:b.x,y2:b.y+b.h,material:b.material},
          {x1:b.x+b.w,y1:b.y,x2:b.x+b.w,y2:b.y+b.h,material:b.material});
      }else raw.push(b);
    }
    const groups=new Map();
    for(const s of raw){
      const vertical=Math.abs(s.x2-s.x1)<.001,horizontal=Math.abs(s.y2-s.y1)<.001;
      if(!vertical&&!horizontal)continue;
      const at=vertical?s.x1:s.y1,start=vertical?Math.min(s.y1,s.y2):Math.min(s.x1,s.x2);
      const end=vertical?Math.max(s.y1,s.y2):Math.max(s.x1,s.x2);
      const key=`${vertical?'v':'h'}/${at}/${s.material}`;
      if(!groups.has(key))groups.set(key,{vertical,at,material:s.material,spans:[]});
      groups.get(key).spans.push([start,end]);
    }
    const out=[];
    for(const g of groups.values()){
      g.spans.sort((a,b)=>a[0]-b[0]);let [start,end]=g.spans[0];
      const push=()=>{if(end-start>=20)out.push({vertical:g.vertical,at:g.at,start,end,material:g.material,length:end-start})};
      for(const [a,b] of g.spans.slice(1)){
        if(a<=end+2)end=Math.max(end,b);
        else{push();start=a;end=b;}
      }
      push();
    }
    return out;
  }
  function path(source,target,s){
    const a=s.vertical?source.x:source.y,b=s.vertical?target.x:target.y;
    if((a-s.at)*(b-s.at)<=0)return null;
    const image=2*s.at-a,den=b-image;if(Math.abs(den)<1e-7)return null;
    const t=(s.at-image)/den;if(t<=0||t>=1)return null;
    const parallelSource=s.vertical?source.y:source.x,parallelTarget=s.vertical?target.y:target.x;
    const along=parallelSource+t*(parallelTarget-parallelSource);
    if(along<s.start+2||along>s.end-2)return null;
    const hit=s.vertical?{x:s.at,y:along}:{x:along,y:s.at};
    const d1=Math.hypot(source.x-hit.x,source.y-hit.y),d2=Math.hypot(target.x-hit.x,target.y-hit.y);
    const cos=Math.min(1,Math.abs(a-s.at)/d1);
    return {hit,distance:d1+d2,angle:Math.acos(cos)};
  }
  function mirror(p,s){return s.vertical?{x:2*s.at-p.x,y:p.y}:{x:p.x,y:2*s.at-p.y};}
  function intersection(a,b,s){
    const va=s.vertical?a.x:a.y,vb=s.vertical?b.x:b.y,den=vb-va;
    if(Math.abs(den)<1e-7)return null;
    const t=(s.at-va)/den;if(t<=1e-5||t>=1-1e-5)return null;
    const along=(s.vertical?a.y:a.x)+t*((s.vertical?b.y:b.x)-(s.vertical?a.y:a.x));
    if(along<s.start+2||along>s.end-2)return null;
    return s.vertical?{x:s.at,y:along}:{x:along,y:s.at};
  }
  function pathTwo(source,target,first,second){
    if(first===second||(first.vertical===second.vertical&&Math.abs(first.at-second.at)<2))return null;
    const image1=mirror(source,first),image2=mirror(image1,second);
    const hit2=intersection(image2,target,second);if(!hit2)return null;
    const hit1=intersection(image1,hit2,first);if(!hit1)return null;
    const side=(p,s)=>s.vertical?p.x-s.at:p.y-s.at;
    if(side(source,first)*side(hit2,first)<=0||side(hit1,second)*side(target,second)<=0)return null;
    const d1=Math.hypot(source.x-hit1.x,source.y-hit1.y),d2=Math.hypot(hit1.x-hit2.x,hit1.y-hit2.y),d3=Math.hypot(hit2.x-target.x,hit2.y-target.y);
    if(Math.min(d1,d2,d3)<2)return null;
    const cos1=Math.min(1,Math.abs(side(source,first))/d1);
    const cos2=Math.min(1,Math.abs(side(hit1,second))/d2);
    return {hit1,hit2,distance:d1+d2+d3,angle1:Math.acos(cos1),angle2:Math.acos(cos2)};
  }
  function toward(a,b,trim){const d=Math.hypot(b.x-a.x,b.y-a.y);return {x:a.x+(b.x-a.x)*Math.max(0,d-trim)/d,y:a.y+(b.y-a.y)*Math.max(0,d-trim)/d};}
  function predict(point,source,baselineDbm,model,surfaceList,band,scale,crossLoss,baseDbm){
    let sum=Math.pow(10,(baseDbm-baselineDbm)/10),count=0,strongest=null;
    for(const s of surfaceList){
      const ray=path(source,point,s);if(!ray)continue;
      const reflect=coefficient(s.material,band,ray.angle);if(reflect.power<.0001)continue;
      const before=toward(source,ray.hit,7),after=toward(point,ray.hit,7);
      const walls=crossLoss(source,before,model)+crossLoss(point,after,model);
      const loss=20*Math.log10(Math.max(1,ray.distance/scale))+walls;
      const contribution=reflect.power*Math.pow(10,-loss/10);
      if(contribution<1e-12)continue;
      sum+=contribution;count++;
      if(!strongest||contribution>strongest.contribution)strongest={surface:s,ray,contribution,reflect};
    }
    return {dbm:Math.max(-110,Math.min(0,baselineDbm+10*Math.log10(sum))),count,strongest};
  }
  function predictTwo(point,source,baselineDbm,model,surfaceList,band,scale,crossLoss,oneBounceDbm){
    let sum=Math.pow(10,(oneBounceDbm-baselineDbm)/10),count=0;
    for(const first of surfaceList)for(const second of surfaceList){
      const ray=pathTwo(source,point,first,second);if(!ray)continue;
      const r1=coefficient(first.material,band,ray.angle1).power;
      const r2=coefficient(second.material,band,ray.angle2).power;
      if(r1*r2<.0001)continue;
      const a=toward(source,ray.hit1,7);
      const c=toward(ray.hit1,ray.hit2,7),d=toward(ray.hit2,ray.hit1,7);
      const f=toward(point,ray.hit2,7);
      const walls=crossLoss(source,a,model)+crossLoss(d,c,model)+crossLoss(f,point,model);
      const loss=20*Math.log10(Math.max(1,ray.distance/scale))+walls;
      const contribution=r1*r2*Math.pow(10,-loss/10);
      if(contribution<1e-12)continue;
      sum+=contribution;count++;
    }
    return {dbm:Math.max(-110,Math.min(0,baselineDbm+10*Math.log10(sum))),count};
  }
  return {properties:C,coefficient,surfaces,path,pathTwo,predict,predictTwo};
})();
