import { useEffect, useMemo, useRef, useState } from 'react'
import { Focus, Maximize2, Network, Search, SlidersHorizontal, ZoomIn, ZoomOut } from 'lucide-react'
import type { BrainConversation, BrainMessage, BrainSource, FleetItem } from '../types'

type NodeKind = 'root'|'machine'|'conversation'|'source'
type GraphNode = { id:string; label:string; kind:NodeKind; detail:string; x:number; y:number; vx:number; vy:number; degree:number }
type GraphEdge = { from:string; to:string; strength:number }
const hash=(value:string)=>[...value].reduce((total,character)=>((total<<5)-total)+character.charCodeAt(0),0)

export function KnowledgeGraph({ fleet, conversations, messages }: { fleet:FleetItem[]; conversations:BrainConversation[]; messages:BrainMessage[] }) {
  const canvasRef=useRef<HTMLCanvasElement>(null),containerRef=useRef<HTMLDivElement>(null)
  const nodesRef=useRef<GraphNode[]>([]),viewRef=useRef({x:0,y:0,zoom:.78})
  const simulationRef=useRef(0),signatureRef=useRef('')
  const pointerRef=useRef<{x:number;y:number;node?:GraphNode;panX:number;panY:number}|null>(null)
  const hoverRef=useRef<GraphNode|null>(null)
  const [selected,setSelected]=useState<GraphNode|null>(null),[query,setQuery]=useState(''),[localOnly,setLocalOnly]=useState(false),[settings,setSettings]=useState(false)
  const [kinds,setKinds]=useState<Record<NodeKind,boolean>>({root:true,machine:true,conversation:true,source:true})
  const machineSignature=fleet.map(item=>`${item.machine.machine_id}:${item.machine.display_name}:${item.machine.metadata?.layout_x}:${item.machine.metadata?.layout_y}`).join('|')
  const machines=useMemo(()=>fleet.map(item=>item.machine),[machineSignature])
  const sources=useMemo(()=>{const map=new Map<string,BrainSource>();messages.forEach(message=>message.metadata?.sources?.forEach(source=>map.set(source.id||`${source.title}-${source.source_type}`,source)));return [...map.values()].slice(0,24)},[messages])
  const fullGraph=useMemo(()=>{
    const nodes:GraphNode[]=[{id:'root',label:'Company memory',kind:'root',detail:'Verified operational knowledge',x:0,y:0,vx:0,vy:0,degree:0}],edges:GraphEdge[]=[]
    const add=(id:string,label:string,kind:NodeKind,detail:string,index:number,total:number)=>{const angle=index/Math.max(total,1)*Math.PI*2+(Math.abs(hash(id))%32)/48,radius=kind==='machine'?150:kind==='conversation'?250:340;nodes.push({id,label,kind,detail,x:Math.cos(angle)*radius,y:Math.sin(angle)*radius,vx:0,vy:0,degree:0})}
    const ordered=[...machines].sort((a,b)=>(a.metadata?.layout_x||0)-(b.metadata?.layout_x||0))
    machines.forEach((machine,index)=>{const id=`machine:${machine.machine_id}`;add(id,machine.display_name,'machine',machine.metadata?.operation||machine.machine_type.replaceAll('_',' '),index,machines.length)})
    ordered.forEach((machine,index)=>{if(index)edges.push({from:`machine:${ordered[index-1].machine_id}`,to:`machine:${machine.machine_id}`,strength:.55})})
    if(ordered[0])edges.push({from:'root',to:`machine:${ordered[0].machine_id}`,strength:.42})
    if(ordered.length>2)edges.push({from:'root',to:`machine:${ordered.at(-1)!.machine_id}`,strength:.34})
    conversations.slice(0,18).forEach((conversation,index)=>{const id=`conversation:${conversation.id}`,parent=conversation.machine_id&&machines.some(machine=>machine.machine_id===conversation.machine_id)?`machine:${conversation.machine_id}`:'root';add(id,conversation.title,'conversation',conversation.machine_id||'Fleet conversation',index,Math.min(conversations.length,18));edges.push({from:parent,to:id,strength:.7})})
    sources.forEach((source,index)=>{const id=`source:${source.id||index}`,parent=source.machine_id&&machines.some(machine=>machine.machine_id===source.machine_id)?`machine:${source.machine_id}`:'root';add(id,source.title,'source',source.source_type.replaceAll('_',' '),index,sources.length);edges.push({from:parent,to:id,strength:Math.max(.35,source.score||.5)})})
    edges.forEach(edge=>{const a=nodes.find(node=>node.id===edge.from),b=nodes.find(node=>node.id===edge.to);if(a)a.degree++;if(b)b.degree++})
    return {nodes,edges}
  },[machines,conversations,sources])
  const graph=useMemo(()=>{
    let nodeIds=new Set(fullGraph.nodes.filter(node=>kinds[node.kind]).map(node=>node.id))
    if(localOnly&&selected){const neighbors=new Set([selected.id]);fullGraph.edges.forEach(edge=>{if(edge.from===selected.id)neighbors.add(edge.to);if(edge.to===selected.id)neighbors.add(edge.from)});nodeIds=new Set([...nodeIds].filter(id=>neighbors.has(id)))}
    return {nodes:fullGraph.nodes.filter(node=>nodeIds.has(node.id)),edges:fullGraph.edges.filter(edge=>nodeIds.has(edge.from)&&nodeIds.has(edge.to))}
  },[fullGraph,kinds,localOnly,selected?.id])
  useEffect(()=>{const previous=new Map(nodesRef.current.map(node=>[node.id,node])),signature=`${graph.nodes.map(node=>node.id).join('|')}::${graph.edges.map(edge=>`${edge.from}>${edge.to}`).join('|')}`;nodesRef.current=graph.nodes.map(node=>{const old=previous.get(node.id);return old?{...node,x:old.x,y:old.y,vx:old.vx,vy:old.vy}:{...node}});if(signature!==signatureRef.current){simulationRef.current=0;signatureRef.current=signature}},[graph])

  useEffect(()=>{
    const canvas=canvasRef.current,container=containerRef.current;if(!canvas||!container)return
    const context=canvas.getContext('2d');if(!context)return
    let frame=0
    const render=()=>{
      const rect=container.getBoundingClientRect(),scale=Math.min(devicePixelRatio||1,2),style=getComputedStyle(container)
      if(canvas.width!==Math.round(rect.width*scale)||canvas.height!==Math.round(rect.height*scale)){canvas.width=Math.round(rect.width*scale);canvas.height=Math.round(rect.height*scale);canvas.style.width=`${rect.width}px`;canvas.style.height=`${rect.height}px`}
      context.setTransform(scale,0,0,scale,0,0);context.clearRect(0,0,rect.width,rect.height)
      const nodes=nodesRef.current,byId=new Map(nodes.map(node=>[node.id,node])),hovered=hoverRef.current,focus=selected||hovered
      if(!pointerRef.current?.node&&simulationRef.current<150){
        for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j],dx=a.x-b.x,dy=a.y-b.y,dist=Math.max(34,Math.hypot(dx,dy)),force=500/(dist*dist);a.vx+=dx/dist*force;b.vx-=dx/dist*force;a.vy+=dy/dist*force;b.vy-=dy/dist*force}
        graph.edges.forEach(edge=>{const a=byId.get(edge.from),b=byId.get(edge.to);if(!a||!b)return;const dx=b.x-a.x,dy=b.y-a.y,dist=Math.max(1,Math.hypot(dx,dy)),target=a.kind==='root'?155:125,force=(dist-target)*.00065*edge.strength;a.vx+=dx*force;b.vx-=dx*force;a.vy+=dy*force;b.vy-=dy*force})
        nodes.forEach(node=>{if(node.kind==='root'){node.x=0;node.y=0;return}node.vx+=-node.x*.00003;node.vy+=-node.y*.00003;node.vx*=.88;node.vy*=.88;node.x+=node.vx;node.y+=node.vy});simulationRef.current++
      }
      const view=viewRef.current,toScreen=(node:GraphNode)=>({x:rect.width/2+view.x+node.x*view.zoom,y:rect.height/2+view.y+node.y*view.zoom})
      const connected=new Set<string>();if(focus){connected.add(focus.id);graph.edges.forEach(edge=>{if(edge.from===focus.id)connected.add(edge.to);if(edge.to===focus.id)connected.add(edge.from)})}
      graph.edges.forEach(edge=>{const a=byId.get(edge.from),b=byId.get(edge.to);if(!a||!b)return;const p1=toScreen(a),p2=toScreen(b),active=!focus||(connected.has(a.id)&&connected.has(b.id));context.beginPath();context.moveTo(p1.x,p1.y);context.lineTo(p2.x,p2.y);context.lineWidth=active?Math.max(1,1.7*edge.strength):.6;context.strokeStyle=active?style.getPropertyValue('--graph-edge-active').trim()||'rgba(92,225,189,.38)':style.getPropertyValue('--graph-edge').trim()||'rgba(100,130,140,.12)';context.stroke()})
      const term=query.trim().toLowerCase()
      nodes.forEach(node=>{const point=toScreen(node),match=!term||`${node.label} ${node.detail}`.toLowerCase().includes(term),active=!focus||connected.has(node.id),base=node.kind==='root'?10:node.kind==='machine'?7:4.5,radius=(base+Math.min(node.degree,5)*.7)*Math.max(.78,view.zoom),colors={root:'--graph-root',machine:'--graph-machine',conversation:'--graph-conversation',source:'--graph-source'},color=style.getPropertyValue(colors[node.kind]).trim()||'#5ce1bd',opacity=match&&active?1:match?.28:.12;context.globalAlpha=opacity*.13;context.beginPath();context.arc(point.x,point.y,radius+6,0,Math.PI*2);context.fillStyle=color;context.fill();context.globalAlpha=opacity;context.beginPath();context.arc(point.x,point.y,radius,0,Math.PI*2);context.fillStyle=color;context.fill();if(selected?.id===node.id||hovered?.id===node.id){context.beginPath();context.arc(point.x,point.y,radius+8,0,Math.PI*2);context.lineWidth=1.5;context.strokeStyle=color;context.stroke()}if(view.zoom>.58&&match){context.font=`${node.kind==='root'?'600 13':'500 11'}px Geist Variable, sans-serif`;context.fillStyle=style.getPropertyValue('--graph-label').trim()||'#dce7e8';context.textAlign='left';context.textBaseline='middle';context.fillText(node.label,point.x+radius+8,point.y)}context.globalAlpha=1})
      frame=requestAnimationFrame(render)
    };frame=requestAnimationFrame(render);return()=>cancelAnimationFrame(frame)
  },[graph,query,selected])
  const screenNode=(clientX:number,clientY:number)=>{const rect=containerRef.current!.getBoundingClientRect(),view=viewRef.current;return nodesRef.current.map(node=>({node,distance:Math.hypot(clientX-rect.left-(rect.width/2+view.x+node.x*view.zoom),clientY-rect.top-(rect.height/2+view.y+node.y*view.zoom))})).sort((a,b)=>a.distance-b.distance)[0]}
  const zoom=(factor:number)=>{viewRef.current.zoom=Math.max(.4,Math.min(2.4,viewRef.current.zoom*factor))},reset=()=>{viewRef.current={x:0,y:0,zoom:.78};setSelected(null);setLocalOnly(false)}
  return <div ref={containerRef} className="knowledge-graph premium-knowledge-graph" onWheel={event=>{event.preventDefault();zoom(event.deltaY>0?.9:1.1)}} onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);const hit=screenNode(event.clientX,event.clientY);pointerRef.current={x:event.clientX,y:event.clientY,node:hit?.distance<18?hit.node:undefined,panX:viewRef.current.x,panY:viewRef.current.y};if(hit?.distance<18)setSelected(hit.node)}} onPointerMove={event=>{const hit=screenNode(event.clientX,event.clientY);hoverRef.current=hit?.distance<18?hit.node:null;const pointer=pointerRef.current;if(!pointer)return;if(pointer.node){pointer.node.x+=(event.clientX-pointer.x)/viewRef.current.zoom;pointer.node.y+=(event.clientY-pointer.y)/viewRef.current.zoom;pointer.x=event.clientX;pointer.y=event.clientY}else{viewRef.current.x=pointer.panX+event.clientX-pointer.x;viewRef.current.y=pointer.panY+event.clientY-pointer.y}}} onPointerLeave={()=>{hoverRef.current=null}} onPointerUp={()=>{pointerRef.current=null}}>
    <canvas ref={canvasRef}/>
    <div className="graph-toolbar"><span><Network size={14}/>Knowledge network</span><label><Search size={13}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Find a node"/></label><button className={localOnly?'active':''} disabled={!selected} onClick={()=>setLocalOnly(value=>!value)} title="Show local graph"><Focus size={13}/></button><button onClick={()=>setSettings(value=>!value)} title="Graph filters"><SlidersHorizontal size={13}/></button></div>
    <div className="graph-zoom"><button onClick={()=>zoom(1.18)} aria-label="Zoom in"><ZoomIn size={14}/></button><button onClick={()=>zoom(.84)} aria-label="Zoom out"><ZoomOut size={14}/></button><button onClick={reset} aria-label="Reset graph"><Maximize2 size={14}/></button></div>
    {settings&&<div className="graph-settings"><strong>Visible groups</strong>{(['machine','conversation','source'] as NodeKind[]).map(kind=><label key={kind}><input type="checkbox" checked={kinds[kind]} onChange={()=>setKinds(current=>({...current,[kind]:!current[kind]}))}/><i className={kind}/><span>{kind}s</span></label>)}<small>Select a node, then use focus to see its local graph.</small></div>}
    <div className="graph-legend"><span><i className="machine"/>Machine</span><span><i className="conversation"/>Conversation</span><span><i className="source"/>Evidence</span></div>
    {selected&&<div className="graph-selection"><small>{selected.kind} · {selected.degree} connections</small><strong>{selected.label}</strong><p>{selected.detail}</p><button onClick={()=>setLocalOnly(value=>!value)}>{localOnly?'Show full network':'Focus neighborhood'}</button></div>}
  </div>
}
