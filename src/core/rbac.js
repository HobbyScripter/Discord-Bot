const DEFAULT_ROLES = Object.freeze({
  owner: ['*'],
  admin: ['community.read','community.write','users.read','users.write','security.read','security.respond','tickets.read','tickets.manage','ai.read','ai.use','ai.tools.use','ai.tools.execute','audit.read','automation.manage','rbac.read','rbac.manage'],
  security: ['community.read','users.read','security.read','security.respond','audit.read','tickets.read'],
  moderator: ['community.read','users.read','tickets.read','tickets.manage'],
  support: ['community.read','tickets.read','tickets.manage','ai.read','ai.use'],
  developer: ['community.read','audit.read','tickets.read','tickets.manage','ai.read','ai.use','ai.tools.use','ai.tools.execute'],
  viewer: ['community.read','users.read','security.read','tickets.read','audit.read','ai.read','rbac.read'],
});

const ROLE_META = Object.freeze({
  owner: ['Owner','Vollzugriff auf den Core.'], admin: ['Administrator','Verwaltet Community, Core und Berechtigungen.'],
  security: ['Security','Überwacht und bearbeitet Sicherheitsfälle.'], moderator: ['Moderator','Moderation und Ticketverwaltung.'],
  support: ['Support','Bearbeitet Support und AI-Unterstützung.'], developer: ['Developer','Technik, AI und Tooling.'], viewer: ['Viewer','Lesender Zugriff auf Community-Daten.'],
});

const PERMISSIONS = Object.freeze([
  ['community.read','Community lesen'],['community.write','Community konfigurieren'],
  ['users.read','Benutzer lesen'],['users.write','Benutzer verwalten'],
  ['security.read','Security lesen'],['security.respond','Auf Security-Fälle reagieren'],
  ['tickets.read','Tickets lesen'],['tickets.manage','Tickets verwalten'],
  ['ai.read','AI-Daten lesen'],['ai.use','AI verwenden'],['ai.tools.use','AI-Tools anfordern'],['ai.tools.execute','AI-Tools ausführen'],
  ['audit.read','Audit-Log lesen'],['automation.manage','Automationen verwalten'],
  ['rbac.read','RBAC lesen'],['rbac.manage','RBAC verwalten'],
]);

export class RBACManager {
  constructor(db, events, audit, logger=console){this.db=db;this.events=events;this.audit=audit;this.logger=logger;}
  #definition(guildId,role){
    const local=this.db.listRoleDefinitions(guildId).find(r=>r.role===role);
    if(local)return local;
    if(DEFAULT_ROLES[role]) return {role,label:ROLE_META[role]?.[0]||role,description:ROLE_META[role]?.[1]||'',permissions:DEFAULT_ROLES[role],builtIn:true};
    return null;
  }
  #ensureCommunityBuiltIns(guildId){
    if(!guildId)return;
    for(const [role,permissions] of Object.entries(DEFAULT_ROLES)){
      if(!this.db.listRoleDefinitions(guildId).some(r=>r.role===role)){const meta=ROLE_META[role]; this.db.upsertRoleDefinition(guildId,{role,label:meta[0],description:meta[1],permissions,builtIn:true});}
    }
  }
  permissionCatalog(){return PERMISSIONS.map(([id,label])=>({id,label}));}
  roles(guildId=null){return guildId?this.listRoleDefinitions(guildId):Object.fromEntries(Object.entries(DEFAULT_ROLES));}
  listRoleDefinitions(guildId){this.#ensureCommunityBuiltIns(guildId);return this.db.listRoleDefinitions(guildId);}
  permissionsFor(guildId,userId){
    const row=this.db.getCoreRole(guildId,userId);
    const role=row?.role || (this.db.isAdministrator(guildId,userId)?'admin':'viewer');
    const def=this.#definition(guildId,role);
    return {role,permissions:def?.permissions||[],label:def?.label||role,description:def?.description||'',source:row?'core':'fallback'};
  }
  can(guildId,userId,permission){const p=this.permissionsFor(guildId,userId);return p.permissions.includes('*')||p.permissions.includes(permission);}
  require(guildId,userId,permission){if(!userId||!this.can(guildId,userId,permission))throw new Error(`Keine Berechtigung: ${permission}`);return true;}
  setRole(guildId,userId,role,actorId=null){
    if(!userId)throw new Error('userId fehlt.');
    const def=this.#definition(guildId,String(role)); if(!def)throw new Error('Unbekannte Core-Rolle.');
    if(actorId)this.require(guildId,actorId,'rbac.manage');
    if(def.role === 'owner' && actorId && this.permissionsFor(guildId,actorId).role !== 'owner') throw new Error('Nur ein Owner darf die Owner-Rolle vergeben.');
    const r=this.db.setCoreRole(guildId,userId,def.role);this.audit?.recordCore(guildId,'rbac.role.changed',actorId,{userId,role:def.role});this.events?.publish('rbac.role.changed',r,{source:'rbac',communityId:guildId});return r;
  }
  saveRole(guildId,data={},actorId=null){
    if(actorId)this.require(guildId,actorId,'rbac.manage');
    const permissions=Array.isArray(data.permissions)?data.permissions.map(String):[];
    if(permissions.includes('*') && actorId && this.permissionsFor(guildId,actorId).role !== 'owner') throw new Error('Nur ein Owner darf eine Rolle mit Vollzugriff (*) definieren.');
    const result=this.db.upsertRoleDefinition(guildId,{role:data.role,label:data.label,description:data.description,permissions,builtIn:Boolean(data.builtIn)});
    this.audit?.recordCore(guildId,'rbac.role.definition.changed',actorId,{role:result.role,permissions:result.permissions});
    this.events?.publish('rbac.role.definition.changed',result,{source:'rbac',communityId:guildId});
    return result;
  }
  deleteRole(guildId,role,actorId=null){
    if(actorId)this.require(guildId,actorId,'rbac.manage');
    const result=this.db.deleteRoleDefinition(guildId,role);
    this.audit?.recordCore(guildId,'rbac.role.definition.deleted',actorId,{role});
    this.events?.publish('rbac.role.definition.deleted',{role},{source:'rbac',communityId:guildId});
    return {deleted:result,role};
  }
  list(guildId){return this.listRoleDefinitions(guildId).map(r=>({...r,permissions:[...r.permissions]}));}
}
export { DEFAULT_ROLES, PERMISSIONS };
