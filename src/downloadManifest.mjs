import { format } from "node:util";
import { setFailed } from "@actions/core";
import {
  getDestinyManifest,
  getDestinyManifestComponent,
} from "bungie-api-ts/destiny2";
import { bungieHttpClient } from "./bungieHttpClient.mjs";
import { getThingOrThrow, invariant, sliceThingIntoChunks } from "./utils.mjs";

const MAX_BULK_DATA_ITEMS = 10000;
const BULK_PUT_CHUNK_SIZE = MAX_BULK_DATA_ITEMS / 5;
const DRY_RUN = !!process.env.DRY_RUN;

/** @param {unknown[]} items */
const cloudflareKVBulkPut = async (items) => {
  const response = await fetch(
    format(
      "https://api.cloudflare.com/client/v4/accounts/%s/storage/kv/namespaces/%s/bulk",
      process.env.CLOUDFLARE_ACCOUNT_ID,
      process.env.CLOUDFLARE_NAMESPACE_ID,
    ),
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      },
      body: JSON.stringify(items),
    },
  );

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
};

/** @param {unknown[]} values */
const uploadBatchToCloudflareKV = async (values) => {
  await Promise.all(
    sliceThingIntoChunks(values, BULK_PUT_CHUNK_SIZE).map(
      async (chunk, index) => {
        console.log("Batch %d: %d items", index + 1, chunk.length);
        await cloudflareKVBulkPut(chunk);
      },
    ),
  );
};

const skippedTables = [
  "DestinyArtDyeReferenceDefinition",
  "DestinyArtDyeChannelDefinition",
  // just use DestinyInventoryItemDefinition
  "DestinyInventoryItemLiteDefinition",
];

try {
  if (DRY_RUN) {
    console.info("Running in dry run mode — will not upload to KV");
  }

  console.info("Fetching manifest…");
  const manifest = await getDestinyManifest(bungieHttpClient).then(
    (value) => value.Response,
  );
  const manifestVersion = manifest.version;

  console.info("Current manifest version: " + manifestVersion);
  const enPaths = manifest.jsonWorldComponentContentPaths.en;
  invariant(enPaths, "No en paths in jsonWorldComponentContentPaths");

  /** @type {Array<keyof import("bungie-api-ts/destiny2").AllDestinyManifestComponents>} */
  const tableNames = /** @type {any} */ (
    Object.keys(enPaths)
      .filter((tableName) => {
        if (skippedTables.includes(tableName)) {
          console.debug("Skipping table " + tableName);
          return false;
        }
        return true;
      })
      .sort()
  );

  /** @type {Array<{ key: string, value: string }>} */
  const kvItems = [];

  const tableInfo = await Promise.all(
    tableNames.map(async (tableName) => {
      const tableData = await getDestinyManifestComponent(bungieHttpClient, {
        tableName,
        destinyManifest: manifest,
        language: "en",
      });

      const resultEntries = Object.entries(tableData);

      for (const [entryHash, entry] of resultEntries) {
        kvItems.push({
          key: `${tableName}/${entryHash}`,
          value: JSON.stringify(entry),
        });
      }

      return format(
        "Table %s contains %s entr%s",
        tableName,
        resultEntries.length,
        resultEntries.length === 1 ? "y" : "ies",
      );
    }),
  );

  for (const l of tableInfo) {
    console.log(l);
  }

  console.info("Total KV items: %d", kvItems.length);

  if (DRY_RUN) {
    console.info("Dry run complete — skipping KV upload");
  } else {
    const chunks = sliceThingIntoChunks(kvItems, MAX_BULK_DATA_ITEMS);

    let chunkIndex = 0;
    for (const chunk of chunks) {
      const startNum = chunkIndex * MAX_BULK_DATA_ITEMS;
      const timeLabel = format(
        "%d of %d: items %d-%d",
        chunkIndex + 1,
        chunks.length,
        startNum + 1,
        startNum + chunk.length,
      );
      console.time(timeLabel);
      await uploadBatchToCloudflareKV(chunk);
      console.timeEnd(timeLabel);
      chunkIndex++;
    }
  }
} catch (error) {
  setFailed(
    /** @type {any} */ (error).message + /** @type {any} */ (error).stack
      ? "\n\n" + /** @type {any} */ (error).stack
      : "",
  );
}
