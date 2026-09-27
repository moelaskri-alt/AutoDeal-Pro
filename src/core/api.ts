import type { Db } from './db/database';
import type { Ctx } from './context';
import * as vehicles from './services/vehicles';
import * as costs from './services/costs';
import * as purchases from './services/purchases';
import * as customers from './services/customers';
import * as sales from './services/sales';
import * as inst from './services/installments';
import * as tradeins from './services/tradeins';
import * as expenses from './services/expenses';
import * as dashboard from './services/dashboard';
import * as reports from './services/reports';
import * as users from './services/users';
import * as admin from './services/admin';

type Handler = (db: Db, ctx: Ctx, args: any) => unknown;

/**
 * The application API: every UI request is routed by name to one of these handlers.
 * Each handler performs its own permission check (requirePerm) – the UI hiding a button
 * is only cosmetic; the rule is enforced here in the main process.
 */
export const API: Record<string, Handler> = {
  'dashboard.get': (db, ctx) => dashboard.getDashboard(db, ctx),

  'vehicles.list': vehicles.listVehicles,
  'vehicles.get': vehicles.getVehicle,
  'vehicles.create': vehicles.createVehicle,
  'vehicles.update': vehicles.updateVehicle,
  'vehicles.setPrices': vehicles.setPrices,
  'vehicles.delete': vehicles.deleteVehicle,
  'vehicles.brands': (db, ctx) => vehicles.brands(db, ctx),
  'vehicles.addImage': vehicles.addImage,
  'vehicles.getImage': vehicles.getImage,
  'vehicles.deleteImage': vehicles.deleteImage,
  'vehicles.setPrimaryImage': vehicles.setPrimaryImage,

  'costs.list': costs.listCosts,
  'costs.create': costs.createCost,
  'costs.update': costs.updateCost,
  'costs.delete': costs.deleteCost,
  'costs.card': costs.costCard,

  'suppliers.list': purchases.listSuppliers,
  'suppliers.create': purchases.createSupplier,
  'suppliers.update': purchases.updateSupplier,
  'suppliers.delete': purchases.deleteSupplier,
  'purchases.list': purchases.listPurchases,
  'purchases.get': purchases.getPurchase,
  'purchases.create': purchases.createPurchase,
  'purchases.addPayment': purchases.addPurchasePayment,
  'purchases.updatePrice': purchases.updatePurchasePrice,

  'customers.list': customers.listCustomers,
  'customers.lookup': customers.lookupCustomers,
  'customers.get': customers.getCustomer,
  'customers.create': customers.createCustomer,
  'customers.update': customers.updateCustomer,
  'customers.delete': customers.deleteCustomer,
  'customers.statement': customers.customerStatement,

  'leads.list': customers.listLeads,
  'leads.get': customers.getLead,
  'leads.create': customers.createLead,
  'leads.update': customers.updateLead,
  'leads.delete': customers.deleteLead,
  'leads.addFollowUp': customers.addFollowUp,
  'leads.convert': customers.convertLeadToCustomer,

  'quotations.list': sales.listQuotations,
  'quotations.get': sales.getQuotation,
  'quotations.create': sales.createQuotation,
  'quotations.cancel': sales.cancelQuotation,

  'reservations.list': sales.listReservations,
  'reservations.get': sales.getReservation,
  'reservations.create': sales.createReservation,
  'reservations.cancel': sales.cancelReservation,
  'reservations.extend': sales.extendReservation,

  'sales.list': sales.listSales,
  'sales.get': sales.getSale,
  'sales.create': sales.createSale,
  'sales.cancel': sales.cancelSale,
  'sales.deliver': sales.deliverSale,
  'sales.salespeople': (db, ctx) => users.listSalespeople(db, ctx),

  'installments.preview': inst.previewSchedule,
  'installments.contracts': inst.listContracts,
  'installments.contract': inst.getContract,
  'installments.list': inst.listInstallments,
  'installments.reschedule': inst.reschedule,
  'installments.earlySettlement': inst.earlySettlement,
  'payments.list': inst.listPayments,
  'payments.get': inst.getPayment,
  'payments.create': inst.recordPayment,
  'payments.void': inst.voidPayment,

  'tradeins.list': tradeins.listTradeIns,
  'tradeins.get': tradeins.getTradeIn,
  'tradeins.create': tradeins.createTradeIn,
  'tradeins.update': tradeins.updateTradeIn,
  'tradeins.reject': tradeins.rejectTradeIn,

  'expenses.list': expenses.listExpenses,
  'expenses.create': expenses.createExpense,
  'expenses.update': expenses.updateExpense,
  'expenses.delete': expenses.deleteExpense,

  'reports.list': (_db, ctx) => reports.listReports(ctx),
  'reports.run': reports.runReport,

  'users.list': users.listUsers,
  'users.create': users.createUser,
  'users.update': users.updateUser,
  'users.resetPassword': users.resetPassword,
  'users.changePassword': users.changeOwnPassword,
  'roles.list': users.listRoles,
  'roles.setPermissions': users.setRolePermissions,

  'audit.list': admin.listAudit,
  'settings.get': admin.getSettings,
  'settings.save': admin.saveSettings,
};

/** Calls an API method; throws AppError on failure (callers translate for the UI). */
export function callApi(db: Db, ctx: Ctx, method: string, args: unknown) {
  const h = API[method];
  if (!h) throw new Error(`Unknown API method: ${method}`);
  return h(db, ctx, args ?? {});
}
