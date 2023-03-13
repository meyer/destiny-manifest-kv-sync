import { format } from "util";

/**
 * Function that asserts the provided condition
 * @type {(condition: any, message: string, ...args: any) => asserts condition}
 */
export function invariant(condition, message, ...args) {
  if (!condition) {
    throw new Error(format(message, ...args));
  }
}

/**
 * Function that filters out nullish values
 * @type {<T>(thing: T | null | undefined | void) => thing is T}
 */
export const isNotNullish = (thing) => thing != null;

/**
 * Function that gets thing or throws an error
 * @type {<T>(thing: T | null | undefined | void, message?: string) => T}
 */
export const getThingOrThrow = (thing, message = "Could not get thing") => {
  if (!thing) {
    throw new Error(message);
  }
  return thing;
};
