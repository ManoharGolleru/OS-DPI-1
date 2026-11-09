/** Bounded views into the native document. Full objects remain available by ref. */
export function compactSchemas(catalog,names,{help=false}={}) {
  return Object.fromEntries(names.filter(n=>catalog[n]).map(name=>[name,{
    description:catalog[name].description,
    children:catalog[name].children,
    props:Object.fromEntries(Object.entries(catalog[name].props).map(([k,p])=>[k,[
      p.expression?"expression":p.kind || p.type,
      p.choices?`one of ${p.choices.map(v=>JSON.stringify(v)).join(',')}`:'',
      p.default!==""&&k!=="Key"&&k!=="voiceURI"?`default ${JSON.stringify(p.default)}`:'',
      p.min!==undefined?`min ${p.min}`:'',p.max!==undefined?`max ${p.max}`:'',
      p.generated?'generated':'',p.exclusiveGroup?`exclusive group ${p.exclusiveGroup}`:'',
      help?p.about?.slice(0,100):'',
    ].filter(Boolean).join('; ')])),
  }]));
}

export function describeForModel(session,item,{depth=1,offset=0,limit=20,brief=false}={}) {
  limit=Math.max(1,Math.min(100,limit));offset=Math.max(0,offset);
  if(!item.className)return session.describe(item);
  const children=item.children || [];
  const props=brief?Object.fromEntries(Object.entries(item.props||{}).filter(([,v])=>typeof v!=="string"||v.length<=240)):item.props;
  const omittedProps=brief?Object.keys(item.props||{}).filter(k=>!(k in props)):[];
  const result={ref:item._ref,className:item.className,props,totalChildren:children.length,...(omittedProps.length?{omittedProps}: {})};
  if(depth>0)result.children=children.slice(offset,offset+limit).map(n=>describeForModel(session,n,{depth:depth-1,limit,brief}));
  return result;
}

export function requestContext(session,{request,selected,history,round,rounds}) {
  const shallow=item=>({ref:item._ref,className:item.className,...(item.props?.name?{name:String(item.props.name).slice(0,120)}:{}),
    ...(item.props?.Name?{name:String(item.props.Name).slice(0,120)}:{}),...(item.props?.Key?{key:String(item.props.Key).slice(0,120)}:{}),
    ...(item.props?.Active!==undefined?{active:item.props.Active}:{}),children:item.children?.length || 0});
  const outline=Object.fromEntries(Object.entries(session.design).filter(([s])=>s!=="content"&&s!=="layout").map(([s,root])=>[s,{
    ...shallow(root),items:root.children.slice(0,12).map(shallow),
  }]));
  const selection=selected&&session.refs.has(selected)?describeForModel(session,session.find(selected),{depth:1,limit:8,brief:true}):null;
  const stateLinks=[...session.refs.values()].filter(n=>session.parents.get(n._ref)?.section==="layout"&&n.props?.stateName).slice(0,16)
    .map(n=>({ref:n._ref,className:n.className,state:n.props.stateName}));
  const access=session.design.method.children.slice(0,6).map(n=>({ref:n._ref,name:n.props.Name,active:n.props.Active,pattern:n.props.Pattern,
    events:n.children.filter(c=>/Handler$/.test(c.className)).slice(0,5).map(c=>c.props.Signal),
    timers:n.children.filter(c=>c.className==="Timer").map(c=>({ref:c._ref,key:c.props.Key,seconds:c.props.Interval}))}));
  return {request,selected,selection,previousRequests:history.slice(-2).map(h=>({request:String(h.request||"").slice(0,300),changes:String(h.changes||"").slice(0,300)})),outline,
    page:describeForModel(session,session.find("page"),{depth:1,limit:12,brief:true}),
    content:{count:session.design.content.length},media:{count:session.mediaNames.size,sample:[...session.mediaNames].slice(0,8)},stateLinks,access,
    availableComponents:Object.keys(session.catalog),turn:round+1,turnsRemaining:rounds-round};
}
