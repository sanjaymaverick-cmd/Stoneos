import { BadRequestException } from "@nestjs/common";
import { parseOperationalDate } from "@stoneos/domain";
import { factoryToday } from "../books/money";
export function invoiceBusinessDate(value?: string): Date {
  const input = value ?? factoryToday();
  try {
    const date = parseOperationalDate(input);
    if (input > factoryToday()) throw new Error("after today");
    return new Date(date.getTime() + 90 * 60_000); // 07:00 IST preserves the calendar day in ledger posting.
  } catch { throw new BadRequestException("invoiceDate must be a real YYYY-MM-DD date no later than today"); }
}
