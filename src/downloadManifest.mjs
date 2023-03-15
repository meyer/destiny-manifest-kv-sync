import cache from "@actions/cache";
import core from "@actions/core";
import { getDestinyManifest } from "bungie-api-ts/destiny2";
import { bungieHttpClient } from "./bungieHttpClient.mjs";
import { createHash } from "crypto";
import { getThingOrThrow, invariant } from "./utils.mjs";
import { promises as fs } from "fs";
import path from "path";

const skippedTables = [
  "DestinyArtDyeReferenceDefinition",
  "DestinyArtDyeChannelDefinition",
  // just use DestinyInventoryItemDefinition
  "DestinyInventoryItemLiteDefinition",
];

// these babies deserve their own job
const knownMassiveTables = [
  "DestinyRewardMappingDefinition", // 6346
  "DestinyCollectibleDefinition", // 7576
  "DestinyObjectiveDefinition", // 7837
  "DestinyUnlockExpressionMappingDefinition", // 10182
  "DestinyUnlockValueDefinition", // 10505
  "DestinyInventoryItemDefinition", // 21661
  "DestinyUnlockDefinition", // 35468
];

const tableNameRegex = /^Destiny(.+)Definition$/;

/** @param {string} tableName */
const getShortTableName = (tableName) =>
  tableNameRegex.exec(tableName)?.[1] || tableName;

try {
  const cacheDirName = getThingOrThrow(
    process.env.CACHE_PATH,
    "Could not get CACHE_PATH from environment"
  );

  const shardCountString = getThingOrThrow(
    process.env.SHARD_COUNT,
    "Could not get SHARD_COUNT from environment"
  );
  const maxShardCount = parseInt(shardCountString, 10);

  core.info("Fetching manifest…");
  const manifest = await getDestinyManifest(bungieHttpClient);
  const manifestVersion = manifest.Response.version;

  core.info("Current manifest version: " + manifestVersion);
  const enPaths = manifest.Response.jsonWorldComponentContentPaths.en;
  invariant(enPaths, "No en paths in jsonWorldComponentContentPaths");

  const manifestHash = createHash("md5")
    .update(JSON.stringify(manifest.Response))
    .digest("hex");

  const cacheKey = manifestVersion + "__" + manifestHash;
  const cacheResult = await cache.restoreCache(
    [cacheDirName],
    cacheKey,
    undefined,
    { lookupOnly: true }
  );

  const tableNames = Object.keys(enPaths)
    .filter((tableName) => {
      if (skippedTables.includes(tableName)) {
        core.debug("Skipping table " + tableName);
        return false;
      }
      if (knownMassiveTables.includes(tableName)) {
        core.debug("Table " + tableName + " will be handled separately");
        return false;
      }
      return true;
    })
    .sort();

  const shardCount = Math.max(maxShardCount - knownMassiveTables.length, 1);
  const chunkSize = Math.ceil(tableNames.length / shardCount);

  const tableData = Object.values(
    tableNames.reduce((prev, tableName, index) => {
      // one-based
      const shardIndex = Math.ceil((index + 1) / chunkSize);
      (prev[shardIndex] = prev[shardIndex] || []).push(tableName);
      return prev;
    }, /** @type {Record<string, string[]>} */ ({}))
  ).map((tables) => ({
    name:
      getShortTableName(tables[0]) +
      "-" +
      getShortTableName(tables[tables.length - 1]),
    tables: JSON.stringify(tables),
  }));

  for (const tableName of knownMassiveTables) {
    tableData.push({
      name: getShortTableName(tableName),
      tables: JSON.stringify([tableName]),
    });
  }

  if (!cacheResult) {
    await fs.mkdir(cacheDirName, { recursive: true });
    await fs.writeFile(
      path.join(cacheDirName, "manifest.json"),
      JSON.stringify(manifest.Response, null, 2)
    );
    await cache.saveCache([cacheDirName], cacheKey);
  }

  const cacheStatus = cacheResult ? "hit" : "miss";

  core.info("Cache status: " + cacheStatus);
  core.info("Cache key: " + cacheKey);
  core.info("Manifest version: " + manifestVersion);

  core.setOutput("cache-status", cacheStatus);
  core.setOutput("cache-key", cacheKey);
  core.setOutput("manifest-version", manifestVersion);
  core.setOutput("matrix", { include: tableData });
} catch (error) {
  core.setFailed(error.message + (error.stack ? "\n\n" + error.stack : ""));
}
