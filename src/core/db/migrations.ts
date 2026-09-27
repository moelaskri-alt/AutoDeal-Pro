import type { Db } from './database';

/**
 * Schema migrations. Each migration runs once, in order, inside a transaction.
 * NEVER edit an already-released migration – append a new one instead.
 *
 * Conventions:
 *  - Money columns are INTEGER in minor units (1/100 of the currency) to avoid float errors.
 *  - Dates are TEXT 'YYYY-MM-DD'; timestamps are TEXT 'YYYY-MM-DD HH:MM:SS' (local time).
 *  - Soft delete via deleted_at where business history must be preserved.
 */
const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE permissions (
  code TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  name_ar TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE sequences (
  name TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  supplier_type TEXT NOT NULL DEFAULT 'company'
    CHECK (supplier_type IN ('company','individual','dealer','agent','workshop','other')),
  phone TEXT,
  national_id TEXT,
  address TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX ix_suppliers_name ON suppliers(name);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  phone2 TEXT,
  national_id TEXT,
  address TEXT,
  email TEXT,
  customer_type TEXT NOT NULL DEFAULT 'individual' CHECK (customer_type IN ('individual','company')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT,
  deleted_at TEXT
);
CREATE UNIQUE INDEX ux_customers_national_id ON customers(national_id)
  WHERE national_id IS NOT NULL AND national_id <> '' AND deleted_at IS NULL;
CREATE INDEX ix_customers_name ON customers(name);
CREATE INDEX ix_customers_phone ON customers(phone);

CREATE TABLE vehicles (
  id INTEGER PRIMARY KEY,
  stock_no TEXT NOT NULL UNIQUE,
  condition TEXT NOT NULL CHECK (condition IN ('new','used')),
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  trim TEXT,
  model_year INTEGER NOT NULL CHECK (model_year BETWEEN 1950 AND 2100),
  color TEXT,
  vin TEXT,
  engine_no TEXT,
  plate_no TEXT,
  mileage INTEGER NOT NULL DEFAULT 0 CHECK (mileage >= 0),
  transmission TEXT,
  fuel_type TEXT,
  body_type TEXT,
  origin_country TEXT,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','reserved','sold','delivered','preparation','maintenance','returned')),
  acquisition_type TEXT NOT NULL DEFAULT 'purchase' CHECK (acquisition_type IN ('purchase','trade_in','opening')),
  acquisition_date TEXT NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id),
  asking_price INTEGER NOT NULL DEFAULT 0 CHECK (asking_price >= 0),
  min_price INTEGER NOT NULL DEFAULT 0 CHECK (min_price >= 0),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT,
  deleted_at TEXT,
  CHECK (min_price <= asking_price OR asking_price = 0)
);
CREATE UNIQUE INDEX ux_vehicles_vin ON vehicles(vin COLLATE NOCASE)
  WHERE vin IS NOT NULL AND vin <> '' AND deleted_at IS NULL;
CREATE UNIQUE INDEX ux_vehicles_engine ON vehicles(engine_no COLLATE NOCASE)
  WHERE engine_no IS NOT NULL AND engine_no <> '' AND deleted_at IS NULL;
CREATE INDEX ix_vehicles_status ON vehicles(status, deleted_at);
CREATE INDEX ix_vehicles_brand ON vehicles(brand, model);
CREATE INDEX ix_vehicles_acq ON vehicles(acquisition_date);

CREATE TABLE vehicle_images (
  id INTEGER PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX ix_vehicle_images_vehicle ON vehicle_images(vehicle_id);

-- Direct costs of a vehicle (the Cost Card). Acquisition price is a line too.
CREATE TABLE vehicle_expenses (
  id INTEGER PRIMARY KEY,
  expense_no TEXT NOT NULL UNIQUE,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  expense_date TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN
    ('purchase','trade_in','transport','customs','registration','maintenance','parts','bodywork','paint',
     'tires','detailing','insurance','accessories','other')),
  description TEXT,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  supplier_id INTEGER REFERENCES suppliers(id),
  payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('cash','bank_transfer','cheque','card','credit','other')),
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual','purchase','trade_in')),
  source_id INTEGER,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT,
  deleted_at TEXT
);
CREATE INDEX ix_vexp_vehicle ON vehicle_expenses(vehicle_id, deleted_at);
CREATE INDEX ix_vexp_date ON vehicle_expenses(expense_date);
CREATE INDEX ix_vexp_category ON vehicle_expenses(category);

CREATE TABLE purchases (
  id INTEGER PRIMARY KEY,
  purchase_no TEXT NOT NULL UNIQUE,
  vehicle_id INTEGER NOT NULL UNIQUE REFERENCES vehicles(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  purchase_date TEXT NOT NULL,
  invoice_no TEXT,
  purchase_price INTEGER NOT NULL CHECK (purchase_price > 0),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX ix_purchases_date ON purchases(purchase_date);
CREATE INDEX ix_purchases_supplier ON purchases(supplier_id);

CREATE TABLE purchase_payments (
  id INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  pay_date TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash','bank_transfer','cheque','card','other')),
  reference TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX ix_pp_purchase ON purchase_payments(purchase_id);

CREATE TABLE leads (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  customer_id INTEGER REFERENCES customers(id),
  source TEXT NOT NULL DEFAULT 'walk_in'
    CHECK (source IN ('walk_in','facebook','instagram','website','referral','advertisement','other')),
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','contacted','interested','negotiating','reserved','won','lost')),
  vehicle_id INTEGER REFERENCES vehicles(id),
  interest TEXT,
  budget INTEGER CHECK (budget IS NULL OR budget >= 0),
  assigned_to INTEGER REFERENCES users(id),
  next_follow_up TEXT,
  lost_reason TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT,
  deleted_at TEXT
);
CREATE INDEX ix_leads_status ON leads(status);
CREATE INDEX ix_leads_customer ON leads(customer_id);

CREATE TABLE follow_ups (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  follow_date TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'call' CHECK (method IN ('call','visit','whatsapp','message','email','other')),
  notes TEXT NOT NULL,
  next_follow_up TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX ix_followups_lead ON follow_ups(lead_id);

CREATE TABLE quotations (
  id INTEGER PRIMARY KEY,
  quote_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  quote_date TEXT NOT NULL,
  asking_price INTEGER NOT NULL CHECK (asking_price >= 0),
  discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  final_price INTEGER NOT NULL CHECK (final_price >= 0),
  payment_method TEXT NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash','installments','trade_in_cash','trade_in_installments')),
  down_payment INTEGER CHECK (down_payment IS NULL OR down_payment >= 0),
  months INTEGER,
  valid_until TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reserved','sold','expired','cancelled')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  CHECK (final_price = asking_price - discount)
);
CREATE INDEX ix_quotes_customer ON quotations(customer_id);
CREATE INDEX ix_quotes_vehicle ON quotations(vehicle_id);

CREATE TABLE reservations (
  id INTEGER PRIMARY KEY,
  reservation_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  quotation_id INTEGER REFERENCES quotations(id),
  reservation_date TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  agreed_price INTEGER CHECK (agreed_price IS NULL OR agreed_price >= 0),
  expiry_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled','converted')),
  notes TEXT,
  cancel_reason TEXT,
  refund_amount INTEGER NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT,
  CHECK (expiry_date >= reservation_date)
);
CREATE UNIQUE INDEX ux_reservation_active_vehicle ON reservations(vehicle_id) WHERE status = 'active';
CREATE INDEX ix_reservations_customer ON reservations(customer_id);

CREATE TABLE sales (
  id INTEGER PRIMARY KEY,
  sale_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  quotation_id INTEGER REFERENCES quotations(id),
  reservation_id INTEGER REFERENCES reservations(id),
  sale_date TEXT NOT NULL,
  sale_type TEXT NOT NULL CHECK (sale_type IN ('cash','installments','trade_in_cash','trade_in_installments')),
  list_price INTEGER NOT NULL CHECK (list_price >= 0),
  discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  selling_price INTEGER NOT NULL CHECK (selling_price > 0),
  fees INTEGER NOT NULL DEFAULT 0 CHECK (fees >= 0),
  total_contract_value INTEGER NOT NULL CHECK (total_contract_value > 0),
  trade_in_value INTEGER NOT NULL DEFAULT 0 CHECK (trade_in_value >= 0),
  reservation_credit INTEGER NOT NULL DEFAULT 0 CHECK (reservation_credit >= 0),
  down_payment INTEGER NOT NULL DEFAULT 0 CHECK (down_payment >= 0),
  financed_amount INTEGER NOT NULL DEFAULT 0 CHECK (financed_amount >= 0),
  cost_at_sale INTEGER NOT NULL DEFAULT 0,
  min_price_at_sale INTEGER NOT NULL DEFAULT 0,
  min_price_override INTEGER NOT NULL DEFAULT 0,
  override_reason TEXT,
  salesperson_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  delivered_at TEXT,
  cancel_reason TEXT,
  cancelled_at TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  CHECK (selling_price = list_price - discount),
  CHECK (total_contract_value = selling_price + fees),
  CHECK (financed_amount = total_contract_value - trade_in_value - reservation_credit - down_payment)
);
CREATE UNIQUE INDEX ux_sales_active_vehicle ON sales(vehicle_id) WHERE status = 'active';
CREATE INDEX ix_sales_date ON sales(sale_date);
CREATE INDEX ix_sales_customer ON sales(customer_id);
CREATE INDEX ix_sales_salesperson ON sales(salesperson_id);

CREATE TABLE trade_ins (
  id INTEGER PRIMARY KEY,
  trade_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  sale_id INTEGER REFERENCES sales(id),
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  trim TEXT,
  model_year INTEGER NOT NULL,
  color TEXT,
  vin TEXT,
  engine_no TEXT,
  plate_no TEXT,
  mileage INTEGER NOT NULL DEFAULT 0 CHECK (mileage >= 0),
  condition_notes TEXT,
  condition_grade TEXT NOT NULL DEFAULT 'good' CHECK (condition_grade IN ('excellent','good','fair','poor')),
  market_value INTEGER NOT NULL DEFAULT 0 CHECK (market_value >= 0),
  trade_in_value INTEGER NOT NULL CHECK (trade_in_value > 0),
  expected_prep_cost INTEGER NOT NULL DEFAULT 0 CHECK (expected_prep_cost >= 0),
  expected_selling_price INTEGER NOT NULL DEFAULT 0 CHECK (expected_selling_price >= 0),
  status TEXT NOT NULL DEFAULT 'evaluated' CHECK (status IN ('evaluated','accepted','rejected')),
  vehicle_id INTEGER REFERENCES vehicles(id),
  eval_date TEXT NOT NULL,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX ix_tradeins_customer ON trade_ins(customer_id);

CREATE TABLE installment_contracts (
  id INTEGER PRIMARY KEY,
  contract_no TEXT NOT NULL UNIQUE,
  sale_id INTEGER NOT NULL UNIQUE REFERENCES sales(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  financed_amount INTEGER NOT NULL CHECK (financed_amount > 0),
  plan_type TEXT NOT NULL CHECK (plan_type IN ('equal','custom','balloon')),
  installments_count INTEGER NOT NULL CHECK (installments_count > 0),
  first_due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','settled','cancelled')),
  schedule_version INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  settled_at TEXT
);
CREATE INDEX ix_contracts_customer ON installment_contracts(customer_id);

CREATE TABLE installments (
  id INTEGER PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES installment_contracts(id),
  seq INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  paid_amount INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  waived_amount INTEGER NOT NULL DEFAULT 0 CHECK (waived_amount >= 0),
  schedule_version INTEGER NOT NULL DEFAULT 1,
  is_cancelled INTEGER NOT NULL DEFAULT 0 CHECK (is_cancelled IN (0,1)),
  paid_at TEXT,
  notes TEXT,
  CHECK (paid_amount + waived_amount <= amount)
);
CREATE INDEX ix_inst_contract ON installments(contract_id, is_cancelled, seq);
CREATE INDEX ix_inst_due ON installments(due_date, is_cancelled);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  receipt_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  sale_id INTEGER REFERENCES sales(id),
  contract_id INTEGER REFERENCES installment_contracts(id),
  reservation_id INTEGER REFERENCES reservations(id),
  kind TEXT NOT NULL CHECK (kind IN ('reservation','down_payment','cash_sale','installment','early_settlement','refund')),
  pay_date TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash','bank_transfer','cheque','card','other')),
  reference TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','voided')),
  void_reason TEXT,
  voided_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  CHECK (kind NOT IN ('installment','early_settlement') OR contract_id IS NOT NULL),
  CHECK (kind <> 'reservation' OR reservation_id IS NOT NULL),
  CHECK (kind NOT IN ('down_payment','cash_sale') OR sale_id IS NOT NULL)
);
CREATE INDEX ix_payments_customer ON payments(customer_id, status);
CREATE INDEX ix_payments_contract ON payments(contract_id);
CREATE INDEX ix_payments_sale ON payments(sale_id);
CREATE INDEX ix_payments_date ON payments(pay_date, status);

CREATE TABLE payment_allocations (
  id INTEGER PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES payments(id),
  installment_id INTEGER NOT NULL REFERENCES installments(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX ix_alloc_payment ON payment_allocations(payment_id);
CREATE INDEX ix_alloc_installment ON payment_allocations(installment_id);

-- Keep installments.paid_amount consistent with allocations at the database level.
CREATE TRIGGER trg_alloc_insert AFTER INSERT ON payment_allocations
BEGIN
  UPDATE installments SET paid_amount = paid_amount + NEW.amount WHERE id = NEW.installment_id;
END;
CREATE TRIGGER trg_alloc_delete AFTER DELETE ON payment_allocations
BEGIN
  UPDATE installments SET paid_amount = paid_amount - OLD.amount WHERE id = OLD.installment_id;
END;
CREATE TRIGGER trg_alloc_no_update BEFORE UPDATE ON payment_allocations
BEGIN
  SELECT RAISE(ABORT, 'ALLOCATION_IMMUTABLE');
END;

CREATE TABLE reschedules (
  id INTEGER PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES installment_contracts(id),
  reschedule_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  old_schedule TEXT NOT NULL,
  new_schedule TEXT NOT NULL,
  from_version INTEGER NOT NULL,
  to_version INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY,
  expense_no TEXT NOT NULL UNIQUE,
  expense_date TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'general' CHECK (scope IN ('general','sale')),
  category TEXT NOT NULL CHECK (category IN
    ('rent','salaries','electricity','marketing','transportation','maintenance','office','commission','other')),
  description TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  sale_id INTEGER REFERENCES sales(id),
  payee TEXT,
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','bank_transfer','cheque','card','other')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT,
  deleted_at TEXT,
  CHECK (scope <> 'sale' OR sale_id IS NOT NULL)
);
CREATE INDEX ix_expenses_date ON expenses(expense_date, deleted_at);
CREATE INDEX ix_expenses_category ON expenses(category);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  username TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  action TEXT NOT NULL,
  module TEXT NOT NULL,
  record_type TEXT,
  record_id TEXT,
  record_label TEXT,
  old_value TEXT,
  new_value TEXT,
  details TEXT
);
CREATE INDEX ix_audit_date ON audit_logs(created_at);
CREATE INDEX ix_audit_module ON audit_logs(module, record_id);
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE');
END;
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE');
END;

CREATE TABLE backups (
  id INTEGER PRIMARY KEY,
  file_path TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('manual','auto','pre_restore')),
  size_bytes INTEGER,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Business guards at the DB level (defence in depth; services validate first with friendly messages).
CREATE TRIGGER trg_reservation_vehicle_guard BEFORE INSERT ON reservations
WHEN (SELECT status FROM vehicles WHERE id = NEW.vehicle_id) IN ('sold','delivered')
BEGIN
  SELECT RAISE(ABORT, 'VEHICLE_ALREADY_SOLD');
END;
CREATE TRIGGER trg_sale_vehicle_guard BEFORE INSERT ON sales
WHEN (SELECT status FROM vehicles WHERE id = NEW.vehicle_id) IN ('sold','delivered')
BEGIN
  SELECT RAISE(ABORT, 'VEHICLE_ALREADY_SOLD');
END;

-- Actual cost per vehicle = sum of all non-deleted direct cost lines.
CREATE VIEW v_vehicle_cost AS
SELECT v.id AS vehicle_id,
       COALESCE(SUM(CASE WHEN e.category IN ('purchase','trade_in') THEN e.amount END), 0) AS acquisition_cost,
       COALESCE(SUM(CASE WHEN e.category NOT IN ('purchase','trade_in') THEN e.amount END), 0) AS direct_costs,
       COALESCE(SUM(e.amount), 0) AS actual_cost
FROM vehicles v
LEFT JOIN vehicle_expenses e ON e.vehicle_id = v.id AND e.deleted_at IS NULL
GROUP BY v.id;
`,
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export function migrate(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`);
  const current = db.scalar<number>('SELECT COALESCE(MAX(version),0) AS v FROM schema_migrations') ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.tx(() => {
      db.exec(m.sql);
      db.run('INSERT INTO schema_migrations(version, name) VALUES (?, ?)', [m.version, m.name]);
    });
  }
}
