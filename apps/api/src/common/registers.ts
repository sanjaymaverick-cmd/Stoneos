import { BadRequestException } from "@nestjs/common";

/**
 * Query string as Express hands it over. A key repeated in the URL
 * (`?q=a&q=b`) arrives as an array, so nothing here is assumed to be a string.
 */
export type RegisterQuery = Record<string, unknown>;

export const MAX_PAGE_SIZE = 100;
const MAX_TEXT = 120;

/**
 * Paging for a register endpoint, or undefined when the caller did not ask for it.
 *
 * Absent `page` means the legacy behaviour: the whole list as a plain array, which
 * older screens and the offline read cache still expect.
 */
export function registerPage(query: RegisterQuery) {
  if (query.page === undefined) return undefined;
  const page = Number(queryText(query, "page"));
  const pageSize = Number(queryText(query, "pageSize") ?? 50);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 1_000_000 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_PAGE_SIZE
  ) {
    throw new BadRequestException(`Use a positive page and pageSize between 1 and ${MAX_PAGE_SIZE}`);
  }
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/**
 * One trimmed text value from the query, or undefined if absent or blank.
 *
 * Takes the first value of a repeated key: passing the array straight into a
 * Prisma `contains` or equality filter is a validation error, which surfaced as
 * a 500 for any hand-edited or double-encoded URL. Capped so a search term
 * cannot be made arbitrarily expensive.
 */
export function queryText(query: RegisterQuery, key: string, max = MAX_TEXT): string | undefined {
  const raw = query[key];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== "string") return undefined;
  const text = first.trim().slice(0, max);
  return text === "" ? undefined : text;
}
