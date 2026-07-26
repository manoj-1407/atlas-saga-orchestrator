
import { useEffect, useRef } from 'react'

export function ParticleBg() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current!; const ctx = cv.getContext('2d')!
    let W=0,H=0,pts: any[]=[],af: number
    function resize(){ W=cv.width=innerWidth; H=cv.height=innerHeight }
    addEventListener('resize',resize); resize()
    for(let i=0;i<55;i++) pts.push({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*.22,vy:(Math.random()-.5)*.22,r:Math.random()*1.1+.3})
    function frame(){
      ctx.clearRect(0,0,W,H)
      pts.forEach(p=>{ p.x+=p.vx; p.y+=p.vy; if(p.x<0||p.x>W)p.vx*=-1; if(p.y<0||p.y>H)p.vy*=-1 })
      for(let i=0;i<pts.length;i++) for(let j=i+1;j<pts.length;j++){
        const dx=pts[i].x-pts[j].x,dy=pts[i].y-pts[j].y,d=Math.sqrt(dx*dx+dy*dy)
        if(d<120){ctx.beginPath();ctx.strokeStyle=`rgba(99,102,241,${.06*(1-d/120)})`;ctx.lineWidth=.5;ctx.moveTo(pts[i].x,pts[i].y);ctx.lineTo(pts[j].x,pts[j].y);ctx.stroke()}
      }
      pts.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle='rgba(99,102,241,.28)';ctx.fill()})
      af=requestAnimationFrame(frame)
    }
    frame()
    return ()=>{ cancelAnimationFrame(af); removeEventListener('resize',resize) }
  },[])
  return <canvas ref={ref} style={{position:'fixed',inset:0,zIndex:0,pointerEvents:'none',opacity:.35}}/>
}
