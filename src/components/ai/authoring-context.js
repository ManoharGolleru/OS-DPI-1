/** Bounded views into the native document. Full objects remain available by ref. */
import {ROOTS} from "./authoring-document.js";
export function compactSchemas(catalog,names,{help=false}={}) {
  return Object.fromEntries(names.filter(n=>catalog[n]).map(name=>[name,{
    description:catalog[name].description,
    ...Object.fromEntries(Object.entries(ROOTS).filter(([,root])=>catalog[root]?.children.includes(name)).map(([section])=>["parentSection",section])),
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

/** Keep actionable edit feedback when a large batch has many similar errors.
 * Never replace a successful staged edit with an unrelated inspection error.
 */
export function compactFeedback(result,{catalog={},limit=5000}={}) {
  const size=value=>JSON.stringify(value).length;
  if(size(result)<=limit)return result;
  const error=e=>typeof e==="string"?e.slice(0,400):{ref:e.ref,key:e.key,message:String(e.message||"").slice(0,400),deferred:e.deferred};
  const short={ok:result.ok,staged:result.staged,error:result.error?.slice(0,800),instruction:result.instruction?.slice(0,600),truncated:true};
  for(const key of ["keyboard","controls","keys"])if(result[key])short[key]=result[key];
  if(result.errors?.length){short.errors=result.errors.slice(0,4).map(error);short.moreErrors=Math.max(0,result.errors.length-4);}
  else if(result.pending?.length){short.pending=result.pending.slice(0,4).map(error);short.morePending=Math.max(0,result.pending.length-4);}
  if(result.created){
    short.created=result.created.filter(n=>n.kind!=="data row"&&!["Action","ActionCondition","ActionUpdate"].includes(n.className)).slice(0,16).map(n=>({ref:n.ref,className:n.className,name:n.name===undefined?undefined:String(n.name).slice(0,80)}));
    short.createdCount=result.created.length;
  }
  if(result.interactions){
    short.tests={passed:result.interactions.filter(t=>t.ok).length,failed:result.interactions.filter(t=>!t.ok).length};
    short.interactions=result.interactions.filter(t=>!t.ok).slice(0,4).map(t=>({name:String(t.name||"").slice(0,80),ok:false,error:String(t.error||"").slice(0,400)}));
  }
  if(result.presentation)short.presentation=result.presentation.observed
    ? {summary:result.presentation.summary,observed:{initialVisibleGrids:result.presentation.observed.initialVisibleGrids.slice(0,3).map(g=>({...g,labels:g.labels.slice(0,8).map(label=>label.slice(0,60))}))}}
    : result.presentation.summary || result.presentation;
  // The requested object's values and wiring are the reason for inspecting it.
  // Reserve them before filling the response with reusable class schemas.
  if(result.object){
    short.object=result.object;
    if(size(short)>limit-500){
      const brief=n=>({ref:n.ref,parent:n.parent,className:n.className,totalChildren:n.totalChildren,
        props:Object.fromEntries(Object.entries(n.props||n.fields||{}).filter(([,v])=>typeof v!=="string"||v.length<=240)),
        omittedProps:Object.entries(n.props||n.fields||{}).filter(([,v])=>typeof v==="string"&&v.length>240).map(([key])=>key),
        ...(n.children?{children:n.children.map(brief)}:{})});
      short.object=brief(result.object);
      while(size(short)>limit-500){
        const parents=[];
        const visit=n=>{if(n.children?.length){parents.push(n);n.children.forEach(visit);}};
        visit(short.object);
        const parent=parents.at(-1);
        if(parent){parent.children.pop();parent.omittedChildren=(parent.omittedChildren||0)+1;}
        else {
          const key=Object.keys(short.object.props).at(-1);
          if(key===undefined)break;
          delete short.object.props[key];short.object.omittedProps.push(key);
        }
      }
    }
  }
  if(result.schemas){
    short.schemas={};short.omittedClasses=[];
    for(const [name,schema] of Object.entries(compactSchemas(catalog,Object.keys(result.schemas)))){
      short.schemas[name]=schema;
      if(size(short)>limit-500){delete short.schemas[name];short.omittedClasses.push(name);}
    }
  }
  if(result.example && size({...short,example:result.example})<=limit)short.example=result.example;
  if(result.content)short.content={total:result.content.total,rows:result.content.rows.slice(0,5)};
  while(size(short)>limit && short.created?.length)short.created.pop();
  if(size(short)>limit)delete short.content;
  if(size(short)>limit){for(const key of ["schemas","example","presentation"])delete short[key];short.errors=short.errors?.slice(0,2);short.pending=short.pending?.slice(0,2);short.interactions=short.interactions?.slice(0,2);}
  return short;
}

export function describeForModel(session,item,{depth=1,offset=0,limit=20,brief=false}={}) {
  limit=Math.max(1,Math.min(100,limit));offset=Math.max(0,offset);
  if(!item.className || session.parents.get(item._ref)?.section==="content")return session.describe(item);
  const children=item.children || [];
  const props=brief?Object.fromEntries(Object.entries(item.props||{}).filter(([,v])=>typeof v!=="string"||v.length<=240)):item.props;
  const omittedProps=brief?Object.keys(item.props||{}).filter(k=>!(k in props)):[];
  const result={ref:item._ref,parent:session.parents.get(item._ref)?.parent?._ref,className:item.className,props,totalChildren:children.length,...(omittedProps.length?{omittedProps}: {})};
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
  // Native selectors use stable component names, never transient editor IDs.
  // Only supply a selector when it identifies exactly this Grid.
  if(selection?.className==="Grid"){
    const name=selection.props.name;
    if(typeof name==="string" && name && name.length<=120 && /^[A-Za-z0-9 _-]+$/.test(name) && walkLayoutGrids(session).filter(n=>n.props.name===name).length===1)
      selection.cssTarget=`.grid[#ComponentName=${JSON.stringify(name)}] button:not(.grid-empty)`;
  }
  const stateLinks=[...session.refs.values()].filter(n=>session.parents.get(n._ref)?.section==="layout"&&n.props?.stateName).slice(0,16)
    .map(n=>({ref:n._ref,className:n.className,state:n.props.stateName}));
  const access=session.design.method.children.slice(0,6).map(n=>({ref:n._ref,name:n.props.Name,active:n.props.Active,pattern:n.props.Pattern,
    events:n.children.filter(c=>/Handler$/.test(c.className)).slice(0,5).map(c=>c.props.Signal),
    timers:n.children.filter(c=>c.className==="Timer").map(c=>({ref:c._ref,key:c.props.Key,seconds:c.props.Interval}))}));
  const customStyles=[...session.refs.values()].flatMap(n=>Object.entries(n.props||{}).filter(([key,value])=>session.catalog[n.className]?.props[key]?.type==="css"&&String(value).trim()).map(([property,value])=>({ref:n._ref,className:n.className,property,characters:String(value).length})));
  return {request,selected,selection,previousRequests:history.slice(-2).map(h=>({request:String(h.request||"").slice(0,300),changes:String(h.changes||"").slice(0,300)})),outline,
    page:describeForModel(session,session.find("page"),{depth:1,limit:12,brief:true}),
    content:{count:session.design.content.length},media:{count:session.mediaNames.size,sample:[...session.mediaNames].slice(0,8)},stateLinks,access,
    ...(customStyles.length?{customStyles:customStyles.slice(0,8),customStyleNote:"Existing native CSS can override appearance. Inspect these refs for visual edits; preserve unrelated rules."}:{}),
    availableComponents:Object.keys(session.catalog),turn:round+1,turnsRemaining:rounds-round};
}

function walkLayoutGrids(session){return [...session.refs.values()].filter(n=>n.className==="Grid"&&session.parents.get(n._ref)?.section==="layout");}
