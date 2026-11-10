// Dev-only, same-origin page. Do not import the test harness: it writes a fake key
// and a design named "original". Do not import start.js or install native roots.
const $=id=>document.getElementById(id);
const keyboard="Create a QWERTY keyboard with a message display, separate rows of letters, Space, Backspace, Clear, and Speak. Tapping letters and Space updates the display. Backspace removes one character. Clear empties it. Speak speaks the current nonempty message only when pressed; typing must not speak.";
const codes=new Set(["auth","no-key","network","rate-limit","daily-limit","request-size","tool-call","bad-response","http"]);
let running=false,controller=null,stopRequested=false,batch=null;
const archives=new Map();

async function main(){
  if(!import.meta.env.DEV || !["localhost","127.0.0.1","[::1]"].includes(location.hostname))throw new Error("development-only");

  // Defense in depth, limited to this browsing context. Native imports open the
  // existing DB connection; this page permits reads but refuses every write.
  // Never restore these methods: the runner must stay read-only for its lifetime.
  const deny=()=>{throw new Error("Benchmark page cannot write IndexedDB.");};
  const transaction=IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction=function(stores,mode="readonly",...rest){
    if(mode!=="readonly")return deny();
    return transaction.call(this,stores,mode,...rest);
  };
  for(const name of ["add","put","delete","clear"])IDBObjectStore.prototype[name]=deny;
  for(const name of ["update","delete"])IDBCursor.prototype[name]=deny;
  for(const name of ["createObjectStore","deleteObjectStore"])IDBDatabase.prototype[name]=deny;
  IDBFactory.prototype.deleteDatabase=deny;

  await import("@ungap/custom-elements");
  // Match the ordinary entry point's foundational module order; the native
  // component registry has existing Data/evaluator/TreeBase import cycles.
  const {Messages}=await import("/OS-DPI-1/components/errors.js");
  const {Data}=await import("/OS-DPI-1/data.js");
  const {State}=await import("/OS-DPI-1/state.js");
  await import("/OS-DPI-1/components/index.js");
  const [{default:Globals},{authorInterface,MODELS},native,
    {aiToolTurn},{createDiagnostics,diagnosticFingerprint},{SECTIONS},{zipSync,strToU8},{fileSaveLegacy:downloadFile}]=await Promise.all([
    import("/OS-DPI-1/globals.js"),
    import("/OS-DPI-1/components/ai/authoring-agent.js"),import("/OS-DPI-1/components/ai/authoring-native.js"),
    import("/OS-DPI-1/components/ai/authoring-transport.js"),import("/OS-DPI-1/components/ai/authoring-diagnostics.js"),
    import("/OS-DPI-1/components/ai/authoring-document.js"),import("fflate"),import("browser-fs-access"),
  ]);
  // No persistent state key, listeners, design tree, runtime methods, or notes.
  Globals.state=new State();Globals.data=new Data([]);Globals.error=new Messages();
  for(const [id,label]of MODELS){const option=document.createElement("option");option.value=id;option.textContent=label;$("model").append(option);}
  $("request").value=keyboard;
  $("settings").disabled=false;$("start").disabled=false;
  $("status").textContent="Ready. Requests use the saved Groq key through the existing transport; the runner never reads or displays it.";
  $("task").addEventListener("change",()=>{$("request").value=$("task").value==="keyboard"?keyboard:"";});

  function draw(record,pre){
    pre.textContent=JSON.stringify(record,null,2);
  }
  function controls(){
    $("settings").disabled=running;$("start").disabled=running;$("stop").disabled=!running;
    $("download").disabled=running||!batch;
  }
  $("stop").addEventListener("click",()=>{
    stopRequested=true;controller?.abort();$("status").textContent="Stopping the current attempt; completed evidence will remain available.";
  });
  $("form").addEventListener("submit",async event=>{
    event.preventDefault();if(running)return;
    const request=$("request").value.trim(),model=$("model").value,count=Number($("attempts").value),includeBoardText=$("payloads").checked,temperature=Number($("temperature").value),reasoningEffort=$("effort").value;
    if(!request||!Number.isInteger(count)||count<1||count>5||!Number.isFinite(temperature)||temperature<0||temperature>2)return;
    running=true;stopRequested=false;archives.clear();$("results").replaceChildren();
    batch={version:1,source:"real Groq via existing aiToolTurn",model,temperature,reasoningEffort,task:$("task").value,requestedAttempts:count,
      requestFingerprint:diagnosticFingerprint(request),started:new Date().toISOString(),
      ordinaryPreview:"not-run",persistence:"none; this tab refuses IndexedDB writes",attempts:[]};
    if(includeBoardText){
      const scrub=createDiagnostics({model,mode:"new",request,includeBoardText:true});
      scrub.record({stage:"request",details:{request}});batch.request=scrub.report.events[0].details.request;
    }
    controls();
    try{
      for(let i=1;i<=count&&!stopRequested;i++){
        Globals.state=new State();Globals.data=new Data([]);Globals.error=new Messages();
        const session=native.documentSession(native.emptyNative());
        const diagnostic=createDiagnostics({model,mode:"new",selected:null,request,includeBoardText});
        const record={attempt:i,outcome:"running",ordinaryPreview:"not-run",diagnostic:diagnostic.report};
        batch.attempts.push(record);
        const article=document.createElement("article"),heading=document.createElement("h2"),pre=document.createElement("pre");
        heading.textContent=`Attempt ${i} of ${count}`;article.append(heading,pre);$("results").append(article);draw(record,pre);
        controller=new AbortController();let timedOut=false;
        const timeout=setTimeout(()=>{timedOut=true;controller?.abort();},480000);
        try{
          const result=await authorInterface({session,request,model,requireVisible:true,signal:controller.signal,turn:args=>aiToolTurn({...args,temperature,reasoningEffort}),
            onProgress:message=>{$("status").textContent=`Attempt ${i}/${count}: ${message}`;},
            onDiagnostic:event=>{diagnostic.record(event);draw(record,pre);}});
          if(controller.signal.aborted)throw new DOMException("Cancelled","AbortError");
          if(result.question){record.outcome="needs-input";record.usage=result.usage;}
          else if(result.accepted&&result.design){
            const checks=native.exercise(session,[{name:"Native initial actions",steps:[],expect:{}},
              ...(session.nativeTests||[]),...native.keyboardIntentTests(session,request)]);
            const surface=native.reviewNativePresentation(session,{requireVisible:true});
            record.nativeChecks=checks.map(({name,ok})=>({name,ok}));record.surface=surface.summary;
            record.usage=result.usage;record.audit=result.audit;record.effectCount=result.checked.effects.length;
            record.designFingerprint=diagnosticFingerprint(native.fingerprint(result.design));
            if(!surface.ok||checks.some(test=>!test.ok))record.outcome="native-check-failed";
            else{
              record.outcome="draft-ready";
              record.archive=`drafts/${model.replace(/[^a-z0-9_-]/gi,"-")}-attempt-${i}.osdpi`;
              archives.set(record.archive,zipSync(Object.fromEntries(SECTIONS.map(section=>[`${section}.json`,strToU8(JSON.stringify(result.design[section]))]))));
            }
          }else record.outcome="failed";
        }catch(error){
          record.outcome=timedOut?"timeout":controller.signal.aborted?"cancelled":"failed";
          record.code=codes.has(error.kind)?error.kind:"authoring";
          // Provider exception messages can contain raw request text. Retain a
          // fixed error classification; diagnostics retain safe per-call data.
          diagnostic.record({stage:"failure",code:record.code});
          if(["auth","no-key","daily-limit"].includes(record.code))stopRequested=true;
        }finally{
          clearTimeout(timeout);diagnostic.finish(record.outcome);controller=null;
          const provider=diagnostic.report.events.filter(e=>e.stage==="provider");
          record.measuredUsage={requests:diagnostic.report.events.filter(e=>e.stage==="request").length,
            promptTokens:provider.reduce((sum,e)=>sum+(e.promptTokens||0),0),
            completionTokens:provider.reduce((sum,e)=>sum+(e.completionTokens||0),0),
            cachedTokens:provider.reduce((sum,e)=>sum+(e.cachedTokens||0),0)};
          draw(record,pre);
        }
      }
    }finally{
      running=false;batch.finished=new Date().toISOString();batch.stopped=stopRequested;controls();
      $("status").textContent=`Batch finished: ${archives.size}/${batch.attempts.length} drafts passed isolated checks. Download evidence, then verify each draft in ordinary Preview.`;
    }
  });
  $("download").addEventListener("click",async()=>{
    if(running||!batch)return;
    const entries=Object.fromEntries(archives);
    entries["evidence.json"]=strToU8(JSON.stringify(batch,null,2));
    entries["README.txt"]=strToU8("Real Groq generation, existing OS-DPI authoring engine. Draft-ready means isolated native validation only. No native Preview was run, no design was installed, and no original design was saved or changed. Import each six-section draft into the ordinary app, test initial state and requested controls at desktop/tablet sizes, verify speech timing where requested, and export/reimport. Record those outcomes separately. Failed attempts have diagnostics but no claimed successful archive. API keys and authorization headers are never exported. Optional tool payloads contain submitted/generated board text.\n");
    const filename=`osdpi-live-benchmark-${batch.model.replace(/[^a-z0-9_-]/gi,"-")}-${batch.started.replace(/[:.]/g,"-")}.zip`;
    try{await downloadFile(new Blob([zipSync(entries)],{type:"application/zip"}),{fileName:filename});}
    catch{$("status").textContent="Download did not complete. Evidence remains in this tab; try Download again.";}
  });
}
main().catch(()=>{$("status").textContent="Runner could not start. Use the local Vite development server on the same origin as your configured app. No batch was started.";});
