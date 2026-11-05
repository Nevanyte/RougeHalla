// Browser-side observer. CPU means synchronous RAF callback time, not Unity PlayerLoop or total browser CPU.
(() => {
 const p=window.__rhProfile={frames:[],gpuMs:[],gpuDisjoint:0,buffersCreated:0,buffersDeleted:0,contexts:[],wasmMemories:[]};
 let gl=null,ext=null,pending=[],draws=0,instances=0,last=null,active=false;
 const get=HTMLCanvasElement.prototype.getContext;
 HTMLCanvasElement.prototype.getContext=function(type,...args){const g=get.call(this,type,...args);if(g&&type==='webgl2'&&this.id==='unity-canvas'&&!gl){gl=g;ext=g.getExtension('EXT_disjoint_timer_query_webgl2');const dbg=g.getExtension('WEBGL_debug_renderer_info');p.contexts.push({timerQuery:!!ext,renderer:dbg?g.getParameter(dbg.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER),width:this.width,height:this.height});
 for(const name of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']){const fn=g[name];g[name]=function(...a){draws++;instances+=name.endsWith('Instanced')?a[a.length-1]:1;return fn.apply(g,a)}}
 for(const [name,key] of [['createBuffer','buffersCreated'],['deleteBuffer','buffersDeleted']]){const fn=g[name];g[name]=function(...a){p[key]++;return fn.apply(g,a)}}
 }return g};
 const Memory=WebAssembly.Memory;
 const collect=result=>{const instance=result.instance||result;if(instance?.exports)for(const value of Object.values(instance.exports))if(value instanceof Memory&&!p.wasmMemories.includes(value))p.wasmMemories.push(value);return result};
 for(const name of ['instantiate','instantiateStreaming']){const fn=WebAssembly[name];if(fn)WebAssembly[name]=function(...args){return fn.apply(WebAssembly,args).then(collect)}}
WebAssembly.Memory=new Proxy(Memory,{construct(t,args){const m=Reflect.construct(t,args);p.wasmMemories.push(m);return m}});
 const raf=window.requestAnimationFrame.bind(window);
 window.requestAnimationFrame=function(fn){return raf(function(ts){if(active)return fn(ts);active=true;let q=null;
 if(gl&&ext){const disjoint=gl.getParameter(ext.GPU_DISJOINT_EXT);if(disjoint)p.gpuDisjoint++;while(pending.length&&gl.getQueryParameter(pending[0],gl.QUERY_RESULT_AVAILABLE)){const old=pending.shift();if(!disjoint)p.gpuMs.push(gl.getQueryParameter(old,gl.QUERY_RESULT)/1e6);gl.deleteQuery(old)}if(pending.length<16&&!gl.getQuery(ext.TIME_ELAPSED_EXT,gl.CURRENT_QUERY)){q=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,q)}}
 draws=0;instances=0;const t=performance.now();try{return fn(ts)}finally{const cpu=performance.now()-t;if(q){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push(q)}if(draws)p.frames.push({time:ts,interval:last===null?null:ts-last,cpuMs:cpu,draws,instances,jsHeap:performance.memory?.usedJSHeapSize??null,wasmBytes:p.wasmMemories.length?p.wasmMemories.reduce((n,m)=>n+m.buffer.byteLength,0):null});if(draws)last=ts;active=false;}
 })};
})();
