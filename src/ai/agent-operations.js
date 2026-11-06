export class AIAgentOperations {
  constructor({db,events,audit,logger=console}={}) { this.db=db; this.events=events; this.audit=audit; this.logger=logger; }
  createSession(guildId,userId,title='AI Agent Session',context={}) { const session=this.db.createAIAgentSession(guildId,userId,title,context); this.events?.publish('ai.agent.session.created',{sessionId:session.id,userId,title:session.title},{source:'ai',communityId:guildId}); return session; }
  touchSession(guildId,sessionId,patch={}) { return this.db.updateAIAgentSession(guildId,sessionId,patch); }
  recordRun(guildId,run) { const item=this.db.addAIAgentRun(guildId,run); this.events?.publish('ai.agent.run.changed',{runId:item.id,sessionId:item.session_id,kind:item.kind,status:item.status,tool:item.tool||null},{source:'ai',communityId:guildId}); return item; }
  listSessions(guildId,options={}) { return this.db.listAIAgentSessions(guildId,options); }
  session(guildId,id) { return this.db.getAIAgentSession(guildId,id); }
  runs(guildId,options={}) { return this.db.listAIAgentRuns(guildId,options); }
  metrics(guildId) { return this.db.agentMetrics(guildId); }
}
