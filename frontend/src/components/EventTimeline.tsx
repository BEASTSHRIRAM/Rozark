import type { SessionEvent } from "@/lib/types";
export default function EventTimeline({events}:{events:SessionEvent[]}){
  if(!events.length) return <p className="text-sm text-gray-400">No session events recorded yet.</p>;
  const ordered=[...events].sort((a,b)=>(a.seq??a.sequence)-(b.seq??b.sequence));
  return <ol className="space-y-2">{ordered.map(e=>(<li key={e.id} id={e.id} className="rounded border border-white/10 bg-inkpanel p-3"><span className="font-mono text-xs text-cobaltlt">#{e.seq??e.sequence} {e.type}</span>{e.actor?<span className="ml-2 font-mono text-xs text-paper/45">{e.actor}</span>:null}{e.ts?<span className="ml-2 font-mono text-xs text-paper/35">{e.ts}</span>:null}<pre className="mt-1 overflow-auto text-xs text-paper/75">{JSON.stringify(e.payload,null,2)}</pre></li>))}</ol>;
}
