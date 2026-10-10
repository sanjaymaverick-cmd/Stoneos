import { BadRequestException } from "@nestjs/common";
import type { UserType } from "../../common/current-user";

export function readName(value: unknown, label: string): string {
  if (typeof value !== "string") throw new BadRequestException(`${label} is required`);
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) {
    throw new BadRequestException(`${label} must be 2 to 80 characters`);
  }
  return name;
}

export function readUsername(value: unknown): string {
  if (typeof value !== "string") throw new BadRequestException("Username is required");
  const username = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(username)) {
    throw new BadRequestException(
      "Username must start with a letter and use 3 to 32 letters or numbers",
    );
  }
  return username;
}

export function readPassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 12 || value.length > 200) {
    throw new BadRequestException("Password must be at least 12 characters");
  }
  return value;
}

export function readStaffType(value: unknown): Exclude<UserType, "OWNER"> {
  if (value === "OFFICE" || value === "YARD") return value;
  throw new BadRequestException("Choose Office or Yard");
}
