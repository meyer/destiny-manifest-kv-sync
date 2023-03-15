import core from "@actions/core";
import { getDestinyManifestComponent } from "bungie-api-ts/destiny2";
import { bungieHttpClient } from "./bungieHttpClient.mjs";
import { format } from "util";
import { getThingOrThrow } from "./utils.mjs";
import { promises as fs } from "fs";

const MAX_BULK_DATA_ITEMS = 10000;

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

  let itemCount = 0;
  /** @type {Record<number, Array<{ key: string, value: string }>>} */
  const chunksByIndex = {};
  await Promise.all(
    tableNames.map(async (tableName) => {
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

      for (const [entryHash, entry] of resultEntries) {
        const chunkIndex = Math.floor(itemCount++ / MAX_BULK_DATA_ITEMS);
        const kvItems = (chunksByIndex[chunkIndex] =
          chunksByIndex[chunkIndex] || []);
        kvItems.push({
          key: `${tableName}/${entryHash}`,
          value: JSON.stringify(entry),
        });
      }
    })
  );

  console.info(
    `${itemCount} items in the following tables:` +
      tableNames.map((name) => "\n- " + name).join("")
  );

  const chunks = Object.values(chunksByIndex);

  let chunkIndex = 0;
  for (const chunk of chunks) {
    const startNum = chunkIndex * MAX_BULK_DATA_ITEMS;
    const timeLabel = format(
      "%d of %d: items %d-%d",
      chunkIndex + 1,
      chunks.length,
      startNum + 1,
      startNum + chunk.length
    );
    console.time(timeLabel);
    const response = await fetch(
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

    const responseText = await response.text();

    let responseJson;
    try {
      responseJson = JSON.parse(responseText);
    } catch (error) {
      throw new Error("Received a non-JSON response: " + responseText);
    }

    if (
      responseJson &&
      typeof responseJson === "object" &&
      responseJson.success !== true
    ) {
      throw new Error("response.success was not `true`: " + responseText);
    }

    if (response.status !== 200) {
      throw new Error(response.status + " " + response.statusText);
    }

    chunkIndex++;
  }
} catch (error) {
  console.error(error);
  core.setFailed(error.message + (error.stack ? "\n\n" + error.stack : ""));
}
