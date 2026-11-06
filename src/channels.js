import { ChannelType } from 'discord.js';
import { CATEGORY_DEFINITIONS, CHANNEL_DEFINITIONS } from './config.js';
import { buildCategoryOverwrites, buildPermissionOverwrites } from './permissions.js';

function findByName(collection, name) {
  return collection.find((item) => item.name === name);
}

export async function ensureCategories(guild, roles, { dryRun = false, force = false, logger = console }) {
  const categories = new Map();
  const channels = await guild.channels.fetch();

  for (const definition of CATEGORY_DEFINITIONS) {
    let category = findByName(channels, definition.name);

    if (category && category.type !== ChannelType.GuildCategory) {
      throw new Error(`Ein vorhandener Channel heißt bereits "${definition.name}", ist aber keine Kategorie.`);
    }

    if (category) {
      categories.set(definition.key, category);
      logger.info(`  ✓ Kategorie vorhanden: ${definition.name}`);

      if (!dryRun && force) {
        const overwrites = buildCategoryOverwrites(guild, roles, definition.key);
        if (overwrites.length) {
          await category.permissionOverwrites.set(overwrites, 'WebRadio Discord Setup: managed category permissions');
        }
      }
      continue;
    }

    if (dryRun) {
      logger.info(`  + Kategorie würde erstellt: ${definition.name}`);
      continue;
    }

    category = await guild.channels.create({
      name: definition.name,
      type: ChannelType.GuildCategory,
      permissionOverwrites: buildCategoryOverwrites(guild, roles, definition.key),
      reason: 'WebRadio Discord Setup',
    });

    categories.set(definition.key, category);
    logger.info(`  + Kategorie erstellt: ${definition.name}`);
  }

  return categories;
}

export async function ensureChannels(guild, roles, categories, { dryRun = false, force = false, logger = console }) {
  const result = new Map();
  const channels = await guild.channels.fetch();

  for (const definition of CHANNEL_DEFINITIONS) {
    let channel = findByName(channels, definition.name);
    const parent = categories.get(definition.category);

    if (channel && channel.type !== definition.type) {
      throw new Error(`Ein vorhandener Channel heißt bereits "${definition.name}", hat aber den falschen Typ.`);
    }

    if (channel) {
      result.set(definition.key, channel);
      logger.info(`  ✓ Channel vorhanden: ${definition.name}`);

      if (!dryRun && force) {
        if (parent && channel.parentId !== parent.id) {
          await channel.setParent(parent.id, { lockPermissions: false, reason: 'WebRadio Discord Setup: managed channel parent' });
        }
        await channel.permissionOverwrites.set(
          buildPermissionOverwrites(guild, roles, definition.key),
          'WebRadio Discord Setup: managed channel permissions',
        );
      }
      continue;
    }

    if (dryRun) {
      logger.info(`  + Channel würde erstellt: ${definition.name}`);
      continue;
    }

    channel = await guild.channels.create({
      name: definition.name,
      type: definition.type,
      parent: parent?.id ?? null,
      permissionOverwrites: buildPermissionOverwrites(guild, roles, definition.key),
      reason: 'WebRadio Discord Setup',
    });

    result.set(definition.key, channel);
    logger.info(`  + Channel erstellt: ${definition.name}`);
  }

  return result;
}
