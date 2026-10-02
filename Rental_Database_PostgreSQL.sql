-- Proposed PostgreSQL schema for Rental Web System

-- Design baseline: review workflow rules in Rental_Web_Requirements.md before implementation.

BEGIN;

CREATE TABLE company_settings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name varchar(200) NOT NULL,
  address text,
  tax_id varchar(30),
  currency char(3) NOT NULL DEFAULT 'THB',
  default_language varchar(10) NOT NULL DEFAULT 'th'
);

CREATE TABLE properties (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code varchar(30) NOT NULL UNIQUE,
  name varchar(200) NOT NULL,
  address text
);

CREATE TABLE buildings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  property_id bigint NOT NULL,
  code varchar(30) NOT NULL,
  name varchar(200) NOT NULL,
  UNIQUE(property_id,code)
);

CREATE TABLE floors (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  building_id bigint NOT NULL,
  code varchar(30) NOT NULL,
  UNIQUE(building_id,code)
);

CREATE TABLE room_types (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code varchar(30) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  default_rent numeric(14,2) NOT NULL,
  capacity integer NOT NULL,
  CHECK(default_rent>=0 AND capacity>0)
);

CREATE TABLE rooms (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  floor_id bigint NOT NULL,
  room_type_id bigint NOT NULL,
  code varchar(30) NOT NULL,
  operational_status varchar(20) NOT NULL DEFAULT 'available',
  base_rent numeric(14,2) NOT NULL,
  UNIQUE(floor_id,code),
  CHECK(operational_status IN ('available','maintenance','disabled')),
  CHECK(base_rent>=0)
);

CREATE TABLE assets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code varchar(30) NOT NULL UNIQUE,
  name varchar(150) NOT NULL
);

CREATE TABLE room_assets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id bigint NOT NULL,
  asset_id bigint NOT NULL,
  quantity integer NOT NULL,
  condition_note text,
  UNIQUE(room_id,asset_id),
  CHECK(quantity>0)
);

CREATE TABLE nationalities (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code varchar(30) NOT NULL UNIQUE,
  name varchar(150) NOT NULL
);

CREATE TABLE occupations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code varchar(30) NOT NULL UNIQUE,
  name varchar(150) NOT NULL
);

CREATE TABLE customer_groups (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code varchar(30) NOT NULL UNIQUE,
  name varchar(150) NOT NULL
);

CREATE TABLE supplier_groups (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code varchar(30) NOT NULL UNIQUE,
  name varchar(150) NOT NULL
);

CREATE TABLE customers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_group_id bigint,
  nationality_id bigint,
  occupation_id bigint,
  code varchar(30) NOT NULL UNIQUE,
  full_name varchar(200) NOT NULL,
  phone varchar(40),
  email varchar(254),
  birth_date date,
  identity_reference text,
  address text,
  photo_object_key text
);

CREATE TABLE suppliers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_group_id bigint,
  code varchar(30) NOT NULL UNIQUE,
  name varchar(200) NOT NULL,
  tax_id varchar(30),
  phone varchar(40),
  address text
);

CREATE TABLE roles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code varchar(30) NOT NULL UNIQUE,
  name varchar(100) NOT NULL
);

CREATE TABLE permissions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code varchar(100) NOT NULL UNIQUE,
  description text
);

CREATE TABLE users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username varchar(100) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name varchar(200) NOT NULL,
  customer_id bigint,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE user_roles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL,
  role_id bigint NOT NULL,
  UNIQUE(user_id,role_id)
);

CREATE TABLE role_permissions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_id bigint NOT NULL,
  permission_id bigint NOT NULL,
  UNIQUE(role_id,permission_id)
);

CREATE TABLE document_sequences (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_type varchar(30) NOT NULL,
  period_key varchar(10) NOT NULL,
  prefix varchar(30) NOT NULL,
  next_number bigint NOT NULL,
  UNIQUE(document_type,period_key),
  CHECK(next_number>0)
);

CREATE TABLE audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint,
  action varchar(30) NOT NULL,
  entity_type varchar(50) NOT NULL,
  entity_id bigint,
  before_data jsonb,
  after_data jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  ip_address inet
);

CREATE TABLE attachments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  uploaded_by bigint NOT NULL,
  entity_type varchar(50) NOT NULL,
  entity_id bigint NOT NULL,
  object_key text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bookings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id bigint NOT NULL,
  customer_id bigint NOT NULL,
  created_by bigint NOT NULL,
  document_no varchar(30) NOT NULL UNIQUE,
  booked_at timestamptz NOT NULL,
  planned_start date NOT NULL,
  planned_end date NOT NULL,
  expires_at timestamptz,
  status varchar(20) NOT NULL DEFAULT 'pending',
  document_group_id bigint,
  CHECK(planned_end>=planned_start),
  CHECK(status IN ('pending','confirmed','converted','cancelled','expired'))
);

CREATE TABLE contracts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL,
  booking_id bigint UNIQUE,
  created_by bigint NOT NULL,
  document_no varchar(30) NOT NULL UNIQUE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  rental_cycle varchar(10) NOT NULL,
  rent_amount numeric(14,2) NOT NULL,
  deposit_required numeric(14,2) NOT NULL DEFAULT 0,
  billing_day smallint NOT NULL,
  due_days smallint NOT NULL DEFAULT 7,
  status varchar(20) NOT NULL DEFAULT 'draft',
  document_group_id bigint,
  CHECK(end_date>=start_date AND rent_amount>=0 AND deposit_required>=0),
  CHECK(rental_cycle IN ('monthly','yearly')),
  CHECK(billing_day BETWEEN 1 AND 28 AND due_days>=0),
  CHECK(status IN ('draft','active','ended','cancelled'))
);

CREATE TABLE contract_residents (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contract_id bigint NOT NULL,
  customer_id bigint NOT NULL,
  move_in date NOT NULL,
  move_out date,
  CHECK(move_out IS NULL OR move_out>=move_in),
  UNIQUE(contract_id,customer_id,move_in)
);

CREATE TABLE contract_room_assignments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contract_id bigint NOT NULL,
  room_id bigint NOT NULL,
  start_date date NOT NULL,
  end_date date,
  rent_snapshot numeric(14,2) NOT NULL,
  meter_handover jsonb,
  CHECK(end_date IS NULL OR end_date>=start_date),
  CHECK(rent_snapshot>=0)
);

CREATE TABLE charges (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code varchar(30) NOT NULL UNIQUE,
  name varchar(150) NOT NULL,
  category varchar(30) NOT NULL,
  default_amount numeric(14,2) NOT NULL DEFAULT 0,
  tax_mode varchar(10) NOT NULL,
  tax_rate numeric(7,4) NOT NULL DEFAULT 0,
  account_id bigint NOT NULL,
  CHECK(tax_mode IN ('none','inclusive','exclusive')),
  CHECK(default_amount>=0 AND tax_rate>=0)
);

CREATE TABLE contract_charges (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contract_id bigint NOT NULL,
  charge_id bigint NOT NULL,
  amount numeric(14,2) NOT NULL,
  start_date date NOT NULL,
  end_date date,
  CHECK(amount>=0 AND (end_date IS NULL OR end_date>=start_date))
);

CREATE TABLE accounts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code varchar(30) NOT NULL UNIQUE,
  name varchar(150) NOT NULL,
  account_type varchar(20) NOT NULL,
  parent_id bigint,
  CHECK(account_type IN ('asset','liability','equity','income','expense'))
);

CREATE TABLE bank_accounts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id bigint NOT NULL,
  code varchar(30) NOT NULL UNIQUE,
  name varchar(150) NOT NULL,
  kind varchar(10) NOT NULL,
  bank_name varchar(150),
  account_reference varchar(100),
  CHECK(kind IN ('cash','bank','clearing'))
);

CREATE TABLE billing_periods (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  property_id bigint NOT NULL,
  code varchar(30) NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'open',
  UNIQUE(property_id,code),
  CHECK(end_date>=start_date),
  CHECK(status IN ('open','closed'))
);

CREATE TABLE utility_tariffs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  property_id bigint NOT NULL,
  utility_type varchar(10) NOT NULL,
  name varchar(150) NOT NULL,
  pricing_method varchar(10) NOT NULL,
  unit_rate numeric(14,4) NOT NULL DEFAULT 0,
  fixed_amount numeric(14,2) NOT NULL DEFAULT 0,
  effective_from date NOT NULL,
  effective_to date,
  charge_id bigint NOT NULL,
  CHECK(utility_type IN ('water','electricity')),
  CHECK(pricing_method IN ('meter','flat','tiered')),
  CHECK(unit_rate>=0 AND fixed_amount>=0 AND (effective_to IS NULL OR effective_to>=effective_from))
);

CREATE TABLE utility_tariff_tiers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tariff_id bigint NOT NULL,
  lower_unit numeric(14,3) NOT NULL,
  upper_unit numeric(14,3),
  unit_rate numeric(14,4) NOT NULL,
  CHECK(lower_unit>=0 AND unit_rate>=0 AND (upper_unit IS NULL OR upper_unit>lower_unit))
);

CREATE TABLE meters (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id bigint NOT NULL,
  tariff_id bigint NOT NULL,
  serial_no varchar(100) NOT NULL,
  utility_type varchar(10) NOT NULL,
  rollover_value numeric(14,3),
  installed_at date NOT NULL,
  removed_at date,
  CHECK(utility_type IN ('water','electricity')),
  CHECK(rollover_value IS NULL OR rollover_value>0),
  CHECK(removed_at IS NULL OR removed_at>=installed_at)
);

CREATE TABLE meter_readings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  meter_id bigint NOT NULL,
  billing_period_id bigint NOT NULL,
  recorded_by bigint NOT NULL,
  read_at timestamptz NOT NULL,
  previous_value numeric(14,3) NOT NULL,
  current_value numeric(14,3) NOT NULL,
  rollover_count integer NOT NULL DEFAULT 0,
  units_used numeric(14,3) NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  UNIQUE(meter_id,billing_period_id),
  CHECK(previous_value>=0 AND current_value>=0 AND rollover_count>=0 AND units_used>=0)
);

CREATE TABLE invoices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contract_id bigint,
  billing_period_id bigint,
  revision_no integer NOT NULL DEFAULT 1,
  document_no varchar(30) NOT NULL UNIQUE,
  issued_at date NOT NULL,
  due_date date NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'draft',
  subtotal numeric(14,2) NOT NULL,
  tax_total numeric(14,2) NOT NULL,
  total numeric(14,2) NOT NULL,
  supersedes_id bigint,
  created_by bigint NOT NULL,
  document_group_id bigint,
  customer_id bigint NOT NULL,
  invoice_kind varchar(10) NOT NULL DEFAULT 'recurring',
  document_snapshot jsonb NOT NULL,
  UNIQUE(contract_id,billing_period_id,revision_no),
  CHECK(status IN ('draft','issued','void')),
  CHECK(due_date>=issued_at AND subtotal>=0 AND tax_total>=0 AND total>=0 AND revision_no>0),
  CHECK(invoice_kind IN ('recurring','one_off')),
  CHECK(invoice_kind<>'recurring' OR (contract_id IS NOT NULL AND billing_period_id IS NOT NULL))
);

CREATE TABLE invoice_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id bigint NOT NULL,
  charge_id bigint NOT NULL,
  meter_reading_id bigint,
  room_assignment_id bigint,
  description text NOT NULL,
  quantity numeric(14,3) NOT NULL,
  unit_price numeric(14,4) NOT NULL,
  tax_mode varchar(10) NOT NULL,
  tax_rate numeric(7,4) NOT NULL,
  net_amount numeric(14,2) NOT NULL,
  tax_amount numeric(14,2) NOT NULL,
  line_total numeric(14,2) NOT NULL,
  calculation_snapshot jsonb NOT NULL,
  CHECK(quantity>=0 AND unit_price>=0 AND net_amount>=0 AND tax_amount>=0 AND line_total>=0),
  CHECK(tax_mode IN ('none','inclusive','exclusive')),
  CHECK(tax_rate>=0)
);

CREATE TABLE payments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL,
  bank_account_id bigint NOT NULL,
  received_by bigint NOT NULL,
  document_no varchar(30) NOT NULL UNIQUE,
  received_at timestamptz NOT NULL,
  amount numeric(14,2) NOT NULL,
  method varchar(15) NOT NULL,
  reference varchar(150),
  status varchar(10) NOT NULL DEFAULT 'pending',
  document_group_id bigint,
  payment_category varchar(30),
  CHECK(amount>0),
  CHECK(method IN ('cash','transfer','cheque','card')),
  CHECK(status IN ('pending','confirmed','void'))
);

CREATE TABLE payment_allocations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id bigint NOT NULL,
  invoice_id bigint NOT NULL,
  amount numeric(14,2) NOT NULL,
  UNIQUE(payment_id,invoice_id),
  CHECK(amount>0)
);

CREATE TABLE receipts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id bigint NOT NULL UNIQUE,
  document_no varchar(30) NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'issued',
  document_snapshot jsonb NOT NULL,
  document_group_id bigint,
  CHECK(status IN ('issued','void'))
);

CREATE TABLE fund_transactions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id bigint,
  contract_id bigint,
  invoice_id bigint,
  bank_account_id bigint,
  recorded_by bigint NOT NULL,
  document_no varchar(30) NOT NULL UNIQUE,
  fund_type varchar(12) NOT NULL,
  transaction_type varchar(20) NOT NULL,
  amount numeric(14,2) NOT NULL,
  occurred_at timestamptz NOT NULL,
  related_transaction_id bigint,
  status varchar(10) NOT NULL DEFAULT 'posted',
  method varchar(15),
  document_group_id bigint,
  CHECK(amount>0 AND (booking_id IS NOT NULL OR contract_id IS NOT NULL)),
  CHECK(fund_type IN ('reservation','deposit','advance')),
  CHECK(transaction_type IN ('receive','refund','apply_invoice','transfer_in','transfer_out','reversal')),
  CHECK(status IN ('posted','void')),
  CHECK(transaction_type<>'apply_invoice' OR (invoice_id IS NOT NULL AND contract_id IS NOT NULL)),
  CHECK(method IS NULL OR method IN ('cash','transfer','cheque','card')),
  CHECK(transaction_type NOT IN ('receive','refund') OR (bank_account_id IS NOT NULL AND method IS NOT NULL))
);

CREATE TABLE expenses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_id bigint,
  customer_id bigint,
  bank_account_id bigint NOT NULL,
  created_by bigint NOT NULL,
  document_no varchar(30) NOT NULL UNIQUE,
  expense_date date NOT NULL,
  payment_method varchar(15) NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'draft',
  supplier_document_no varchar(100),
  total numeric(14,2) NOT NULL,
  document_group_id bigint,
  payment_category varchar(30),
  CHECK(total>=0),
  CHECK(status IN ('draft','posted','void')),
  CHECK(payment_method IN ('cash','transfer','cheque','card'))
);

CREATE TABLE expense_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expense_id bigint NOT NULL,
  account_id bigint NOT NULL,
  description text NOT NULL,
  net_amount numeric(14,2) NOT NULL,
  tax_mode varchar(10) NOT NULL,
  tax_rate numeric(7,4) NOT NULL,
  tax_amount numeric(14,2) NOT NULL,
  line_total numeric(14,2) NOT NULL,
  CHECK(net_amount>=0 AND tax_amount>=0 AND line_total>=0 AND tax_rate>=0),
  CHECK(tax_mode IN ('none','inclusive','exclusive'))
);

CREATE TABLE journal_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id bigint,
  invoice_id bigint,
  expense_id bigint,
  fund_transaction_id bigint,
  reverses_id bigint,
  posted_by bigint NOT NULL,
  document_no varchar(30) NOT NULL UNIQUE,
  entry_date date NOT NULL,
  description text NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'draft',
  document_group_id bigint,
  CHECK(status IN ('draft','posted','void')),
  CHECK(num_nonnulls(payment_id,invoice_id,expense_id,fund_transaction_id)<=1)
);

CREATE TABLE journal_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journal_entry_id bigint NOT NULL,
  account_id bigint NOT NULL,
  debit numeric(14,2) NOT NULL DEFAULT 0,
  credit numeric(14,2) NOT NULL DEFAULT 0,
  CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0))
);

CREATE TABLE maintenance_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id bigint NOT NULL,
  contract_id bigint,
  reported_by bigint NOT NULL,
  document_no varchar(30) NOT NULL UNIQUE,
  description text NOT NULL,
  priority varchar(10) NOT NULL,
  status varchar(15) NOT NULL DEFAULT 'new',
  reported_at timestamptz NOT NULL,
  closed_at timestamptz,
  CHECK(status IN ('new','assigned','in_progress','completed','cancelled'))
);

CREATE TABLE maintenance_jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id bigint NOT NULL,
  assigned_user_id bigint,
  supplier_id bigint,
  expense_id bigint,
  charge_invoice_item_id bigint,
  started_at timestamptz,
  completed_at timestamptz,
  work_note text,
  cost numeric(14,2) NOT NULL DEFAULT 0,
  payer varchar(10) NOT NULL,
  CHECK(cost>=0),
  CHECK(payer IN ('business','tenant'))
);

CREATE TABLE complaints (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id bigint NOT NULL,
  contract_id bigint,
  reported_by bigint NOT NULL,
  received_by bigint,
  assigned_to bigint,
  maintenance_request_id bigint,
  document_no varchar(30) NOT NULL UNIQUE,
  description text NOT NULL,
  resolution text,
  status varchar(15) NOT NULL DEFAULT 'new',
  reported_at timestamptz NOT NULL,
  closed_at timestamptz,
  CHECK(status IN ('new','in_progress','resolved','cancelled'))
);

CREATE TABLE document_groups (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code varchar(30) NOT NULL UNIQUE,
  name varchar(150) NOT NULL
);

CREATE TABLE room_utility_tariffs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id bigint NOT NULL,
  tariff_id bigint NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  CHECK(effective_to IS NULL OR effective_to>=effective_from)
);

ALTER TABLE buildings ADD CONSTRAINT fk_buildings_property_id FOREIGN KEY (property_id) REFERENCES properties(id);

CREATE INDEX ix_buildings_property_id ON buildings(property_id);

ALTER TABLE floors ADD CONSTRAINT fk_floors_building_id FOREIGN KEY (building_id) REFERENCES buildings(id);

CREATE INDEX ix_floors_building_id ON floors(building_id);

ALTER TABLE rooms ADD CONSTRAINT fk_rooms_floor_id FOREIGN KEY (floor_id) REFERENCES floors(id);

CREATE INDEX ix_rooms_floor_id ON rooms(floor_id);

ALTER TABLE rooms ADD CONSTRAINT fk_rooms_room_type_id FOREIGN KEY (room_type_id) REFERENCES room_types(id);

CREATE INDEX ix_rooms_room_type_id ON rooms(room_type_id);

ALTER TABLE room_assets ADD CONSTRAINT fk_room_assets_room_id FOREIGN KEY (room_id) REFERENCES rooms(id);

CREATE INDEX ix_room_assets_room_id ON room_assets(room_id);

ALTER TABLE room_assets ADD CONSTRAINT fk_room_assets_asset_id FOREIGN KEY (asset_id) REFERENCES assets(id);

CREATE INDEX ix_room_assets_asset_id ON room_assets(asset_id);

ALTER TABLE customers ADD CONSTRAINT fk_customers_customer_group_id FOREIGN KEY (customer_group_id) REFERENCES customer_groups(id);

CREATE INDEX ix_customers_customer_group_id ON customers(customer_group_id);

ALTER TABLE customers ADD CONSTRAINT fk_customers_nationality_id FOREIGN KEY (nationality_id) REFERENCES nationalities(id);

CREATE INDEX ix_customers_nationality_id ON customers(nationality_id);

ALTER TABLE customers ADD CONSTRAINT fk_customers_occupation_id FOREIGN KEY (occupation_id) REFERENCES occupations(id);

CREATE INDEX ix_customers_occupation_id ON customers(occupation_id);

ALTER TABLE suppliers ADD CONSTRAINT fk_suppliers_supplier_group_id FOREIGN KEY (supplier_group_id) REFERENCES supplier_groups(id);

CREATE INDEX ix_suppliers_supplier_group_id ON suppliers(supplier_group_id);

ALTER TABLE users ADD CONSTRAINT fk_users_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id);

CREATE INDEX ix_users_customer_id ON users(customer_id);

ALTER TABLE user_roles ADD CONSTRAINT fk_user_roles_user_id FOREIGN KEY (user_id) REFERENCES users(id);

CREATE INDEX ix_user_roles_user_id ON user_roles(user_id);

ALTER TABLE user_roles ADD CONSTRAINT fk_user_roles_role_id FOREIGN KEY (role_id) REFERENCES roles(id);

CREATE INDEX ix_user_roles_role_id ON user_roles(role_id);

ALTER TABLE role_permissions ADD CONSTRAINT fk_role_permissions_role_id FOREIGN KEY (role_id) REFERENCES roles(id);

CREATE INDEX ix_role_permissions_role_id ON role_permissions(role_id);

ALTER TABLE role_permissions ADD CONSTRAINT fk_role_permissions_permission_id FOREIGN KEY (permission_id) REFERENCES permissions(id);

CREATE INDEX ix_role_permissions_permission_id ON role_permissions(permission_id);

ALTER TABLE audit_logs ADD CONSTRAINT fk_audit_logs_user_id FOREIGN KEY (user_id) REFERENCES users(id);

CREATE INDEX ix_audit_logs_user_id ON audit_logs(user_id);

ALTER TABLE attachments ADD CONSTRAINT fk_attachments_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id);

CREATE INDEX ix_attachments_uploaded_by ON attachments(uploaded_by);

ALTER TABLE bookings ADD CONSTRAINT fk_bookings_room_id FOREIGN KEY (room_id) REFERENCES rooms(id);

CREATE INDEX ix_bookings_room_id ON bookings(room_id);

ALTER TABLE bookings ADD CONSTRAINT fk_bookings_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id);

CREATE INDEX ix_bookings_customer_id ON bookings(customer_id);

ALTER TABLE bookings ADD CONSTRAINT fk_bookings_created_by FOREIGN KEY (created_by) REFERENCES users(id);

CREATE INDEX ix_bookings_created_by ON bookings(created_by);

ALTER TABLE bookings ADD CONSTRAINT fk_bookings_document_group_id FOREIGN KEY (document_group_id) REFERENCES document_groups(id);

CREATE INDEX ix_bookings_document_group_id ON bookings(document_group_id);

ALTER TABLE contracts ADD CONSTRAINT fk_contracts_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id);

CREATE INDEX ix_contracts_customer_id ON contracts(customer_id);

ALTER TABLE contracts ADD CONSTRAINT fk_contracts_booking_id FOREIGN KEY (booking_id) REFERENCES bookings(id);

CREATE INDEX ix_contracts_booking_id ON contracts(booking_id);

ALTER TABLE contracts ADD CONSTRAINT fk_contracts_created_by FOREIGN KEY (created_by) REFERENCES users(id);

CREATE INDEX ix_contracts_created_by ON contracts(created_by);

ALTER TABLE contracts ADD CONSTRAINT fk_contracts_document_group_id FOREIGN KEY (document_group_id) REFERENCES document_groups(id);

CREATE INDEX ix_contracts_document_group_id ON contracts(document_group_id);

ALTER TABLE contract_residents ADD CONSTRAINT fk_contract_residents_contract_id FOREIGN KEY (contract_id) REFERENCES contracts(id);

CREATE INDEX ix_contract_residents_contract_id ON contract_residents(contract_id);

ALTER TABLE contract_residents ADD CONSTRAINT fk_contract_residents_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id);

CREATE INDEX ix_contract_residents_customer_id ON contract_residents(customer_id);

ALTER TABLE contract_room_assignments ADD CONSTRAINT fk_contract_room_assignments_contract_id FOREIGN KEY (contract_id) REFERENCES contracts(id);

CREATE INDEX ix_contract_room_assignments_contract_id ON contract_room_assignments(contract_id);

ALTER TABLE contract_room_assignments ADD CONSTRAINT fk_contract_room_assignments_room_id FOREIGN KEY (room_id) REFERENCES rooms(id);

CREATE INDEX ix_contract_room_assignments_room_id ON contract_room_assignments(room_id);

ALTER TABLE charges ADD CONSTRAINT fk_charges_account_id FOREIGN KEY (account_id) REFERENCES accounts(id);

CREATE INDEX ix_charges_account_id ON charges(account_id);

ALTER TABLE contract_charges ADD CONSTRAINT fk_contract_charges_contract_id FOREIGN KEY (contract_id) REFERENCES contracts(id);

CREATE INDEX ix_contract_charges_contract_id ON contract_charges(contract_id);

ALTER TABLE contract_charges ADD CONSTRAINT fk_contract_charges_charge_id FOREIGN KEY (charge_id) REFERENCES charges(id);

CREATE INDEX ix_contract_charges_charge_id ON contract_charges(charge_id);

ALTER TABLE accounts ADD CONSTRAINT fk_accounts_parent_id FOREIGN KEY (parent_id) REFERENCES accounts(id);

CREATE INDEX ix_accounts_parent_id ON accounts(parent_id);

ALTER TABLE bank_accounts ADD CONSTRAINT fk_bank_accounts_account_id FOREIGN KEY (account_id) REFERENCES accounts(id);

CREATE INDEX ix_bank_accounts_account_id ON bank_accounts(account_id);

ALTER TABLE billing_periods ADD CONSTRAINT fk_billing_periods_property_id FOREIGN KEY (property_id) REFERENCES properties(id);

CREATE INDEX ix_billing_periods_property_id ON billing_periods(property_id);

ALTER TABLE utility_tariffs ADD CONSTRAINT fk_utility_tariffs_property_id FOREIGN KEY (property_id) REFERENCES properties(id);

CREATE INDEX ix_utility_tariffs_property_id ON utility_tariffs(property_id);

ALTER TABLE utility_tariffs ADD CONSTRAINT fk_utility_tariffs_charge_id FOREIGN KEY (charge_id) REFERENCES charges(id);

CREATE INDEX ix_utility_tariffs_charge_id ON utility_tariffs(charge_id);

ALTER TABLE utility_tariff_tiers ADD CONSTRAINT fk_utility_tariff_tiers_tariff_id FOREIGN KEY (tariff_id) REFERENCES utility_tariffs(id);

CREATE INDEX ix_utility_tariff_tiers_tariff_id ON utility_tariff_tiers(tariff_id);

ALTER TABLE meters ADD CONSTRAINT fk_meters_room_id FOREIGN KEY (room_id) REFERENCES rooms(id);

CREATE INDEX ix_meters_room_id ON meters(room_id);

ALTER TABLE meters ADD CONSTRAINT fk_meters_tariff_id FOREIGN KEY (tariff_id) REFERENCES utility_tariffs(id);

CREATE INDEX ix_meters_tariff_id ON meters(tariff_id);

ALTER TABLE meter_readings ADD CONSTRAINT fk_meter_readings_meter_id FOREIGN KEY (meter_id) REFERENCES meters(id);

CREATE INDEX ix_meter_readings_meter_id ON meter_readings(meter_id);

ALTER TABLE meter_readings ADD CONSTRAINT fk_meter_readings_billing_period_id FOREIGN KEY (billing_period_id) REFERENCES billing_periods(id);

CREATE INDEX ix_meter_readings_billing_period_id ON meter_readings(billing_period_id);

ALTER TABLE meter_readings ADD CONSTRAINT fk_meter_readings_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(id);

CREATE INDEX ix_meter_readings_recorded_by ON meter_readings(recorded_by);

ALTER TABLE invoices ADD CONSTRAINT fk_invoices_contract_id FOREIGN KEY (contract_id) REFERENCES contracts(id);

CREATE INDEX ix_invoices_contract_id ON invoices(contract_id);

ALTER TABLE invoices ADD CONSTRAINT fk_invoices_billing_period_id FOREIGN KEY (billing_period_id) REFERENCES billing_periods(id);

CREATE INDEX ix_invoices_billing_period_id ON invoices(billing_period_id);

ALTER TABLE invoices ADD CONSTRAINT fk_invoices_supersedes_id FOREIGN KEY (supersedes_id) REFERENCES invoices(id);

CREATE INDEX ix_invoices_supersedes_id ON invoices(supersedes_id);

ALTER TABLE invoices ADD CONSTRAINT fk_invoices_created_by FOREIGN KEY (created_by) REFERENCES users(id);

CREATE INDEX ix_invoices_created_by ON invoices(created_by);

ALTER TABLE invoices ADD CONSTRAINT fk_invoices_document_group_id FOREIGN KEY (document_group_id) REFERENCES document_groups(id);

CREATE INDEX ix_invoices_document_group_id ON invoices(document_group_id);

ALTER TABLE invoices ADD CONSTRAINT fk_invoices_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id);

CREATE INDEX ix_invoices_customer_id ON invoices(customer_id);

ALTER TABLE invoice_items ADD CONSTRAINT fk_invoice_items_invoice_id FOREIGN KEY (invoice_id) REFERENCES invoices(id);

CREATE INDEX ix_invoice_items_invoice_id ON invoice_items(invoice_id);

ALTER TABLE invoice_items ADD CONSTRAINT fk_invoice_items_charge_id FOREIGN KEY (charge_id) REFERENCES charges(id);

CREATE INDEX ix_invoice_items_charge_id ON invoice_items(charge_id);

ALTER TABLE invoice_items ADD CONSTRAINT fk_invoice_items_meter_reading_id FOREIGN KEY (meter_reading_id) REFERENCES meter_readings(id);

CREATE INDEX ix_invoice_items_meter_reading_id ON invoice_items(meter_reading_id);

ALTER TABLE invoice_items ADD CONSTRAINT fk_invoice_items_room_assignment_id FOREIGN KEY (room_assignment_id) REFERENCES contract_room_assignments(id);

CREATE INDEX ix_invoice_items_room_assignment_id ON invoice_items(room_assignment_id);

ALTER TABLE payments ADD CONSTRAINT fk_payments_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id);

CREATE INDEX ix_payments_customer_id ON payments(customer_id);

ALTER TABLE payments ADD CONSTRAINT fk_payments_bank_account_id FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id);

CREATE INDEX ix_payments_bank_account_id ON payments(bank_account_id);

ALTER TABLE payments ADD CONSTRAINT fk_payments_received_by FOREIGN KEY (received_by) REFERENCES users(id);

CREATE INDEX ix_payments_received_by ON payments(received_by);

ALTER TABLE payments ADD CONSTRAINT fk_payments_document_group_id FOREIGN KEY (document_group_id) REFERENCES document_groups(id);

CREATE INDEX ix_payments_document_group_id ON payments(document_group_id);

ALTER TABLE payment_allocations ADD CONSTRAINT fk_payment_allocations_payment_id FOREIGN KEY (payment_id) REFERENCES payments(id);

CREATE INDEX ix_payment_allocations_payment_id ON payment_allocations(payment_id);

ALTER TABLE payment_allocations ADD CONSTRAINT fk_payment_allocations_invoice_id FOREIGN KEY (invoice_id) REFERENCES invoices(id);

CREATE INDEX ix_payment_allocations_invoice_id ON payment_allocations(invoice_id);

ALTER TABLE receipts ADD CONSTRAINT fk_receipts_payment_id FOREIGN KEY (payment_id) REFERENCES payments(id);

CREATE INDEX ix_receipts_payment_id ON receipts(payment_id);

ALTER TABLE receipts ADD CONSTRAINT fk_receipts_document_group_id FOREIGN KEY (document_group_id) REFERENCES document_groups(id);

CREATE INDEX ix_receipts_document_group_id ON receipts(document_group_id);

ALTER TABLE fund_transactions ADD CONSTRAINT fk_fund_transactions_booking_id FOREIGN KEY (booking_id) REFERENCES bookings(id);

CREATE INDEX ix_fund_transactions_booking_id ON fund_transactions(booking_id);

ALTER TABLE fund_transactions ADD CONSTRAINT fk_fund_transactions_contract_id FOREIGN KEY (contract_id) REFERENCES contracts(id);

CREATE INDEX ix_fund_transactions_contract_id ON fund_transactions(contract_id);

ALTER TABLE fund_transactions ADD CONSTRAINT fk_fund_transactions_invoice_id FOREIGN KEY (invoice_id) REFERENCES invoices(id);

CREATE INDEX ix_fund_transactions_invoice_id ON fund_transactions(invoice_id);

ALTER TABLE fund_transactions ADD CONSTRAINT fk_fund_transactions_bank_account_id FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id);

CREATE INDEX ix_fund_transactions_bank_account_id ON fund_transactions(bank_account_id);

ALTER TABLE fund_transactions ADD CONSTRAINT fk_fund_transactions_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(id);

CREATE INDEX ix_fund_transactions_recorded_by ON fund_transactions(recorded_by);

ALTER TABLE fund_transactions ADD CONSTRAINT fk_fund_transactions_related_transaction_id FOREIGN KEY (related_transaction_id) REFERENCES fund_transactions(id);

CREATE INDEX ix_fund_transactions_related_transaction_id ON fund_transactions(related_transaction_id);

ALTER TABLE fund_transactions ADD CONSTRAINT fk_fund_transactions_document_group_id FOREIGN KEY (document_group_id) REFERENCES document_groups(id);

CREATE INDEX ix_fund_transactions_document_group_id ON fund_transactions(document_group_id);

ALTER TABLE expenses ADD CONSTRAINT fk_expenses_supplier_id FOREIGN KEY (supplier_id) REFERENCES suppliers(id);

CREATE INDEX ix_expenses_supplier_id ON expenses(supplier_id);

ALTER TABLE expenses ADD CONSTRAINT fk_expenses_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id);

CREATE INDEX ix_expenses_customer_id ON expenses(customer_id);

ALTER TABLE expenses ADD CONSTRAINT fk_expenses_bank_account_id FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id);

CREATE INDEX ix_expenses_bank_account_id ON expenses(bank_account_id);

ALTER TABLE expenses ADD CONSTRAINT fk_expenses_created_by FOREIGN KEY (created_by) REFERENCES users(id);

CREATE INDEX ix_expenses_created_by ON expenses(created_by);

ALTER TABLE expenses ADD CONSTRAINT fk_expenses_document_group_id FOREIGN KEY (document_group_id) REFERENCES document_groups(id);

CREATE INDEX ix_expenses_document_group_id ON expenses(document_group_id);

ALTER TABLE expense_items ADD CONSTRAINT fk_expense_items_expense_id FOREIGN KEY (expense_id) REFERENCES expenses(id);

CREATE INDEX ix_expense_items_expense_id ON expense_items(expense_id);

ALTER TABLE expense_items ADD CONSTRAINT fk_expense_items_account_id FOREIGN KEY (account_id) REFERENCES accounts(id);

CREATE INDEX ix_expense_items_account_id ON expense_items(account_id);

ALTER TABLE journal_entries ADD CONSTRAINT fk_journal_entries_payment_id FOREIGN KEY (payment_id) REFERENCES payments(id);

CREATE INDEX ix_journal_entries_payment_id ON journal_entries(payment_id);

ALTER TABLE journal_entries ADD CONSTRAINT fk_journal_entries_invoice_id FOREIGN KEY (invoice_id) REFERENCES invoices(id);

CREATE INDEX ix_journal_entries_invoice_id ON journal_entries(invoice_id);

ALTER TABLE journal_entries ADD CONSTRAINT fk_journal_entries_expense_id FOREIGN KEY (expense_id) REFERENCES expenses(id);

CREATE INDEX ix_journal_entries_expense_id ON journal_entries(expense_id);

ALTER TABLE journal_entries ADD CONSTRAINT fk_journal_entries_fund_transaction_id FOREIGN KEY (fund_transaction_id) REFERENCES fund_transactions(id);

CREATE INDEX ix_journal_entries_fund_transaction_id ON journal_entries(fund_transaction_id);

ALTER TABLE journal_entries ADD CONSTRAINT fk_journal_entries_reverses_id FOREIGN KEY (reverses_id) REFERENCES journal_entries(id);

CREATE INDEX ix_journal_entries_reverses_id ON journal_entries(reverses_id);

ALTER TABLE journal_entries ADD CONSTRAINT fk_journal_entries_posted_by FOREIGN KEY (posted_by) REFERENCES users(id);

CREATE INDEX ix_journal_entries_posted_by ON journal_entries(posted_by);

ALTER TABLE journal_entries ADD CONSTRAINT fk_journal_entries_document_group_id FOREIGN KEY (document_group_id) REFERENCES document_groups(id);

CREATE INDEX ix_journal_entries_document_group_id ON journal_entries(document_group_id);

ALTER TABLE journal_lines ADD CONSTRAINT fk_journal_lines_journal_entry_id FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id);

CREATE INDEX ix_journal_lines_journal_entry_id ON journal_lines(journal_entry_id);

ALTER TABLE journal_lines ADD CONSTRAINT fk_journal_lines_account_id FOREIGN KEY (account_id) REFERENCES accounts(id);

CREATE INDEX ix_journal_lines_account_id ON journal_lines(account_id);

ALTER TABLE maintenance_requests ADD CONSTRAINT fk_maintenance_requests_room_id FOREIGN KEY (room_id) REFERENCES rooms(id);

CREATE INDEX ix_maintenance_requests_room_id ON maintenance_requests(room_id);

ALTER TABLE maintenance_requests ADD CONSTRAINT fk_maintenance_requests_contract_id FOREIGN KEY (contract_id) REFERENCES contracts(id);

CREATE INDEX ix_maintenance_requests_contract_id ON maintenance_requests(contract_id);

ALTER TABLE maintenance_requests ADD CONSTRAINT fk_maintenance_requests_reported_by FOREIGN KEY (reported_by) REFERENCES users(id);

CREATE INDEX ix_maintenance_requests_reported_by ON maintenance_requests(reported_by);

ALTER TABLE maintenance_jobs ADD CONSTRAINT fk_maintenance_jobs_request_id FOREIGN KEY (request_id) REFERENCES maintenance_requests(id);

CREATE INDEX ix_maintenance_jobs_request_id ON maintenance_jobs(request_id);

ALTER TABLE maintenance_jobs ADD CONSTRAINT fk_maintenance_jobs_assigned_user_id FOREIGN KEY (assigned_user_id) REFERENCES users(id);

CREATE INDEX ix_maintenance_jobs_assigned_user_id ON maintenance_jobs(assigned_user_id);

ALTER TABLE maintenance_jobs ADD CONSTRAINT fk_maintenance_jobs_supplier_id FOREIGN KEY (supplier_id) REFERENCES suppliers(id);

CREATE INDEX ix_maintenance_jobs_supplier_id ON maintenance_jobs(supplier_id);

ALTER TABLE maintenance_jobs ADD CONSTRAINT fk_maintenance_jobs_expense_id FOREIGN KEY (expense_id) REFERENCES expenses(id);

CREATE INDEX ix_maintenance_jobs_expense_id ON maintenance_jobs(expense_id);

ALTER TABLE maintenance_jobs ADD CONSTRAINT fk_maintenance_jobs_charge_invoice_item_id FOREIGN KEY (charge_invoice_item_id) REFERENCES invoice_items(id);

CREATE INDEX ix_maintenance_jobs_charge_invoice_item_id ON maintenance_jobs(charge_invoice_item_id);

ALTER TABLE complaints ADD CONSTRAINT fk_complaints_room_id FOREIGN KEY (room_id) REFERENCES rooms(id);

CREATE INDEX ix_complaints_room_id ON complaints(room_id);

ALTER TABLE complaints ADD CONSTRAINT fk_complaints_contract_id FOREIGN KEY (contract_id) REFERENCES contracts(id);

CREATE INDEX ix_complaints_contract_id ON complaints(contract_id);

ALTER TABLE complaints ADD CONSTRAINT fk_complaints_reported_by FOREIGN KEY (reported_by) REFERENCES users(id);

CREATE INDEX ix_complaints_reported_by ON complaints(reported_by);

ALTER TABLE complaints ADD CONSTRAINT fk_complaints_received_by FOREIGN KEY (received_by) REFERENCES users(id);

CREATE INDEX ix_complaints_received_by ON complaints(received_by);

ALTER TABLE complaints ADD CONSTRAINT fk_complaints_assigned_to FOREIGN KEY (assigned_to) REFERENCES users(id);

CREATE INDEX ix_complaints_assigned_to ON complaints(assigned_to);

ALTER TABLE complaints ADD CONSTRAINT fk_complaints_maintenance_request_id FOREIGN KEY (maintenance_request_id) REFERENCES maintenance_requests(id);

CREATE INDEX ix_complaints_maintenance_request_id ON complaints(maintenance_request_id);

ALTER TABLE room_utility_tariffs ADD CONSTRAINT fk_room_utility_tariffs_room_id FOREIGN KEY (room_id) REFERENCES rooms(id);

CREATE INDEX ix_room_utility_tariffs_room_id ON room_utility_tariffs(room_id);

ALTER TABLE room_utility_tariffs ADD CONSTRAINT fk_room_utility_tariffs_tariff_id FOREIGN KEY (tariff_id) REFERENCES utility_tariffs(id);

CREATE INDEX ix_room_utility_tariffs_tariff_id ON room_utility_tariffs(tariff_id);

CREATE UNIQUE INDEX uq_active_invoice ON invoices(contract_id,billing_period_id) WHERE status <> 'void' AND invoice_kind = 'recurring';

CREATE UNIQUE INDEX uq_active_meter ON meters(room_id,utility_type) WHERE removed_at IS NULL;

-- One-time automatic posting per source; reversals are separate entries with reverses_id.

CREATE UNIQUE INDEX uq_journal_payment_id ON journal_entries(payment_id) WHERE payment_id IS NOT NULL AND reverses_id IS NULL;

CREATE UNIQUE INDEX uq_journal_invoice_id ON journal_entries(invoice_id) WHERE invoice_id IS NOT NULL AND reverses_id IS NULL;

CREATE UNIQUE INDEX uq_journal_expense_id ON journal_entries(expense_id) WHERE expense_id IS NOT NULL AND reverses_id IS NULL;

CREATE UNIQUE INDEX uq_journal_fund_transaction_id ON journal_entries(fund_transaction_id) WHERE fund_transaction_id IS NOT NULL AND reverses_id IS NULL;

COMMIT;