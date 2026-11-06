const BUILTIN_MODULES = [
  { id:'welcome', name:'Welcome', description:'Willkommenssystem' },
  { id:'moderation', name:'Moderation', description:'Moderation und Sicherheitsfunktionen' },
  { id:'reactionRoles', name:'Reaction Roles', description:'Rollen über Reaktionen' },
  { id:'onboarding', name:'Onboarding', description:'Discord Community Onboarding' },
  { id:'releases', name:'Releases', description:'GitHub Release-Automation' },
  { id:'analytics', name:'Analytics', description:'Community-Kennzahlen' },
  { id:'tickets', name:'Tickets', description:'Support-Tickets' },
  { id:'automod', name:'AutoMod', description:'Discord AutoMod-Verwaltung' },
  { id:'ai', name:'AI Assistant', description:'KI-Assistent mit kontrollierten Werkzeugen' },
];
export class ModuleManager {
  constructor(db) { this.db=db; this.modules=new Map(BUILTIN_MODULES.map(m=>[m.id,m])); }
  list(guildId) { const configured=new Map(this.db.listModules(guildId).map(m=>[m.moduleId,m])); return [...this.modules.values()].map(m=>({...m,enabled:configured.has(m.id)?configured.get(m.id).enabled:true,config:configured.get(m.id)?.config||{}})); }
  set(guildId,id,enabled,config={}) { if(!this.modules.has(id)) throw new Error(`Unbekanntes Modul: ${id}`); this.db.setModule(guildId,id,enabled,config); return this.list(guildId); }
}
