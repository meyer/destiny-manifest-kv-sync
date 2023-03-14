import core from "@actions/core";
import { getDestinyManifestComponent } from "bungie-api-ts/destiny2";
import { bungieHttpClient } from "./bungieHttpClient.mjs";
import { format } from "util";
import { getThingOrThrow } from "./utils.mjs";
import { promises as fs } from "fs";

const MAX_BULK_DATA_ITEMS = 2000;

try {
  const shardData = getThingOrThrow(
    process.env.MANIFEST_TABLES,
    "Could not get MANIFEST_TABLES from environment"
  );

  const cacheDirName = getThingOrThrow(
    process.env.CACHE_PATH,
    "Could not get CACHE_PATH from environment"
  );

  const destinyManifestContent = await fs.readFile(
    `./${cacheDirName}/manifest.json`,
    "utf-8"
  );

  /** @type {string[]} */
  const tableNames = JSON.parse(shardData);

  /** @type {import("bungie-api-ts/destiny2").DestinyManifest} */
  const destinyManifest = JSON.parse(destinyManifestContent);

  const tablePromises = tableNames.map(async (tableName) => {
    const tableData = await getDestinyManifestComponent(bungieHttpClient, {
      // @ts-expect-error
      tableName,
      destinyManifest,
      language: "en",
    });

    const resultEntries = Object.entries(tableData);
    core.info(
      format(
        "Table %s contains %s entr%s",
        tableName,
        resultEntries.length,
        resultEntries.length === 1 ? "y" : "ies"
      )
    );

    const kvItems = resultEntries.map(([entryHash, entry]) => ({
      key: `${tableName}/${entryHash}`,
      value: JSON.stringify(entry),
    }));

    const chunkCount = Math.ceil(kvItems.length / MAX_BULK_DATA_ITEMS);

    const chunks = Array.from({ length: chunkCount }).map((_unused, index) => {
      return kvItems.slice(
        index * MAX_BULK_DATA_ITEMS,
        (index + 1) * MAX_BULK_DATA_ITEMS
      );
    });

    await Promise.all(
      chunks.map(async (chunk, chunkIndex, allChunks) => {
        const startNum = chunkIndex * MAX_BULK_DATA_ITEMS;
        const timeLabel = format(
          "%s, %d of %d: items %d-%d",
          tableName,
          chunkIndex + 1,
          allChunks.length,
          startNum + 1,
          startNum + chunk.length
        );
        console.time(timeLabel);
        await fetch(
          format(
            "https://api.cloudflare.com/client/v4/accounts/%s/storage/kv/namespaces/%s/bulk",
            process.env.CLOUDFLARE_ACCOUNT_ID,
            process.env.CLOUDFLARE_NAMESPACE_ID
          ),
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
            },
            body: JSON.stringify(chunk),
          }
        );
        console.timeEnd(timeLabel);
      })
    );
  });

  await Promise.all(tablePromises);
} catch (error) {
  console.error(error);
  core.setFailed(error.message + (error.stack ? "\n\n" + error.stack : ""));
}
