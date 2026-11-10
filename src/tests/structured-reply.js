// Test-only encoding of native scenario fixtures for the strict wire.
const fields=value=>Object.entries(value||{}).map(([key,value])=>({key,value}));
const states=value=>Object.entries(value||{}).map(([state,value])=>({state,value}));
export function commandReply(name,args={}) {
 let serial=0;
 const operations=(args.operations||[]).flatMap(op=>{
  if(op.op==='insert'){
   const flatten=(node,parent,index)=>{
    const ref=node.ref??(node.children?.length?`fixture-parent-${++serial}`:null);
    return [{op:'insert',parent,className:node.className,ref,props:fields(node.props),index:index??null},...(node.children||[]).flatMap(n=>flatten(n,ref))];
   };
   return op.nodes.flatMap((n,i)=>flatten(n,op.parent,op.index==null?null:op.index+i));
  }
  if(op.op==='rows')return [{op:'rows',rows:op.rows.map(fields),defaults:fields(op.defaults),index:op.index??null}];
  if(op.op==='bind')return [{op:'bind',target:op.target,mode:op.mode||'merge',rules:op.rules.map(r=>({condition:r.condition||'',updates:Object.entries(r.updates).map(([state,expression])=>({state,expression}))}))}];
  if(op.op==='update')return [{op:'update',target:op.target,props:fields(op.props),unset:op.unset||[]}];
  if(op.op==='move')return [{op:'move',target:op.target,parent:op.parent,index:op.index??null}];
  return [{op:'remove',target:op.target}];
 });
 const tests=args.tests?.map(t=>({name:t.name||'Interaction',initial:states(t.initial),expect:states(t.expect),steps:(t.steps||[]).map(s=>({target:s.target,label:s.label??null,data:fields(s.data)}))}))??null;
 const title=args.title??null,summary=args.summary??null;
 const command=name==='edit'?{name,operations,tests,title,summary}
  :name==='inspect'?{name,target:args.target??null,classes:args.classes||[],example:args.example??null,offset:args.offset??0,limit:args.limit??30,depth:args.depth??1}
  :name==='recipe'?{name,recipe:args.name,parent:args.parent??null,backspace:args.backspace??null,keyRows:args.keyRows??null,color:args.color??null,displayPosition:args.displayPosition??null,title,summary}
  :name==='check'?{name,tests}:{name,title,summary:args.summary??'',question:args.question??null};
 return {choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({command})}}],usage:{total_tokens:600}};
}
export const feedbackMessages=request=>request.messages.filter(m=>m.role==='user'&&m.content.startsWith('{')&&!('tokenBudgetRemaining' in JSON.parse(m.content)));
