export class AIProvider {
  constructor(config={}) { this.provider=config.provider||'none'; this.baseUrl=config.baseUrl||''; this.model=config.model||''; this.apiKey=config.apiKey||''; }
  get enabled(){return this.provider!=='none' && Boolean(this.model);}
  get supportsTools(){return false;}
  async health(){return {ok:false,provider:this.provider,model:this.model,error:'Kein KI-Provider implementiert.'};}
  async chat(){ throw new Error('Kein KI-Provider implementiert.'); }
}

async function parseResponse(res){
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data?.error?.message || data?.error || `KI-Request fehlgeschlagen (${res.status})`);
  return data;
}

class OpenAICompatibleProvider extends AIProvider {
  constructor(config){super({...config,provider:config.provider||'openai-compatible'});}
  get supportsTools(){return true;}
  endpoint(path){
    const base=this.baseUrl.replace(/\/$/,'');
    if(base.endsWith('/v1')) return `${base}${path}`;
    if(base.endsWith('/chat/completions') && path==='/chat/completions') return base;
    return `${base}/v1${path}`;
  }
  async health(){
    try {
      if(!this.baseUrl||!this.model) return {ok:false,provider:this.provider,model:this.model,error:'AI_BASE_URL und AI_MODEL müssen gesetzt sein.'};
      const res=await fetch(this.endpoint('/models'),{headers:this.apiKey?{Authorization:`Bearer ${this.apiKey}`}:{}});
      if(!res.ok) { const data=await res.json().catch(()=>({})); throw new Error(data?.error?.message||`HTTP ${res.status}`); }
      const data=await res.json();
      const models=(data.data||[]).map(x=>x.id).filter(Boolean);
      return {ok:true,provider:this.provider,model:this.model,endpoint:this.baseUrl,models,modelAvailable:models.length===0 || models.includes(this.model),supportsTools:true};
    } catch(error){ return {ok:false,provider:this.provider,model:this.model,endpoint:this.baseUrl,error:error.message}; }
  }
  async chat(messages,{system}={}) {
    if(!this.baseUrl||!this.model) throw new Error('AI_BASE_URL und AI_MODEL müssen gesetzt sein.');
    const payload={model:this.model,messages:[...(system?[{role:'system',content:system}]:[]),...messages],temperature:0.2};
    const headers={'Content-Type':'application/json'}; if(this.apiKey) headers.Authorization=`Bearer ${this.apiKey}`;
    const data=await parseResponse(await fetch(this.endpoint('/chat/completions'),{method:'POST',headers,body:JSON.stringify(payload)}));
    return data?.choices?.[0]?.message?.content || '';
  }
}

class OllamaProvider extends AIProvider {
  constructor(config){super({...config,provider:'ollama'}); this.baseUrl=config.baseUrl||'http://127.0.0.1:11434';}
  get supportsTools(){return true;}
  async health(){
    try {
      const res=await fetch(`${this.baseUrl.replace(/\/$/,'')}/api/tags`);
      const data=await parseResponse(res);
      const models=(data.models||[]).map(x=>x.name).filter(Boolean);
      return {ok:true,provider:'ollama',model:this.model,endpoint:this.baseUrl,models,modelAvailable:models.length===0 || models.includes(this.model),supportsTools:true};
    } catch(error){ return {ok:false,provider:'ollama',model:this.model,endpoint:this.baseUrl,error:error.message}; }
  }
  async chat(messages,{system}={}) {
    if(!this.model) throw new Error('AI_MODEL muss für Ollama gesetzt sein.');
    const prompt=[...(system?[{role:'system',content:system}]:[]),...messages];
    const res=await fetch(`${this.baseUrl.replace(/\/$/,'')}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:this.model,messages:prompt,stream:false})});
    const data=await parseResponse(res); return data?.message?.content||'';
  }
}

export async function createAIProvider(overrides={}) {
  const provider=(overrides.provider ?? process.env.AI_PROVIDER ?? 'none').toLowerCase();
  const config={provider,baseUrl:overrides.baseUrl ?? process.env.AI_BASE_URL,model:overrides.model ?? process.env.AI_MODEL,apiKey:overrides.apiKey ?? process.env.AI_API_KEY};
  if(provider==='ollama') return new OllamaProvider(config);
  if(provider==='openai' || provider==='openai-compatible' || provider==='local-openai-compatible' || provider==='remote-openai-compatible') return new OpenAICompatibleProvider(config);
  return new AIProvider(config);
}
