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
export const OPERATIONAL_DATA_ROLES: Role[] = [
  OWNER_ROLE,
  MANAGER_ROLE,
  SUPERVISOR_ROLE,
];
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
export const SALES_DATA_ROLES: Role[] = [
  OWNER_ROLE,
  MANAGER_ROLE,
  SUPERVISOR_ROLE,
  SALES_ROLE,
];
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
export const AUDIT_READ_ROLES: Role[] = [
  OWNER_ROLE,
  MANAGER_ROLE,
  ADMIN_ROLE,
  AUDITOR_ROLE,
];
/**
 * The owner's own view: the CEO dashboard and the snapshot Copilot.
 *
 * Deliberately narrow. A manager runs the plant and keeps every operational and
 * commercial permission below, but the executive board is the owner's, and the auditor
 * sees it because read-only oversight is the whole point of that role.
 */
export const EXECUTIVE_ROLES: Role[] = [OWNER_ROLE, AUDITOR_ROLE];

/**
 * Ordinary commercial and compliance work: trial balance, party statements, outstanding
 * AR, GST filing, stock exports. Not the executive board — these are the routes a
 * manager needs to chase a customer or file a return.
 */
export const COMMERCIAL_READ_ROLES: Role[] = [
  OWNER_ROLE,
  MANAGER_ROLE,
  ACCOUNTANT_ROLE,
  AUDITOR_ROLE,
  ADMIN_ROLE,
];
export const BOOKS_STATEMENT_ROLES: Role[] = [
  ...COMMERCIAL_READ_ROLES,
  SUPERVISOR_ROLE,
];
export const INTAKE_DRAFT_ROLES: Role[] = [
  OWNER_ROLE,
  MANAGER_ROLE,
  SUPERVISOR_ROLE,
  OPERATOR_ROLE,
  ACCOUNTANT_ROLE,
];
export const CASH_DRAWER_LOCK_ROLES: Role[] = [
  OWNER_ROLE,
  MANAGER_ROLE,
  ACCOUNTANT_ROLE,
];
export const MUSTER_ATTEND_ROLES: Role[] = [
  OWNER_ROLE,
  MANAGER_ROLE,
  SUPERVISOR_ROLE,
  OPERATOR_ROLE,
];
export const MUSTER_PAY_ROLES: Role[] = [
  OWNER_ROLE,
  MANAGER_ROLE,
  ACCOUNTANT_ROLE,
];
export const COPILOT_PROPOSE_ROLES: Role[] = [OWNER_ROLE, ACCOUNTANT_ROLE];
/**
 * Who may post a journal straight to the general ledger. Narrow on purpose: a journal
 * moves money between accounts with no document behind it.
 */
export const JOURNAL_POST_ROLES: Role[] = [
  OWNER_ROLE,
  MANAGER_ROLE,
  ACCOUNTANT_ROLE,
];
export const ANY_AUTHENTICATED_ROLE: Role[] = [...ROLES];

export const STAFF_PROVISIONABLE_ROLES: Role[] = [
  SUPERVISOR_ROLE,
  OPERATOR_ROLE,
];

/**
 * Where each role sits in the chain of command.
 *
 * Used only to decide who may act on whose account. The numbers are ordinal, not a
 * permission scale: two roles sharing a rank are peers, and a peer can never administer
 * a peer. Specialist roles (accountant, auditor, sales, inventory, operator) are
 * deliberately level — an accountant is not above a storekeeper, they answer to
 * different people about different things.
 */
export const ROLE_RANK: Record<Role, number> = {
  owner: 100,
  manager: 80,
  admin: 60,
  supervisor: 40,
  accountant: 20,
  auditor: 20,
  sales: 20,
  inventory: 20,
  operator: 20,
};

/**
 * Who a role sits above, and may therefore reset, disable or reactivate.
 *
 * The owner is above everyone, including other owners — a second owner is a co-owner,
 * not a subordinate, and the self-guard in the service stops the last one locking
 * themselves out. Everybody else must outrank the target strictly.
 */
export function canAdminister(actor: Role, target: Role): boolean {
  if (actor === OWNER_ROLE) return true;
  if (!canManageUsers(actor)) return false;
  return ROLE_RANK[actor] > ROLE_RANK[target];
}

/**
 * Handing out a role — creating an account or changing an existing one's role — is the
 * owner's alone. A manager who could mint roles could mint a second manager, or promote
 * a deputy past the people they were hired under; the hierarchy would only ever be as
 * firm as the most junior person allowed to edit it.
 */
export const ROLE_ASSIGNMENT_ROLES: Role[] = [OWNER_ROLE];

export function canAssignRoles(role: Role): boolean {
  return role === OWNER_ROLE;
}

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

/** Compatibility mapping; persisted historic roles are preserved. */
export function effectiveRole(role: Role): Role {
  if (["manager", "admin"].includes(role)) return "owner";
  if (["inventory", "sales"].includes(role)) return "supervisor";
  return role;
}
