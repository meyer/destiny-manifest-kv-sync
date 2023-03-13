// @ts-check

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

const cacheDirName = "manifest-cache";

const tableNameRegex = /^Destiny(.+)Definition$/;
const getShortTableName = (tableName) =>
  tableNameRegex.exec(tableName)?.[1] || tableName;

try {
  const shardCountString = getThingOrThrow(
    process.env.SHARD_COUNT,
    "Could not get SHARD_COUNT from environment"
  );
  const shardCount = parseInt(shardCountString, 10);

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
      return true;
    })
    .sort();

  const chunkSize = Math.ceil(tableNames.length / shardCount);

  const tableData = Object.entries(
    tableNames.reduce((prev, tableName, index, items) => {
      // one-based
      const shardIndex = Math.ceil((index + 1) / chunkSize);
      const shardName = `Shard ${shardIndex}`;
      (prev[shardName] = prev[shardName] || []).push(tableName);
      return prev;
    }, /** @type {Record<string, string[]>} */ ({}))
  ).map(([name, tables]) => ({
    name:
      name +
      ": " +
      getShortTableName(tables[0]) +
      "-" +
      getShortTableName(tables[tables.length - 1]),
    tables: JSON.stringify(tables),
  }));

  if (!cacheResult) {
    await fs.mkdir(cacheDirName, { recursive: true });
    await fs.writeFile(
      path.join(cacheDirName, "manifest.json"),
      JSON.stringify(manifest.Response, null, 2)
    );
    await cache.saveCache([cacheDirName], cacheKey);
  }

  core.setOutput("cache-hit", !!cacheResult);
  core.setOutput("cache-key", cacheKey);
  core.setOutput("manifest-version", manifestVersion);
  core.setOutput("matrix", { include: tableData });
} catch (error) {
  core.setFailed(error.message + (error.stack ? "\n\n" + error.stack : ""));
}
