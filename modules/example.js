export default {
  id: 'example',
  name: 'Example Module',
  version: '1.0.0',
  apiVersion: '1.0',
  description: 'Template für externe Community-Core-Module.',
  permissions: ['community.read'],
  async setup(context) { context.logger?.info?.(`Example Module aktiviert für ${context.communityId}.`); },
  async destroy(context) { context.logger?.info?.(`Example Module beendet für ${context.communityId}.`); },
};
