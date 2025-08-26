import core from "@actions/core";
import { PlatformErrorCodes } from "bungie-api-ts/destiny2";
import { getThingOrThrow } from "./utils.mjs";

export class BungieAPIError extends Error {
  constructor(
    /** @type {import('bungie-api-ts/destiny2').ServerResponse<any>} */
    response,
  ) {
    super(response.ErrorCode + " " + response.ErrorStatus);
    this.response = response;
  }

  /** @type {import('bungie-api-ts/destiny2').ServerResponse<any>} */
  response;
}

/** @type {import('bungie-api-ts/destiny2').HttpClient} */
export const bungieHttpClient = async (config) => {
  const BUNGIE_API_KEY = getThingOrThrow(
    process.env.BUNGIE_API_KEY,
    "process.env.BUNGIE_API_KEY is not set",
  );
  const SERVER_URL = getThingOrThrow(
    process.env.SERVER_URL,
    "process.env.SERVER_URL is not set",
  );

  const url = new URL(config.url);
  if (config.params) {
    for (const [key, value] of Object.entries(config.params)) {
      url.searchParams.set(key, value);
    }
  }

  const urlString = url.toString();

  core.info(`${config.method} ${urlString}`);

  const response = await fetch(urlString, {
    method: config.method,
    headers: {
      "X-API-Key": BUNGIE_API_KEY,
      Origin: SERVER_URL,
    },
    body: config.body ? JSON.stringify(config.body) : undefined,
  });

  /** @type {any} */
  let result;

  try {
    result = /** @type {any} */ (await response.json());
  } catch (error) {
    throw new Error("Could not convert response text to JSON: " + error);
  }

  if (
    "ErrorCode" in result &&
    result.ErrorCode !== PlatformErrorCodes.Success
  ) {
    throw new BungieAPIError(result);
  }

  if (response.status < 200 || response.status > 299) {
    throw new Error("Bungie API did not return a 200-ish response");
  }

  return result;
};
