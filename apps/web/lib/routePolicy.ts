import type { Role } from "@stoneos/contracts";
import {
  canAccess,
  USER_MANAGEMENT_ROLES,
  PRODUCTION_INPUT_ROLES,
  SALES_READ_ROLES,
  INVENTORY_DATA_ROLES,
  EXPENSE_DATA_ROLES,
  BOOKS_STATEMENT_ROLES,
  INTAKE_DRAFT_ROLES,
} from "@stoneos/contracts";

export const routes: Array<{ href: string; label: string; roles: Role[]; nav?: boolean }> = [
  { href: "/dashboard", label: "CEO", roles: ["owner", "manager", "admin", "supervisor", "operator", "inventory", "sales", "accountant", "auditor"] },
  { href: "/inventory", label: "Inventory", roles: INVENTORY_DATA_ROLES },
  { href: "/setup/opening-inventory", label: "Opening count", roles: INVENTORY_DATA_ROLES },
  { href: "/production", label: "Production", roles: PRODUCTION_INPUT_ROLES },
  { href: "/maintenance", label: "Maintenance", roles: PRODUCTION_INPUT_ROLES },
  { href: "/consumables", label: "Consumables", roles: PRODUCTION_INPUT_ROLES },
  { href: "/sales", label: "Sales", roles: SALES_READ_ROLES },
  { href: "/recovery-ratio", label: "Recovery", roles: SALES_READ_ROLES },
  { href: "/expenses", label: "Expenses", roles: EXPENSE_DATA_ROLES },
  { href: "/books", label: "Books", roles: BOOKS_STATEMENT_ROLES },
  { href: "/intake", label: "Intake", roles: INTAKE_DRAFT_ROLES },
  { href: "/tally", label: "Tally archive", roles: USER_MANAGEMENT_ROLES, nav: false },
  { href: "/files", label: "Files", roles: INVENTORY_DATA_ROLES },
  { href: "/admin/users", label: "Team", roles: USER_MANAGEMENT_ROLES },
  { href: "/admin/audit", label: "Audit", roles: ["owner", "manager", "admin", "auditor"] },
];

export function visibleRoutes(role: Role) {
  return routes.filter((route) => route.nav !== false && canAccess(role, route.roles));
}

export function canAccessPath(role: Role, pathname: string) {
  const matches = routes.filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  const route = matches.sort((a, b) => b.href.length - a.href.length)[0];
  if (!route) return true;
  return canAccess(role, route.roles);
}
