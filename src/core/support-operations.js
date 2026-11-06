export class SupportOperations {
  constructor({ db, tickets, events, audit, logger = console } = {}) { this.db=db; this.tickets=tickets; this.events=events; this.audit=audit; this.logger=logger; }
  overview(guildId) { const metrics=this.db.supportMetrics(guildId); const staff=this.tickets.staff(guildId).map(s=>({...s,openTickets:metrics.byStaff[s.userId]||0})); return {...metrics,staff,generatedAt:new Date().toISOString()}; }
  sla(guildId) { return this.db.supportSLA(guildId); }
  saveSLA(guildId,rows,actorId=null) { const result=this.db.saveSupportSLA(guildId,rows); this.audit?.recordCore(guildId,'support.sla.changed',actorId,{rows:result}); this.events?.publish('support.sla.changed',{rows:result},{source:'support',communityId:guildId}); return result; }
  knowledgeFeedback(guildId,data={}) { const result=this.db.addKnowledgeFeedback(guildId,data.documentId,data.userId,Boolean(data.helpful),data.query||'',data.ticketId||null); this.events?.publish('knowledge.feedback.added',result,{source:'knowledge',communityId:guildId}); return result; }
  knowledgeStats(guildId,documentId=null) { return this.db.knowledgeFeedbackStats(guildId,documentId); }
}
