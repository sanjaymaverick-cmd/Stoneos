export const ROLES = [
  "owner",
  "manager",
  "admin",
  "supervisor",
  "operator",
  "inventory",
  "sales",
  "accountant",
  "auditor",
] as const;

export type Role = (typeof ROLES)[number];

export const OWNER_ROLE: Role = "owner";
export const MANAGER_ROLE: Role = "manager";
export const ADMIN_ROLE: Role = "admin";
export const SUPERVISOR_ROLE: Role = "supervisor";
export const OPERATOR_ROLE: Role = "operator";
export const INVENTORY_ROLE: Role = "inventory";
export const SALES_ROLE: Role = "sales";
export const ACCOUNTANT_ROLE: Role = "accountant";
export const AUDITOR_ROLE: Role = "auditor";

export const USER_MANAGEMENT_ROLES: Role[] = [OWNER_ROLE, MANAGER_ROLE];
export const HISTORICAL_IMPORT_ROLES: Role[] = [OWNER_ROLE, MANAGER_ROLE];
export const OPERATIONAL_DATA_ROLES: Role[] = [OWNER_ROLE, MANAGER_ROLE, SUPERVISOR_ROLE];
export const PRODUCTION_INPUT_ROLES: Role[] = [
  OWNER_ROLE,
  MANAGER_ROLE,
  SUPERVISOR_ROLE,
  OPERATOR_ROLE,
];
export const INVENTORY_DATA_ROLES: Role[] = [
  OWNER_ROLE,
  MANAGER_ROLE,
  SUPERVISOR_ROLE,
  INVENTORY_ROLE,
];
export const SALES_DATA_ROLES: Role[] = [OWNER_ROLE, MANAGER_ROLE, SUPERVISOR_ROLE, SALES_ROLE];
export const SALES_READ_ROLES: Role[] = [
  OWNER_ROLE,
  MANAGER_ROLE,
  SUPERVISOR_ROLE,
  SALES_ROLE,
  INVENTORY_ROLE,
  ACCOUNTANT_ROLE,
  AUDITOR_ROLE,
  ADMIN_ROLE,
];
export const EXPENSE_DATA_ROLES: Role[] = [
  OWNER_ROLE,
  MANAGER_ROLE,
  SUPERVISOR_ROLE,
  ACCOUNTANT_ROLE,
];
export const PAYMENT_ROLES: Role[] = [...SALES_DATA_ROLES, ACCOUNTANT_ROLE];
export const AUDIT_READ_ROLES: Role[] = [OWNER_ROLE, MANAGER_ROLE, ADMIN_ROLE, AUDITOR_ROLE];
export const CEO_ROLES: Role[] = [OWNER_ROLE, MANAGER_ROLE, ACCOUNTANT_ROLE, AUDITOR_ROLE, ADMIN_ROLE];
export const ANY_AUTHENTICATED_ROLE: Role[] = [...ROLES];

export const STAFF_PROVISIONABLE_ROLES: Role[] = [
  MANAGER_ROLE,
  ADMIN_ROLE,
  SUPERVISOR_ROLE,
  OPERATOR_ROLE,
  INVENTORY_ROLE,
  SALES_ROLE,
  ACCOUNTANT_ROLE,
  AUDITOR_ROLE,
];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function canManageUsers(role: Role): boolean {
  return USER_MANAGEMENT_ROLES.includes(role);
}

export function canGrantOwner(role: Role): boolean {
  return role === OWNER_ROLE;
}

export function canAccess(role: Role, allowed: readonly Role[]): boolean {
  return allowed.includes(role);
}
