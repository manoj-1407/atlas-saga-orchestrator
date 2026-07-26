
import { useEffect, useRef, useState } from 'react'

const LINES = [
  ['Connecting to PostgreSQL','ok'],['Loading workflow engine','ok'],
  ['Registering E-commerce Checkout','ok'],['Registering KYC Verification','ok'],
  ['Registering Loan Disbursement','ok'],['Starting WebSocket notifier','ok'],
  ['Atlas platform ready','ok'],
]

export function Boot({ onDone }: { onDone: () => void }) {
  const [shown, setShown] = useState<number[]>([])
  const [progress, setProgress] = useState(0)
  const [out, setOut] = useState(false)
  const done = useRef(false)

  useEffect(() => {
    let i = 0
    const t = setInterval(() => {
      if (i < LINES.length) { setShown(v=>[...v,i]); setProgress(Math.round((i+1)/LINES.length*100)); i++ }
      else { clearInterval(t); if(!done.current){ done.current=true; setTimeout(()=>{ setOut(true); setTimeout(onDone,650) },500) } }
    }, 130)
    return () => clearInterval(t)
  }, [])

  return (
    <div style={{ position:'fixed',inset:0,zIndex:9999,background:'#03050a',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:32,
      transition:'opacity .65s,transform .65s', opacity:out?0:1, transform:out?'scale(1.03)':'none', pointerEvents:out?'none':'all' }}>

      <svg className="animate-spin-slow" style={{width:88,height:88}} viewBox="0 0 88 88">
        <polygon points="44,4 80,24 80,64 44,84 8,64 8,24" fill="none" stroke="#6366f1" strokeWidth="1.5" opacity=".25"/>
        <polygon points="44,14 70,29 70,59 44,74 18,59 18,29" fill="none" stroke="#6366f1" strokeWidth="1.5" opacity=".5"/>
        <polygon points="44,24 60,34 60,54 44,64 28,54 28,34" fill="none" stroke="#00ff94" strokeWidth="1" opacity=".7"/>
        <circle cx="44" cy="44" r="8" fill="none" stroke="#00ff94" strokeWidth="2"/>
        <circle cx="44" cy="44" r="3" fill="#6366f1"/>
      </svg>

      <div style={{width:340,display:'flex',flexDirection:'column',gap:5}}>
        {LINES.map(([msg,s],i)=>(
          <div key={i} style={{fontFamily:'JetBrains Mono,monospace',fontSize:11,color:'#e2e8f0',display:'flex',justifyContent:'space-between',
            transition:'opacity .25s,transform .25s',opacity:shown.includes(i)?1:0,transform:shown.includes(i)?'none':'translateX(-6px)'}}>
            <span><span style={{color:'#34d399'}}>▸</span> {msg}</span>
            <span style={{color:'#34d399'}}>[{s}]</span>
          </div>
        ))}
      </div>

      <div style={{width:340,height:2,background:'rgba(99,102,241,.12)',borderRadius:1,overflow:'hidden'}}>
        <div style={{height:'100%',borderRadius:1,transition:'width .12s linear',width:progress+'%',background:'linear-gradient(90deg,#6366f1,#34d399)'}}/>
      </div>

      <div style={{fontFamily:'Space Grotesk,sans-serif',fontWeight:700,fontSize:22,letterSpacing:6,color:'rgba(255,255,255,0.06)',textTransform:'uppercase'}}>
        Atlas
      </div>
    </div>
  )
}
