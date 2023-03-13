// @ts-check

import { promises as fs, read } from "fs";
import path from "path";
import { createHash } from "crypto";
import { config } from "dotenv";

config();

const dataPrefix = process.env.CACHE_FOLDER_PATH || "bulk-data";

const bulkDataFolderLocation = path.join(process.cwd(), dataPrefix);
const readmeLocation = path.join(process.cwd(), "README.md");

const MAX_BULK_DATA_ITEMS = 10000;

const skippedTables = [
  "DestinyArtDyeReferenceDefinition",
  // just use DestinyInventoryItemDefinition
  "DestinyInventoryItemLiteDefinition",
];

/** @type {import('bungie-api-ts/destiny2').HttpClient} */
const bungieClient = async (config) => {
  const { BUNGIE_API_KEY, SERVER_URL } = process.env;
  if (!BUNGIE_API_KEY || !SERVER_URL) {
    throw new Error(
      "Required env variables were not set: BUNGIE_API_KEY, SERVER_URL"
    );
  }

  const url = new URL("https://www.bungie.net" + config.url);
  if (config.params) {
    for (const key in config.params) {
      url.searchParams.set(key, config.params[key]);
    }
  }

  const response = await fetch(url.toString(), {
    method: config.method,
    headers: {
      "X-API-Key": BUNGIE_API_KEY,
      Origin: SERVER_URL,
    },
    body: config.body ? JSON.stringify(config.body) : undefined,
  });

  return await response.json();
};

/** @type {Awaited<ReturnType<import('bungie-api-ts/destiny2').getDestinyManifest>>} */
const manifestJson = await bungieClient({
  method: "GET",
  url: "/Platform/Destiny2/Manifest/",
});

const manifestHash = createHash("md5")
  .update(JSON.stringify(manifestJson))
  .digest("hex");

await fs.mkdir(bulkDataFolderLocation, { recursive: true });

for (const [tableName, tablePath] of Object.entries(
  manifestJson.Response.jsonWorldComponentContentPaths.en
).sort()) {
  if (skippedTables.includes(tableName)) {
    console.log("Skipping %s...", tableName);
    continue;
  }

  console.log("Fetching data for %s...", tableName);
  /** @type {Awaited<ReturnType<import('bungie-api-ts/destiny2').getDestinyManifestComponent>>} */
  const result = await bungieClient({ url: tablePath, method: "GET" });

  const resultEntries = Object.entries(result);

  const bulkResults = resultEntries.map(([entryHash, entry]) => {
    const key = `${tableName}/${entryHash}`;
    return {
      key,
      value: JSON.stringify(entry),
    };
  });

  let index = 0;
  const tableCount = Math.ceil(bulkResults.length / MAX_BULK_DATA_ITEMS);
  while (index < tableCount) {
    const slicedResults = bulkResults.slice(
      index * MAX_BULK_DATA_ITEMS,
      (index + 1) * MAX_BULK_DATA_ITEMS
    );
    const fileName =
      tableName +
      "__" +
      (index * MAX_BULK_DATA_ITEMS + 1) +
      "-" +
      (index * MAX_BULK_DATA_ITEMS + slicedResults.length) +
      ".json";
    console.log("Writing %s...", fileName);
    await fs.writeFile(
      path.join(bulkDataFolderLocation, fileName),
      JSON.stringify(slicedResults, null, 2)
    );
    index++;
  }
}
