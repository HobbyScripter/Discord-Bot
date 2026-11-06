export const COMMUNITY_PROFILES = {
  webradio: {
    id: 'webradio', name: 'WebRadio', description: 'Offizielles WebRadio Community Profil',
    branding: { botName: 'WebRadio Community' },
    modules: { setup: true, welcome: true, reactionRoles: true, onboarding: true, releases: true, moderation: true, ai: true }
  },
  gaming: {
    id: 'gaming', name: 'Gaming Community', description: 'Allgemeines Gaming-Profil',
    branding: { botName: 'Community Bot' },
    modules: { welcome: true, moderation: true, reactionRoles: true, onboarding: true, ai: true, releases: false }
  },
  developer: {
    id: 'developer', name: 'Developer Community', description: 'Profil für Entwickler-Communities',
    branding: { botName: 'Developer Community' },
    modules: { welcome: true, moderation: true, reactionRoles: true, onboarding: true, ai: true, releases: true }
  },
  custom: {
    id: 'custom', name: 'Custom Community', description: 'Frei konfigurierbare Community',
    branding: { botName: 'Community Bot' },
    modules: { welcome: true, moderation: true, reactionRoles: true, onboarding: true, ai: true, releases: false }
  }
};
export function getProfile(id) { return COMMUNITY_PROFILES[id] || COMMUNITY_PROFILES.custom; }
