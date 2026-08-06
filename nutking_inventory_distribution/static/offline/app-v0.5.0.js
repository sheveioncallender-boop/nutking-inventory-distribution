'use strict';

const APP_VERSION = '0.5.0';
const DB_NAME = 'nutking-operations-offline';
const DB_VERSION = 8;
const DEVICE_KEY = 'nutking-device-id-v1';
const LAST_ROUTE_KEY = 'nutking-last-route-v1';
const PRODUCT_SEARCH_MIN_CHARS = 3;
const PRODUCT_SEARCH_LIMIT = 12;

const productAutocomplete = {
  scan: { results: [], activeIndex: -1 },
  count: { results: [], activeIndex: -1 },
};

const OP_LABELS = {
  raw_receipt: 'Receive Raw Materials',
  raw_issue: 'Issue Raw Materials',
  raw_supplier_return: 'Return Raw Materials to Supplier',
  raw_damage: 'Record Damaged Raw Materials',
  raw_expired: 'Record Expired Raw Materials',
  raw_adjustment: 'Raw Materials Adjustment',
  finished_add: 'Receive Finished Goods',
  finished_issue: 'Issue Finished Goods',
  truck_load: 'Load Truck',
  customer_delivery: 'Customer Delivery',
  truck_return: 'Return Truck Stock',
  customer_return: 'Customer Return',
  finished_damage: 'Record Damaged Finished Goods',
  finished_adjustment: 'Finished Goods Adjustment',
};

const OP_CONFIG = {
  raw_receipt: { productType: 'raw_material', partner: 'supplier', partnerRequired: true },
  raw_issue: { productType: 'raw_material', reasonRequired: true, stockSource: 'raw' },
  raw_supplier_return: { productType: 'raw_material', partner: 'supplier', partnerRequired: true, reasonRequired: true, stockSource: 'raw' },
  raw_damage: { productType: 'raw_material', reasonRequired: true, stockSource: 'raw' },
  raw_expired: { productType: 'raw_material', reasonRequired: true, stockSource: 'raw' },
  raw_adjustment: { productType: 'raw_material', reasonRequired: true },
  finished_add: { productType: 'finished_good' },
  finished_issue: { productType: 'finished_good', partner: 'customer', reasonRequired: true, stockSource: 'finished' },
  truck_load: { productType: 'finished_good', tripRequired: true, truckRequired: true, stockSource: 'finished' },
  customer_delivery: { productType: 'finished_good', partner: 'customer', partnerRequired: true, tripRequired: true, truckRequired: true, stockSource: 'truck' },
  truck_return: { productType: 'finished_good', tripRequired: true, truckRequired: true, reasonRequired: true, stockSource: 'truck' },
  customer_return: { productType: 'finished_good', partner: 'customer', partnerRequired: true, reasonRequired: true },
  finished_damage: { productType: 'finished_good', reasonRequired: true, stockSource: 'finishedOrTruck' },
  finished_adjustment: { productType: 'finished_good', reasonRequired: true },
};

const ROUTE_INFO = {
  dashboard: ['Dashboard', 'Nut King inventory and distribution control'],
  raw: ['Raw Materials', 'Receive, issue, count, and monitor raw-material stock'],
  finished: ['Finished Goods', 'Manage finished products independently from raw materials'],
  distribution: ['Distribution', 'Trips, trucks, deliveries, returns, and reconciliation'],
  inventory: ['Physical Inventory', 'Odoo-native stock counts through the offline-first workspace'],
  operations: ['Stock Operations', 'Draft, confirm, complete, print, and audit Nut King movements'],
  contacts: ['Contacts & Trucks', 'Customers, suppliers, trucks, drivers, and staff'],
  reports: ['Reports', 'Management visibility from the latest synchronized snapshot'],
  sync: ['Synchronization', 'Pending device actions, conflicts, and sync history'],
};

const state = {
  snapshot: null,
  queue: [],
  countDrafts: [],
  history: [],
  serverOnline: false,
  syncing: false,
  route: 'dashboard',
  contactTab: 'customers',
  scan: { operationType: '', lines: [], preset: {} },
  review: null,
  countRows: [],
  countDraftUid: '',
  currentTrip: null,
};

const $ = (id) => document.getElementById(id);
const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const html = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[character]));
const number = (value) => Number(value || 0);
const formatNumber = (value) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(number(value));
const formatDateTime = (value) => {
  if (!value) return 'Not set';
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
};
const formatDate = (value) => {
  if (!value) return '';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const uid = (prefix = 'NK') => {
  if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};
const selectedValues = (select) => Array.from(select.selectedOptions).map((option) => Number(option.value)).filter(Boolean);

function emptySnapshot() {
  return {
    app_version: APP_VERSION,
    user: {}, company: {}, permissions: {}, capabilities: [],
    balances: { raw: {}, finished: {}, trucks: {} },
    on_hand: { raw: {}, finished: {}, trucks: {} },
    products: [], inventory_rows: { raw: [], finished: [] }, native_actions: {},
    trucks: [], customers: [], suppliers: [], staff: [], trips: [], reasons: [],
    recent_operations: [], dashboard: {},
    reports: { low_stock: [], movement_summary: {}, truck_stock: [], trip_summary: [] },
    server_time: '', saved_at: '',
  };
}

function deviceId() {
  let value = localStorage.getItem(DEVICE_KEY);
  if (!value) {
    value = uid('NK-DEVICE');
    localStorage.setItem(DEVICE_KEY, value);
  }
  return value;
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('snapshot')) db.createObjectStore('snapshot', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'external_uid' });
      if (!db.objectStoreNames.contains('countDrafts')) db.createObjectStore('countDrafts', { keyPath: 'external_uid' });
      if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeGet(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function storeAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function storePut(storeName, item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(item);
    request.onsuccess = () => resolve(item);
    request.onerror = () => reject(request.error);
  });
}

async function storeDelete(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function storeClear(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function migrateLegacyQueue() {
  const db = await openDB();
  if (!db.objectStoreNames.contains('transactions')) return;
  const legacy = await new Promise((resolve) => {
    const request = db.transaction('transactions', 'readonly').objectStore('transactions').getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => resolve([]);
  });
  for (const item of legacy) {
    await storePut('queue', { kind: 'stock_operation', sync_state: 'pending', ...item });
  }
}

async function persistSnapshot(snapshot) {
  snapshot.saved_at = nowIso();
  state.snapshot = snapshot;
  await storePut('snapshot', { key: 'current', data: snapshot, saved_at: snapshot.saved_at });
}

async function loadLocalState() {
  await migrateLegacyQueue();
  const saved = await storeGet('snapshot', 'current');
  state.snapshot = saved?.data || emptySnapshot();
  state.queue = (await storeAll('queue')).sort((a, b) => String(a.created_on_device).localeCompare(String(b.created_on_device)));
  state.countDrafts = (await storeAll('countDrafts')).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  state.history = (await storeAll('history')).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 100);
}

async function addHistory(status, message, item = {}) {
  const entry = { id: uid('NK-HISTORY'), at: nowIso(), status, message, kind: item.kind || '', reference: item.reference || '' };
  await storePut('history', entry);
  state.history.unshift(entry);
  state.history = state.history.slice(0, 100);
}

function toast(message, type = '') {
  const element = document.createElement('div');
  element.className = `nk-toast ${type}`;
  element.textContent = message;
  $('toast-area').appendChild(element);
  window.setTimeout(() => element.remove(), 4800);
}

function openModal(id) { $(id).classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeModal(id) { $(id).classList.remove('open'); if (!document.querySelector('.nk-modal-backdrop.open')) document.body.style.overflow = ''; }
function badge(value, label = '') { return `<span class="nk-badge ${html(value)}">${html(label || value || 'Unknown')}</span>`; }
function option(value, label, selected = false) { return `<option value="${html(value)}" ${selected ? 'selected' : ''}>${html(label)}</option>`; }
function productById(id) { return state.snapshot.products.find((item) => item.id === Number(id)); }
function truckById(id) { return state.snapshot.trucks.find((item) => item.id === Number(id)); }
function tripById(id) { return state.snapshot.trips.find((item) => item.id === Number(id)); }
function reasonById(id) { return state.snapshot.reasons.find((item) => item.id === Number(id)); }
function partnerById(id) { return [...state.snapshot.customers, ...state.snapshot.suppliers].find((item) => item.id === Number(id)); }
function staffById(id) { return state.snapshot.staff.find((item) => item.id === Number(id)); }

function operationProductType(operationType) { return OP_CONFIG[operationType]?.productType || 'finished_good'; }
function allowedOperationTypes() { return Object.keys(OP_LABELS).filter((key) => state.snapshot.capabilities.includes(key)); }

function desiredOperationState(operation) {
  if (operation?.desired_state) return operation.desired_state;
  if (operation?.process_on_sync) return 'done';
  return operation?.state || 'draft';
}

function operationStateLabel(value) {
  return ({ draft: 'Draft', confirmed: 'Confirmed', done: 'Completed', cancelled: 'Cancelled', error: 'Sync Error' })[value] || String(value || 'Draft');
}

function completedQueueOperation(item) {
  if (item.kind === 'stock_operation') return desiredOperationState(item) === 'done';
  return item.kind === 'operation_event' && item.action === 'process';
}

function validateCachedOperationStock(operation, showMessage = true) {
  const errors = [];
  const truckId = Number(operation.truck_id || 0);
  for (const line of operation.lines || []) {
    const available = availableFor(operation.operation_type, line.product_id, truckId);
    if (available !== null && number(line.quantity) > available + 1e-8) {
      errors.push(`${line.product || productById(line.product_id)?.name || 'Product'}: ${formatNumber(line.quantity)} requested, ${formatNumber(available)} projected available`);
    }
  }
  if (errors.length && showMessage) toast(errors[0], 'error');
  return !errors.length;
}
function operationApplicableReason(reason, operationType) {
  const productType = operationProductType(operationType);
  const category = operationType.includes('truck') || operationType.includes('customer') ? 'distribution' : productType === 'raw_material' ? 'raw' : 'finished';
  return reason.applies_to === 'all' || reason.applies_to === category;
}

function findProduct(value, type = '') {
  const query = String(value || '').trim().toLowerCase();
  if (!query) return null;
  return state.snapshot.products.find((product) => {
    if (type && product.type !== type) return false;
    return [product.barcode, product.default_code, product.name, `${product.name} — ${product.barcode || product.default_code || ''}`]
      .filter(Boolean)
      .some((candidate) => String(candidate).trim().toLowerCase() === query);
  }) || null;
}

function autocompleteProductType(kind) {
  if (kind === 'count') return $('count-warehouse').value === 'raw' ? 'raw_material' : 'finished_good';
  return operationProductType(state.scan.operationType);
}

function autocompleteInput(kind) { return $(kind === 'count' ? 'count-scan' : 'scan-product'); }
function autocompleteMenu(kind) { return $(kind === 'count' ? 'count-product-suggestions' : 'scan-product-suggestions'); }

function productSearchScore(product, query) {
  const normalized = String(query || '').trim().toLowerCase();
  const name = String(product.name || '').toLowerCase();
  const code = String(product.default_code || '').toLowerCase();
  const barcode = String(product.barcode || '').toLowerCase();
  const pack = String(product.pack_size || '').toLowerCase();
  if ([barcode, code, name].includes(normalized)) return 1000;
  if (barcode.startsWith(normalized)) return 900;
  if (code.startsWith(normalized)) return 850;
  if (name.startsWith(normalized)) return 800;
  if (name.split(/\s+/).some((word) => word.startsWith(normalized))) return 750;
  if (barcode.includes(normalized)) return 650;
  if (code.includes(normalized)) return 625;
  if (name.includes(normalized)) return 600;
  if (pack.includes(normalized)) return 500;
  return 0;
}

function searchProducts(query, type) {
  const normalized = String(query || '').trim();
  if (normalized.length < PRODUCT_SEARCH_MIN_CHARS) return [];
  return state.snapshot.products
    .filter((product) => !type || product.type === type)
    .map((product) => ({ product, score: productSearchScore(product, normalized) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.product.name).localeCompare(String(b.product.name)))
    .slice(0, PRODUCT_SEARCH_LIMIT)
    .map((item) => item.product);
}

function productSuggestionQuantity(kind, product) {
  const balances = projectedBalances();
  if (kind === 'count') {
    const bucket = $('count-warehouse').value === 'raw' ? balances.raw : balances.finished;
    return number(bucket[String(product.id)]);
  }
  const truckId = Number($('scan-truck').value || 0);
  const available = availableFor(state.scan.operationType, product.id, truckId);
  if (available !== null) return available;
  const bucket = product.type === 'raw_material' ? balances.raw : balances.finished;
  return number(bucket[String(product.id)]);
}

function closeProductAutocomplete(kind) {
  const menu = autocompleteMenu(kind);
  const input = autocompleteInput(kind);
  if (!menu || !input) return;
  productAutocomplete[kind].results = [];
  productAutocomplete[kind].activeIndex = -1;
  menu.classList.remove('open');
  menu.innerHTML = '';
  input.setAttribute('aria-expanded', 'false');
}

function renderProductAutocomplete(kind) {
  const input = autocompleteInput(kind);
  const menu = autocompleteMenu(kind);
  if (!input || !menu) return;
  const query = input.value.trim();
  const results = searchProducts(query, autocompleteProductType(kind));
  productAutocomplete[kind].results = results;
  productAutocomplete[kind].activeIndex = results.length ? 0 : -1;
  if (query.length < PRODUCT_SEARCH_MIN_CHARS) {
    closeProductAutocomplete(kind);
    return;
  }
  if (!results.length) {
    menu.innerHTML = `<div class="nk-autocomplete-empty">No matching product found in the synchronized ${autocompleteProductType(kind) === 'raw_material' ? 'Raw Materials' : 'Finished Goods'} inventory.</div>`;
    menu.classList.add('open');
    input.setAttribute('aria-expanded', 'true');
    return;
  }
  menu.innerHTML = results.map((product, index) => {
    const reference = [product.default_code, product.barcode].filter(Boolean).join(' · ') || 'No barcode/reference';
    const quantity = productSuggestionQuantity(kind, product);
    return `<button type="button" class="nk-autocomplete-item ${index === 0 ? 'active' : ''}" role="option" aria-selected="${index === 0 ? 'true' : 'false'}" data-product-id="${product.id}"><span><strong>${html(product.name)}</strong><small>${html(reference)}${product.pack_size ? ` · ${html(product.pack_size)}` : ''}</small></span><span class="nk-autocomplete-stock">Available ${formatNumber(quantity)} ${html(product.uom || '')}</span></button>`;
  }).join('');
  menu.classList.add('open');
  input.setAttribute('aria-expanded', 'true');
}

function setAutocompleteActive(kind, nextIndex) {
  const data = productAutocomplete[kind];
  if (!data.results.length) return;
  data.activeIndex = (nextIndex + data.results.length) % data.results.length;
  all('.nk-autocomplete-item', autocompleteMenu(kind)).forEach((item, index) => {
    const active = index === data.activeIndex;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', active ? 'true' : 'false');
    if (active) item.scrollIntoView({ block: 'nearest' });
  });
}

function selectAutocompleteProduct(kind, product, focusQuantity = true) {
  if (!product) return;
  const input = autocompleteInput(kind);
  input.value = product.name;
  input.dataset.productId = String(product.id);
  closeProductAutocomplete(kind);
  if (focusQuantity) {
    const quantityInput = $(kind === 'count' ? 'count-scan-qty' : 'scan-qty');
    quantityInput?.focus();
    quantityInput?.select();
  }
}

function autocompleteSelectedProduct(kind) {
  const input = autocompleteInput(kind);
  const productId = Number(input?.dataset.productId || 0);
  if (productId) {
    const selected = productById(productId);
    if (selected && selected.type === autocompleteProductType(kind)) return selected;
  }
  return findProduct(input?.value, autocompleteProductType(kind));
}

function handleProductAutocompleteInput(kind) {
  const input = autocompleteInput(kind);
  delete input.dataset.productId;
  renderProductAutocomplete(kind);
}

function handleProductAutocompleteKeydown(kind, event, addLineCallback) {
  const data = productAutocomplete[kind];
  const menuOpen = autocompleteMenu(kind).classList.contains('open');
  if (event.key === 'ArrowDown' && menuOpen && data.results.length) {
    event.preventDefault();
    setAutocompleteActive(kind, data.activeIndex + 1);
    return;
  }
  if (event.key === 'ArrowUp' && menuOpen && data.results.length) {
    event.preventDefault();
    setAutocompleteActive(kind, data.activeIndex - 1);
    return;
  }
  if (event.key === 'Escape') {
    closeProductAutocomplete(kind);
    return;
  }
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const exact = findProduct(autocompleteInput(kind).value, autocompleteProductType(kind));
  if (exact) {
    selectAutocompleteProduct(kind, exact, false);
    addLineCallback();
    return;
  }
  if (menuOpen && data.results.length) {
    selectAutocompleteProduct(kind, data.results[Math.max(0, data.activeIndex)]);
    return;
  }
  addLineCallback();
}

function bindProductAutocomplete(kind) {
  const input = autocompleteInput(kind);
  const menu = autocompleteMenu(kind);
  input.addEventListener('input', () => handleProductAutocompleteInput(kind));
  input.addEventListener('focus', () => renderProductAutocomplete(kind));
  input.addEventListener('keydown', (event) => handleProductAutocompleteKeydown(kind, event, kind === 'count' ? addCountScan : addScanLine));
  input.addEventListener('blur', () => window.setTimeout(() => closeProductAutocomplete(kind), 160));
  menu.addEventListener('mousedown', (event) => {
    const item = event.target.closest('.nk-autocomplete-item');
    if (!item) return;
    event.preventDefault();
    selectAutocompleteProduct(kind, productById(item.dataset.productId));
  });
}

function localOpenTrips() {
  const local = state.queue.filter((item) => item.kind === 'trip_create' && item.sync_state !== 'error').map((item) => ({
    id: null,
    local_uid: item.external_uid,
    name: item.local_name || 'Pending Trip',
    truck_id: Number(item.truck_id),
    truck_name: truckById(item.truck_id)?.name || '',
    driver_id: Number(item.driver_id),
    driver_name: staffById(item.driver_id)?.name || '',
    team_ids: item.team_ids || [],
    route_name: item.route_name || '',
    state: 'pending',
    state_label: 'Waiting to Sync',
    planned_departure: item.planned_departure,
    total_loaded: 0,
    total_delivered: 0,
    total_returned: 0,
    total_damaged: 0,
    total_variance: 0,
    notes: item.notes || '',
  }));
  return [...state.snapshot.trips, ...local];
}

function queueStockOperationAdjust(balance, item) {
  const config = OP_CONFIG[item.operation_type] || {};
  for (const line of item.lines || []) {
    const productKey = String(line.product_id);
    const truckKey = String(item.truck_id || '');
    const quantity = number(line.quantity);
    balance.raw[productKey] ||= 0;
    balance.finished[productKey] ||= 0;
    if (item.operation_type === 'raw_receipt') balance.raw[productKey] += quantity;
    if (['raw_issue', 'raw_supplier_return', 'raw_damage', 'raw_expired'].includes(item.operation_type)) balance.raw[productKey] -= quantity;
    if (item.operation_type === 'finished_add') balance.finished[productKey] += quantity;
    if (item.operation_type === 'finished_issue') balance.finished[productKey] -= quantity;
    if (item.operation_type === 'truck_load') {
      balance.finished[productKey] -= quantity;
      balance.trucks[truckKey] ||= {};
      balance.trucks[truckKey][productKey] ||= 0;
      balance.trucks[truckKey][productKey] += quantity;
    }
    if (['customer_delivery', 'truck_return'].includes(item.operation_type)) {
      balance.trucks[truckKey] ||= {};
      balance.trucks[truckKey][productKey] ||= 0;
      balance.trucks[truckKey][productKey] -= quantity;
      if (item.operation_type === 'truck_return') balance.finished[productKey] += quantity;
    }
    if (item.operation_type === 'finished_damage') {
      if (item.truck_id) {
        balance.trucks[truckKey] ||= {};
        balance.trucks[truckKey][productKey] ||= 0;
        balance.trucks[truckKey][productKey] -= quantity;
      } else {
        balance.finished[productKey] -= quantity;
      }
    }
    if (config.stockSource === 'raw' && item.operation_type === 'raw_adjustment') balance.raw[productKey] += number(line.adjustment || 0);
  }
}

function projectedBalances() {
  const balance = clone(state.snapshot.balances || { raw: {}, finished: {}, trucks: {} });
  balance.raw ||= {}; balance.finished ||= {}; balance.trucks ||= {};
  for (const item of state.queue.filter((entry) => entry.sync_state !== 'error')) {
    if (completedQueueOperation(item)) queueStockOperationAdjust(balance, item);
    if (item.kind === 'physical_inventory') {
      const destination = item.warehouse_type === 'raw' ? balance.raw : balance.finished;
      for (const line of item.lines || []) {
        const productKey = String(line.product_id);
        destination[productKey] ||= 0;
        destination[productKey] += number(line.counted_quantity) - number(line.expected_quantity);
      }
    }
  }
  return balance;
}

function projectedOnHand() {
  const result = clone(state.snapshot.on_hand || { raw: {}, finished: {}, trucks: {} });
  result.raw ||= {}; result.finished ||= {}; result.trucks ||= {};
  for (const item of state.queue.filter((entry) => entry.sync_state !== 'error')) {
    if (completedQueueOperation(item)) queueStockOperationAdjust(result, item);
    if (item.kind === 'physical_inventory') {
      const destination = item.warehouse_type === 'raw' ? result.raw : result.finished;
      for (const line of item.lines || []) {
        const productKey = String(line.product_id);
        destination[productKey] ||= 0;
        destination[productKey] += number(line.counted_quantity) - number(line.expected_quantity);
      }
    }
  }
  return result;
}

function availableFor(operationType, productId, truckId) {
  const balances = projectedBalances();
  const config = OP_CONFIG[operationType] || {};
  const key = String(productId);
  if (config.stockSource === 'raw') return number(balances.raw[key]);
  if (config.stockSource === 'finished') return number(balances.finished[key]);
  if (config.stockSource === 'truck') return number((balances.trucks[String(truckId)] || {})[key]);
  if (config.stockSource === 'finishedOrTruck') {
    return truckId ? number((balances.trucks[String(truckId)] || {})[key]) : number(balances.finished[key]);
  }
  return null;
}

async function fetchJSON(url, options = {}, timeoutMs = 18000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const error = new Error(response.redirected || response.url.includes('/web/login') ? 'Your Odoo session has expired. Sign in again while online.' : 'The server returned an unexpected response.');
      error.code = 'SESSION';
      throw error;
    }
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || `Server error ${response.status}`);
    return data;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function checkServer() {
  if (!navigator.onLine) {
    state.serverOnline = false;
    updateConnectionUI();
    return false;
  }
  try {
    await fetchJSON('/nutking/api/ping', {}, 7000);
    state.serverOnline = true;
  } catch (error) {
    state.serverOnline = false;
  }
  updateConnectionUI();
  return state.serverOnline;
}

async function refreshSnapshot(showMessage = false) {
  try {
    const data = await fetchJSON('/nutking/api/bootstrap');
    await persistSnapshot(data);
    state.serverOnline = true;
    if (showMessage) toast('Nut King data synchronized successfully.', 'success');
    await addHistory('success', 'Downloaded the latest Nut King operational snapshot.', { kind: 'bootstrap' });
    renderAll();
    return true;
  } catch (error) {
    state.serverOnline = false;
    if (showMessage) toast(error.message, 'error');
    updateConnectionUI();
    return false;
  }
}

async function queuePut(item) {
  const value = { device_name: deviceId(), created_on_device: item.created_on_device || nowIso(), sync_state: item.sync_state || 'pending', attempts: item.attempts || 0, ...item };
  await storePut('queue', value);
  const index = state.queue.findIndex((entry) => entry.external_uid === value.external_uid);
  if (index >= 0) state.queue[index] = value; else state.queue.push(value);
  state.queue.sort((a, b) => String(a.created_on_device).localeCompare(String(b.created_on_device)));
  renderAll();
  return value;
}

async function queueDelete(externalUid) {
  await storeDelete('queue', externalUid);
  state.queue = state.queue.filter((item) => item.external_uid !== externalUid);
  renderAll();
}

async function syncQueue(force = false) {
  if (state.syncing) return;
  state.syncing = true;
  updateConnectionUI();
  try {
    const online = await checkServer();
    if (!online) {
      if (force) toast('The Nut King server is not reachable. Your work remains safe on this device.', 'error');
      return;
    }
    const pending = state.queue.filter((item) => item.sync_state !== 'processed');
    if (!pending.length) {
      await refreshSnapshot(force);
      return;
    }
    const data = await fetchJSON('/nutking/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_name: deviceId(), app_version: APP_VERSION, transactions: pending }),
    }, 60000);
    for (const result of data.results || []) {
      const item = state.queue.find((entry) => entry.external_uid === result.external_uid);
      if (!item) continue;
      if (result.status === 'processed') {
        await queueDelete(result.external_uid);
        await addHistory('success', `${result.reference || 'Action'} synchronized successfully.`, { kind: result.kind, reference: result.reference });
      } else {
        item.sync_state = 'error';
        item.sync_error = result.error || 'The server rejected this action.';
        item.attempts = number(item.attempts) + 1;
        await storePut('queue', item);
        await addHistory('error', item.sync_error, { kind: item.kind, reference: item.reference || item.local_name || '' });
      }
    }
    state.queue = await storeAll('queue');
    await refreshSnapshot(false);
    toast(state.queue.some((item) => item.sync_state === 'error') ? 'Synchronization completed with items requiring review.' : 'All waiting Nut King actions synchronized.', state.queue.some((item) => item.sync_state === 'error') ? 'error' : 'success');
  } catch (error) {
    state.serverOnline = false;
    await addHistory('error', `Synchronization failed: ${error.message}`, { kind: 'sync' });
    if (force) toast(error.message, 'error');
  } finally {
    state.syncing = false;
    updateConnectionUI();
    renderAll();
  }
}

function updateConnectionUI() {
  const pending = state.queue.length;
  const pill = $('connection-pill');
  if (state.serverOnline) {
    pill.classList.remove('offline');
    $('connection-text').textContent = state.syncing ? 'Synchronizing…' : pending ? `Online · ${pending} waiting` : 'Online · synchronized';
  } else {
    pill.classList.add('offline');
    $('connection-text').textContent = pending ? `Offline · ${pending} saved` : 'Offline · device mode';
  }
  $('offline-banner').classList.toggle('show', !state.serverOnline);
  $('top-sync').disabled = state.syncing;
  $('sync-now').disabled = state.syncing;
}

function navigate(route, updateHash = true) {
  if (!ROUTE_INFO[route]) route = 'dashboard';
  state.route = route;
  localStorage.setItem(LAST_ROUTE_KEY, route);
  all('.nk-page').forEach((page) => page.classList.toggle('active', page.id === `page-${route}`));
  all('.nk-nav-button').forEach((button) => button.classList.toggle('active', button.dataset.route === route));
  $('page-title').textContent = ROUTE_INFO[route][0];
  $('page-subtitle').textContent = ROUTE_INFO[route][1];
  $('sidebar').classList.remove('open');
  if (updateHash && location.hash !== `#${route}`) history.replaceState(null, '', `#${route}`);
  renderRoute(route);
}

function routeFromHash() {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return localStorage.getItem(LAST_ROUTE_KEY) || 'dashboard';
  if (raw.startsWith('scan/')) {
    const operation = raw.split('/')[1];
    window.setTimeout(() => openScan(operation), 0);
    return state.route || 'dashboard';
  }
  if (raw.startsWith('inventory/')) {
    const type = raw.split('/')[1];
    window.setTimeout(() => openCount(type), 0);
    return 'inventory';
  }
  return ROUTE_INFO[raw] ? raw : 'dashboard';
}

function renderKpi(label, value, note = '', extra = '') {
  return `<div class="nk-card nk-kpi ${extra}"><span class="nk-kpi-label">${html(label)}</span><strong class="nk-kpi-value">${html(value)}</strong><span class="nk-kpi-note">${html(note)}</span></div>`;
}

function renderAll() {
  const snapshot = state.snapshot || emptySnapshot();
  $('sidebar-user').textContent = snapshot.user?.name || 'Nut King User';
  $('sidebar-company').textContent = snapshot.company?.name || 'Offline snapshot not downloaded';
  $('sidebar-version').textContent = `Workspace v${snapshot.app_version || APP_VERSION}`;
  $('developer-link').hidden = !(snapshot.permissions?.system);
  $('welcome-title').textContent = snapshot.user?.name ? `Welcome, ${snapshot.user.name}` : 'Welcome to Nut King Operations';
  $('hero-last-sync').textContent = snapshot.saved_at ? formatDateTime(snapshot.saved_at) : 'Not synchronized yet';
  $('hero-pending').textContent = `${state.queue.length} action${state.queue.length === 1 ? '' : 's'} waiting on this device`;
  $('count-date').value ||= today();
  populateProductDatalist();
  applyPermissions();
  renderDashboard();
  renderStock('raw');
  renderStock('finished');
  renderDistribution();
  renderOperations();
  renderContacts();
  renderReports();
  renderSyncCentre();
  renderCountDraftOptions();
  if (state.countRows.length) renderCountRows();
  updateConnectionUI();
}

function applyPermissions() {
  const permissions = state.snapshot.permissions || {};
  all('[data-scan]').forEach((button) => {
    button.hidden = !state.snapshot.capabilities.includes(button.dataset.scan);
  });
  all('[data-count="raw"]').forEach((button) => { button.hidden = !permissions.raw; });
  all('[data-count="finished"]').forEach((button) => { button.hidden = !permissions.finished; });
  const routeAccess = {
    raw: Boolean(permissions.raw),
    finished: Boolean(permissions.finished || permissions.distribution),
    distribution: Boolean(permissions.distribution),
    inventory: Boolean(permissions.raw || permissions.finished),
    operations: true,
    contacts: Boolean(permissions.raw || permissions.finished || permissions.distribution),
    reports: Boolean(permissions.supervisor),
    sync: true,
    dashboard: true,
  };
  all('.nk-nav-button').forEach((button) => {
    button.hidden = routeAccess[button.dataset.route] === false;
  });
  if (routeAccess[state.route] === false) navigate('dashboard');
  $('new-trip').hidden = !permissions.distribution;
  $('open-native-count').hidden = !(state.serverOnline && permissions.system);
}

function renderDashboard() {
  const snapshot = state.snapshot;
  const balances = projectedBalances();
  const rawTotal = Object.values(balances.raw).reduce((sum, value) => sum + number(value), 0);
  const finishedTotal = Object.values(balances.finished).reduce((sum, value) => sum + number(value), 0);
  const truckTotal = Object.values(balances.trucks).reduce((outer, truck) => outer + Object.values(truck).reduce((sum, value) => sum + number(value), 0), 0);
  $('dashboard-kpis').innerHTML = [
    renderKpi('Raw Material Quantity', formatNumber(rawTotal), `${snapshot.products.filter((p) => p.type === 'raw_material').length} products`),
    renderKpi('Finished Goods Quantity', formatNumber(finishedTotal), `${snapshot.products.filter((p) => p.type === 'finished_good').length} products`),
    renderKpi('Stock on Trucks', formatNumber(truckTotal), `${snapshot.trucks.length} active trucks`),
    renderKpi('Low Stock Items', snapshot.reports?.low_stock?.length || 0, 'Requires management attention'),
    renderKpi('Open Trips', localOpenTrips().length, 'Server and device-created trips'),
    renderKpi('Pending Operations', (snapshot.dashboard?.pending_operation_count || 0) + state.queue.filter((q) => q.kind === 'stock_operation').length, 'Draft or waiting to synchronize'),
    renderKpi('Device Queue', state.queue.length, state.queue.some((q) => q.sync_state === 'error') ? 'Some actions need review' : 'Safely stored locally'),
    renderKpi('Last Sync', snapshot.saved_at ? formatDateTime(snapshot.saved_at) : 'Never', state.serverOnline ? 'Server reachable' : 'Working offline'),
  ].join('');

  const localOperations = state.queue.filter((item) => item.kind === 'stock_operation').slice(-5).reverse().map((item) => ({
    name: item.reference || item.external_uid.slice(-8), operation_label: OP_LABELS[item.operation_type], date: item.created_on_device, quantity: (item.lines || []).reduce((sum, line) => sum + number(line.quantity), 0), state: item.sync_state === 'error' ? 'error' : 'pending', local: true,
  }));
  const operations = [...localOperations, ...(snapshot.recent_operations || []).slice(0, 5)].slice(0, 7);
  $('dashboard-operations').innerHTML = operations.length ? operations.map((operation) => `<div class="nk-list-item"><strong>${html(operation.name)}</strong><div class="nk-small nk-muted">${html(operation.operation_label)} · ${formatDateTime(operation.date)} · ${formatNumber(operation.quantity)}</div><div style="margin-top:6px">${badge(operation.state)}</div></div>`).join('') : '<div class="nk-empty">No operations are available yet.</div>';

  const trips = localOpenTrips().slice(0, 6);
  $('dashboard-trips').innerHTML = trips.length ? trips.map((trip) => `<div class="nk-list-item"><strong>${html(trip.name)} · ${html(trip.truck_name)}</strong><div class="nk-small nk-muted">${html(trip.route_name)} · ${formatDateTime(trip.planned_departure)}</div><div style="margin-top:6px">${badge(trip.state, trip.state_label)}</div></div>`).join('') : '<div class="nk-empty">No open distribution trips.</div>';
}

function renderStock(type) {
  const productType = type === 'raw' ? 'raw_material' : 'finished_good';
  const products = state.snapshot.products.filter((product) => product.type === productType);
  const balances = projectedBalances()[type];
  const onHand = projectedOnHand()[type];
  const search = String($(`${type}-search`)?.value || '').trim().toLowerCase();
  const filter = $(`${type}-filter`)?.value || 'all';
  const filtered = products.filter((product) => {
    const quantity = number(balances[String(product.id)]);
    const low = product.minimum_qty > 0 && quantity <= product.minimum_qty;
    if (filter === 'low' && !low) return false;
    if (filter === 'positive' && quantity <= 0) return false;
    if (filter === 'zero' && quantity !== 0) return false;
    if (search && ![product.name, product.barcode, product.default_code, product.pack_size].some((value) => String(value || '').toLowerCase().includes(search))) return false;
    return true;
  });
  const total = products.reduce((sum, product) => sum + number(balances[String(product.id)]), 0);
  const lowCount = products.filter((product) => product.minimum_qty > 0 && number(balances[String(product.id)]) <= product.minimum_qty).length;
  $(`${type}-kpis`).innerHTML = [
    renderKpi('Products', products.length, `Active ${type === 'raw' ? 'raw materials' : 'finished goods'}`),
    renderKpi('Available Quantity', formatNumber(total), 'Includes pending device actions'),
    renderKpi('Low Stock', lowCount, lowCount ? 'Review replenishment' : 'No configured shortages'),
  ].join('');
  $(`${type}-stock-body`).innerHTML = filtered.length ? filtered.map((product) => {
    const available = number(balances[String(product.id)]);
    const hand = number(onHand[String(product.id)]);
    const low = product.minimum_qty > 0 && available <= product.minimum_qty;
    return `<tr><td><strong>${html(product.name)}</strong><div class="nk-small nk-muted">${html(product.default_code || '')}</div></td><td>${html(product.barcode || '—')}</td><td>${html(product.pack_size || product.uom)}</td><td class="number">${formatNumber(hand)}</td><td class="number ${low ? 'nk-quantity-low' : ''}">${formatNumber(available)}</td><td class="number">${formatNumber(product.minimum_qty)}</td><td>${low ? badge('error', 'Low Stock') : available > 0 ? badge('done', 'Available') : badge('draft', 'No Stock')}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="nk-empty">No products match the current filter.</td></tr>';
}

function renderDistribution() {
  const trips = localOpenTrips();
  const balances = projectedBalances();
  const tripSearch = String($('trip-search')?.value || '').trim().toLowerCase();
  const tripFilter = $('trip-filter')?.value || 'open';
  const filteredTrips = trips.filter((trip) => {
    if (tripFilter !== 'all' && tripFilter !== 'open' && trip.state !== tripFilter) return false;
    if (tripFilter === 'open' && ['done', 'cancelled'].includes(trip.state)) return false;
    if (tripSearch && ![trip.name, trip.truck_name, trip.driver_name, trip.route_name].some((value) => String(value || '').toLowerCase().includes(tripSearch))) return false;
    return true;
  });
  const stockOnTrucks = Object.values(balances.trucks).reduce((outer, values) => outer + Object.values(values).reduce((sum, value) => sum + number(value), 0), 0);
  $('distribution-kpis').innerHTML = [
    renderKpi('Open Trips', trips.length, 'Including device-created trips'),
    renderKpi('Active Trucks', state.snapshot.trucks.length, 'Available, loading, or on route'),
    renderKpi('Stock on Trucks', formatNumber(stockOnTrucks), 'Projected device quantity'),
    renderKpi('Trip Variances', trips.filter((trip) => Math.abs(number(trip.total_variance)) > 0.0001).length, 'Require reconciliation'),
  ].join('');
  $('trip-grid').innerHTML = filteredTrips.length ? filteredTrips.map(renderTripCard).join('') : '<div class="nk-empty">No trips match this view.</div>';

  $('truck-stock-body').innerHTML = state.snapshot.trucks.length ? state.snapshot.trucks.map((truck) => {
    const values = balances.trucks[String(truck.id)] || {};
    const items = Object.entries(values).filter(([, quantity]) => number(quantity) !== 0);
    const total = items.reduce((sum, [, quantity]) => sum + number(quantity), 0);
    const productText = items.slice(0, 4).map(([productId, quantity]) => `${productById(productId)?.name || productId}: ${formatNumber(quantity)}`).join(' · ');
    return `<tr><td><strong>${html(truck.name)}</strong></td><td>${html(truck.registration)}</td><td>${badge(truck.status)}</td><td class="number">${formatNumber(total)}</td><td>${html(productText || 'No stock assigned')}</td></tr>`;
  }).join('') : '<tr><td colspan="5" class="nk-empty">No trucks have been configured.</td></tr>';
}

function renderTripCard(trip) {
  const canDistribution = state.snapshot.permissions?.distribution;
  const canSupervisor = state.snapshot.permissions?.supervisor;
  const localAttr = trip.local_uid ? `data-trip-local="${html(trip.local_uid)}"` : `data-trip-id="${trip.id}"`;
  const buttons = [];
  if (canDistribution && ['planned', 'loading', 'pending'].includes(trip.state)) buttons.push(`<button class="nk-button small secondary trip-scan" data-operation="truck_load" ${localAttr}>Load</button>`);
  if (canDistribution && ['in_progress', 'reconciliation'].includes(trip.state)) {
    buttons.push(`<button class="nk-button small secondary trip-scan" data-operation="customer_delivery" ${localAttr}>Delivery</button>`);
    buttons.push(`<button class="nk-button small light trip-scan" data-operation="truck_return" ${localAttr}>Return</button>`);
  }
  if (canDistribution && trip.state === 'loading') buttons.push(`<button class="nk-button small dark trip-event" data-action="depart" ${localAttr}>Depart</button>`);
  if (canDistribution && trip.state === 'in_progress') buttons.push(`<button class="nk-button small dark trip-event" data-action="start_reconciliation" ${localAttr}>Reconcile</button>`);
  if (canSupervisor && trip.state === 'reconciliation') buttons.push(`<button class="nk-button small primary trip-event" data-action="close" ${localAttr}>Close Trip</button>`);
  return `<article class="nk-trip-card"><div class="nk-trip-head"><div><h3>${html(trip.name)}</h3><div class="nk-small nk-muted">${html(trip.route_name)} · ${html(trip.truck_name)}</div></div>${badge(trip.state, trip.state_label)}</div><div class="nk-trip-meta"><span><strong>Driver:</strong> ${html(trip.driver_name || 'Not assigned')}</span><span><strong>Departure:</strong> ${formatDateTime(trip.planned_departure)}</span></div><div class="nk-trip-totals"><div><span>Loaded</span><strong>${formatNumber(trip.total_loaded)}</strong></div><div><span>Delivered</span><strong>${formatNumber(trip.total_delivered)}</strong></div><div><span>Returned</span><strong>${formatNumber(trip.total_returned)}</strong></div><div><span>Damaged</span><strong>${formatNumber(trip.total_damaged)}</strong></div><div><span>Variance</span><strong class="${Math.abs(number(trip.total_variance)) > .0001 ? 'nk-quantity-low' : ''}">${formatNumber(trip.total_variance)}</strong></div></div><div class="nk-actions" style="margin-top:13px"><button class="nk-button small light trip-details" ${localAttr}>Details</button>${buttons.join('')}</div></article>`;
}

function localOperationRows() {
  return state.queue.filter((item) => ['stock_operation', 'operation_event'].includes(item.kind)).map((item) => {
    const workflowState = item.kind === 'stock_operation'
      ? desiredOperationState(item)
      : item.action === 'process' ? 'done' : item.action === 'confirm' ? 'confirmed' : item.action === 'cancel' ? 'cancelled' : 'draft';
    return {
      local: true,
      external_uid: item.external_uid,
      name: item.reference || item.external_uid.slice(-8),
      operation_id: item.operation_id || false,
      operation_type: item.operation_type || 'operation_event',
      operation_label: item.operation_type ? OP_LABELS[item.operation_type] : 'Operation Action',
      date: item.created_on_device,
      quantity: (item.lines || []).reduce((sum, line) => sum + number(line.quantity), 0),
      partner: partnerById(item.partner_id)?.name || '',
      partner_id: item.partner_id || false,
      truck: truckById(item.truck_id)?.name || '',
      truck_id: item.truck_id || false,
      trip_id: item.trip_id || false,
      trip_external_uid: item.trip_external_uid || false,
      reason_id: item.reason_id || false,
      reference: item.reference || '',
      notes: item.notes || '',
      user: state.snapshot.user?.name || '',
      state: item.sync_state === 'error' ? 'error' : workflowState,
      workflow_state: workflowState,
      sync_state: item.sync_state || 'pending',
      sync_error: item.sync_error || '',
      lines: item.lines || [],
      desired_state: workflowState,
    };
  });
}

function renderOperations() {
  const operations = [...localOperationRows(), ...(state.snapshot.recent_operations || [])];
  const search = String($('operation-search')?.value || '').toLowerCase();
  const status = $('operation-filter')?.value || 'all';
  const type = $('operation-type-filter')?.value || 'all';
  const filtered = operations.filter((operation) => {
    if (status === 'pending' && !(operation.local && operation.sync_state === 'pending')) return false;
    if (status === 'error' && operation.state !== 'error') return false;
    if (!['all', 'pending', 'error'].includes(status) && (operation.workflow_state || operation.state) !== status) return false;
    if (type !== 'all' && operation.operation_type !== type) return false;
    const productNames = (operation.lines || []).map((line) => line.product || productById(line.product_id)?.name || '').join(' ');
    if (search && ![operation.name, operation.operation_label, operation.partner, operation.truck, operation.reference, productNames].some((value) => String(value || '').toLowerCase().includes(search))) return false;
    return true;
  });
  $('operations-body').innerHTML = filtered.length ? filtered.map((operation) => {
    const party = operation.partner || operation.truck || '—';
    const action = operation.local ? `<button class="nk-button small light local-operation-review" data-uid="${html(operation.external_uid)}">Open</button>` : `<button class="nk-button small light server-operation-review" data-id="${operation.id}">Open</button>`;
    const statusText = operation.state === 'error' ? `Sync Error · ${operationStateLabel(operation.workflow_state)}` : operationStateLabel(operation.workflow_state || operation.state);
    return `<tr><td><strong>${html(operation.name)}</strong>${operation.local ? '<div class="nk-small nk-muted">Device operation</div>' : ''}${operation.sync_error ? `<div class="nk-small nk-quantity-low">${html(operation.sync_error)}</div>` : ''}</td><td>${formatDateTime(operation.date)}</td><td>${html(operation.operation_label)}</td><td>${html(party)}</td><td class="number">${formatNumber(operation.quantity)}</td><td>${html(operation.user || '')}</td><td>${badge(operation.state === 'error' ? 'error' : (operation.workflow_state || operation.state), statusText)}</td><td>${action}</td></tr>`;
  }).join('') : '<tr><td colspan="8" class="nk-empty">No stock operations match the selected filters.</td></tr>';
}

function renderContacts() {
  const search = String($('contact-search')?.value || '').trim().toLowerCase();
  all('.contact-tab').forEach((button) => {
    const active = button.dataset.contactTab === state.contactTab;
    button.classList.toggle('dark', active); button.classList.toggle('light', !active); button.classList.toggle('active', active);
  });
  let rows = [];
  if (state.contactTab === 'customers') {
    rows = state.snapshot.customers.filter((item) => [item.name, item.code, item.phone, item.route, item.address].some((value) => String(value || '').toLowerCase().includes(search))).map((item) => `<tr><td><strong>${html(item.name)}</strong><div class="nk-small nk-muted">${html(item.code)}</div></td><td>${html(item.phone || '—')}</td><td>${html(item.email || '—')}</td><td>${html(item.route || '—')}</td><td>${html(item.address || '—')}</td></tr>`);
    $('contacts-content').innerHTML = `<div class="nk-table-wrap"><table class="nk-table"><thead><tr><th>Customer</th><th>Phone</th><th>Email</th><th>Route</th><th>Delivery Address</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="5" class="nk-empty">No customers found.</td></tr>'}</tbody></table></div>`;
  } else if (state.contactTab === 'suppliers') {
    rows = state.snapshot.suppliers.filter((item) => [item.name, item.code, item.phone, item.address].some((value) => String(value || '').toLowerCase().includes(search))).map((item) => `<tr><td><strong>${html(item.name)}</strong><div class="nk-small nk-muted">${html(item.code)}</div></td><td>${html(item.phone || '—')}</td><td>${html(item.email || '—')}</td><td>${html(item.address || '—')}</td></tr>`);
    $('contacts-content').innerHTML = `<div class="nk-table-wrap"><table class="nk-table"><thead><tr><th>Supplier</th><th>Phone</th><th>Email</th><th>Address</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="4" class="nk-empty">No suppliers found.</td></tr>'}</tbody></table></div>`;
  } else if (state.contactTab === 'trucks') {
    rows = state.snapshot.trucks.filter((item) => [item.name, item.registration, item.make, item.model, item.driver].some((value) => String(value || '').toLowerCase().includes(search))).map((item) => `<tr><td><strong>${html(item.name)}</strong></td><td>${html(item.registration)}</td><td>${html([item.make, item.model].filter(Boolean).join(' ') || '—')}</td><td>${html(item.driver || '—')}</td><td>${html(item.capacity || '—')}</td><td>${badge(item.status)}</td></tr>`);
    $('contacts-content').innerHTML = `<div class="nk-table-wrap"><table class="nk-table"><thead><tr><th>Truck</th><th>Registration</th><th>Vehicle</th><th>Default Driver</th><th>Capacity</th><th>Status</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="6" class="nk-empty">No trucks found.</td></tr>'}</tbody></table></div>`;
  } else {
    rows = state.snapshot.staff.filter((item) => [item.name, item.employee_code, item.role, item.phone, item.email].some((value) => String(value || '').toLowerCase().includes(search))).map((item) => `<tr><td><strong>${html(item.name)}</strong><div class="nk-small nk-muted">${html(item.employee_code)}</div></td><td>${html(String(item.role || '').replaceAll('_', ' '))}</td><td>${html(item.phone || '—')}</td><td>${html(item.email || '—')}</td></tr>`);
    $('contacts-content').innerHTML = `<div class="nk-table-wrap"><table class="nk-table"><thead><tr><th>Staff Member</th><th>Role</th><th>Phone</th><th>Email</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="4" class="nk-empty">No staff found.</td></tr>'}</tbody></table></div>`;
  }
}

function renderReports() {
  const balances = projectedBalances();
  const rawTotal = Object.values(balances.raw).reduce((sum, value) => sum + number(value), 0);
  const finishedTotal = Object.values(balances.finished).reduce((sum, value) => sum + number(value), 0);
  const truckTotal = Object.values(balances.trucks).reduce((outer, values) => outer + Object.values(values).reduce((sum, value) => sum + number(value), 0), 0);
  $('report-snapshot-note').textContent = `${state.serverOnline ? 'ONLINE SNAPSHOT' : 'OFFLINE SNAPSHOT'} · Last synchronized ${state.snapshot.saved_at ? formatDateTime(state.snapshot.saved_at) : 'never'} · Includes ${state.queue.length} local pending action${state.queue.length === 1 ? '' : 's'}.`;
  $('report-kpis').innerHTML = [renderKpi('Raw Quantity', formatNumber(rawTotal), 'Projected available'), renderKpi('Finished Quantity', formatNumber(finishedTotal), 'Projected available'), renderKpi('Truck Quantity', formatNumber(truckTotal), 'Across all trucks'), renderKpi('Open Trips', localOpenTrips().length, 'Active distribution')].join('');
  const lowStock = state.snapshot.reports?.low_stock || [];
  $('low-stock-report').innerHTML = lowStock.length ? lowStock.map((item) => `<div class="nk-list-item"><strong>${html(item.product)}</strong><div class="nk-small nk-muted">Quantity ${formatNumber(item.quantity)} · Minimum ${formatNumber(item.minimum_qty)}</div></div>`).join('') : '<div class="nk-empty">No low-stock items were recorded at the last sync.</div>';
  const movements = Object.entries(state.snapshot.reports?.movement_summary || {});
  const maxMove = Math.max(1, ...movements.map(([, value]) => number(value)));
  $('movement-report').innerHTML = movements.length ? movements.map(([key, value]) => `<div class="nk-report-line"><span>${html(OP_LABELS[key] || key)}</span><div class="bar"><span style="width:${Math.min(100, number(value) / maxMove * 100)}%"></span></div><strong>${formatNumber(value)}</strong></div>`).join('') : '<div class="nk-empty">No completed movement data yet.</div>';
  const trucks = state.snapshot.trucks.map((truck) => ({ truck: truck.name, quantity: Object.values(balances.trucks[String(truck.id)] || {}).reduce((sum, value) => sum + number(value), 0) }));
  $('truck-report').innerHTML = trucks.length ? trucks.map((item) => `<div class="nk-list-item"><strong>${html(item.truck)}</strong><div class="nk-small nk-muted">${formatNumber(item.quantity)} units on truck</div></div>`).join('') : '<div class="nk-empty">No truck data is available.</div>';
  $('trip-report').innerHTML = localOpenTrips().length ? localOpenTrips().map((trip) => `<div class="nk-list-item"><strong>${html(trip.name)} · ${html(trip.route_name)}</strong><div class="nk-small nk-muted">Loaded ${formatNumber(trip.total_loaded)} · Delivered ${formatNumber(trip.total_delivered)} · Variance ${formatNumber(trip.total_variance)}</div></div>`).join('') : '<div class="nk-empty">No open trip performance data.</div>';
}

function renderSyncCentre() {
  const errors = state.queue.filter((item) => item.sync_state === 'error').length;
  $('sync-kpis').innerHTML = [
    renderKpi('Connection', state.serverOnline ? 'Online' : 'Offline', state.serverOnline ? 'Odoo server reachable' : 'Device storage active'),
    renderKpi('Waiting Actions', state.queue.length, 'Stored in IndexedDB'),
    renderKpi('Sync Errors', errors, errors ? 'Review rejected actions' : 'No conflicts'),
    renderKpi('Count Drafts', state.countDrafts.length, 'Saved locally, not submitted'),
  ].join('');
  $('queue-list').innerHTML = state.queue.length ? state.queue.map((item) => {
    const label = item.kind === 'stock_operation' ? OP_LABELS[item.operation_type] : item.kind === 'physical_inventory' ? `${item.warehouse_type === 'raw' ? 'Raw Materials' : 'Finished Goods'} Physical Inventory` : item.kind === 'trip_create' ? 'Create Distribution Trip' : item.kind === 'trip_event' ? `Trip Action: ${item.action}` : `Operation Action: ${item.action}`;
    return `<div class="nk-list-item"><strong>${html(label || item.kind)}</strong><div class="nk-small nk-muted">${formatDateTime(item.created_on_device)} · ${html(item.reference || item.local_name || item.external_uid.slice(-8))}</div>${item.sync_error ? `<div class="nk-small nk-quantity-low" style="margin-top:5px">${html(item.sync_error)}</div>` : ''}<div class="nk-actions" style="margin-top:8px">${badge(item.sync_state || 'pending')}<button class="nk-button small light queue-retry" data-uid="${html(item.external_uid)}">Retry</button><button class="nk-button small danger queue-delete" data-uid="${html(item.external_uid)}">Delete</button></div></div>`;
  }).join('') : '<div class="nk-empty">Nothing is waiting to synchronize.</div>';
  $('count-draft-list').innerHTML = state.countDrafts.length ? state.countDrafts.map((draft) => `<div class="nk-list-item"><strong>${html(draft.reference || `${draft.warehouse_type} count`)}</strong><div class="nk-small nk-muted">Updated ${formatDateTime(draft.updated_at)} · ${(draft.rows || []).filter((row) => row.counted_quantity !== '').length} lines counted</div><div class="nk-actions" style="margin-top:8px"><button class="nk-button small light count-draft-open" data-uid="${html(draft.external_uid)}">Open</button><button class="nk-button small danger count-draft-delete" data-uid="${html(draft.external_uid)}">Delete</button></div></div>`).join('') : '<div class="nk-empty">No physical counts are saved on this device.</div>';
  $('sync-history').innerHTML = state.history.length ? state.history.slice(0, 30).map((entry) => `<div class="nk-list-item"><strong>${html(entry.message)}</strong><div class="nk-small nk-muted">${formatDateTime(entry.at)} · ${html(entry.kind || 'system')}</div>${badge(entry.status, entry.status)}</div>`).join('') : '<div class="nk-empty">No synchronization history yet.</div>';
}

function renderRoute(route) {
  if (route === 'raw') renderStock('raw');
  if (route === 'finished') renderStock('finished');
  if (route === 'distribution') renderDistribution();
  if (route === 'operations') renderOperations();
  if (route === 'contacts') renderContacts();
  if (route === 'reports') renderReports();
  if (route === 'sync') renderSyncCentre();
}

function populateProductDatalist() {
  $('all-product-options').innerHTML = state.snapshot.products.map((product) => option(product.barcode || product.default_code || product.name, `${product.name} — ${product.barcode || product.default_code || product.uom}`)).join('');
}

function populateScanFields(operationType, preset = {}) {
  const allowed = allowedOperationTypes();
  $('scan-operation').innerHTML = allowed.map((key) => option(key, OP_LABELS[key], key === operationType)).join('');
  const config = OP_CONFIG[operationType] || {};
  const partners = config.partner === 'supplier' ? state.snapshot.suppliers : state.snapshot.customers;
  $('scan-partner').innerHTML = '<option value="">Select</option>' + partners.map((partner) => option(partner.id, `${partner.name}${partner.code ? ` · ${partner.code}` : ''}`, Number(preset.partner_id) === partner.id)).join('');
  $('scan-partner-label').textContent = config.partner === 'supplier' ? 'Supplier' : 'Customer';
  $('scan-partner-field').hidden = !config.partner;
  $('scan-reason-field').hidden = !config.reasonRequired;
  $('scan-reason').innerHTML = '<option value="">Select reason</option>' + state.snapshot.reasons.filter((reason) => operationApplicableReason(reason, operationType)).map((reason) => option(reason.id, reason.name, Number(preset.reason_id) === reason.id)).join('');
  const trips = localOpenTrips();
  $('scan-trip').innerHTML = '<option value="">Select trip</option>' + trips.map((trip) => option(trip.local_uid ? `local:${trip.local_uid}` : trip.id, `${trip.name} · ${trip.truck_name} · ${trip.route_name}`, preset.trip_external_uid ? preset.trip_external_uid === trip.local_uid : Number(preset.trip_id) === trip.id)).join('');
  $('scan-trip-field').hidden = !config.tripRequired;
  $('scan-truck').innerHTML = '<option value="">Select truck</option>' + state.snapshot.trucks.map((truck) => option(truck.id, `${truck.name} · ${truck.registration}`, Number(preset.truck_id) === truck.id)).join('');
  $('scan-truck-field').hidden = !(config.truckRequired || operationType === 'finished_damage');
  if (preset.reference) $('scan-reference').value = preset.reference;
  if (preset.notes) $('scan-notes').value = preset.notes;
  syncTripTruck();
}

function openScan(operationType = '', preset = {}) {
  const allowed = allowedOperationTypes();
  const selected = allowed.includes(operationType) ? operationType : allowed[0];
  if (!selected) {
    toast('Your user does not have permission for a Nut King stock operation.', 'error');
    return;
  }
  state.scan = { operationType: selected, lines: clone(preset.lines || []), preset };
  $('scan-modal-title').textContent = OP_LABELS[selected];
  $('scan-reference').value = '';
  $('scan-notes').value = '';
  $('scan-product').value = '';
  delete $('scan-product').dataset.productId;
  closeProductAutocomplete('scan');
  $('scan-qty').value = '1';
  $('scan-lot').value = '';
  $('scan-expiration').value = '';
  populateScanFields(selected, preset);
  renderScanLines();
  openModal('scan-modal');
  window.setTimeout(() => $('scan-product').focus(), 150);
}

function syncTripTruck() {
  const value = $('scan-trip').value;
  if (!value) return;
  let trip = null;
  if (value.startsWith('local:')) trip = localOpenTrips().find((item) => item.local_uid === value.slice(6));
  else trip = tripById(value);
  if (trip?.truck_id) $('scan-truck').value = String(trip.truck_id);
}

function scanProductCandidate() {
  return autocompleteSelectedProduct('scan');
}

function addScanLine() {
  const product = scanProductCandidate();
  if (!product) {
    toast(`Choose a valid ${operationProductType(state.scan.operationType) === 'raw_material' ? 'raw material' : 'finished product'}.`, 'error');
    $('scan-product').focus();
    return;
  }
  const quantity = number($('scan-qty').value);
  if (quantity <= 0) {
    toast('Quantity must be greater than zero.', 'error');
    return;
  }
  const lot = $('scan-lot').value.trim();
  const existing = state.scan.lines.find((line) => line.product_id === product.id && String(line.lot_reference || '') === lot);
  if (existing) existing.quantity += quantity;
  else state.scan.lines.push({ product_id: product.id, quantity, lot_reference: lot, expiration_date: $('scan-expiration').value || '', notes: '' });
  $('scan-product').value = '';
  delete $('scan-product').dataset.productId;
  closeProductAutocomplete('scan');
  $('scan-qty').value = '1';
  $('scan-lot').value = '';
  $('scan-expiration').value = '';
  renderScanLines();
  $('scan-product').focus();
}

function renderScanLines() {
  $('scan-lines-body').innerHTML = state.scan.lines.length ? state.scan.lines.map((line, index) => {
    const product = productById(line.product_id);
    return `<tr><td><strong>${html(product?.name || line.product_id)}</strong></td><td>${html(product?.barcode || product?.default_code || '—')}</td><td class="number"><input class="nk-input scan-line-qty" style="max-width:120px;text-align:right" type="number" min="0.001" step="0.001" data-index="${index}" value="${line.quantity}"></td><td>${html(product?.uom || '')}</td><td>${html(line.lot_reference || '—')}</td><td>${html(line.expiration_date || '—')}</td><td><button class="nk-button small danger scan-line-remove" data-index="${index}">Remove</button></td></tr>`;
  }).join('') : '<tr><td colspan="7" class="nk-empty">Scan the first product to begin.</td></tr>';
  const total = state.scan.lines.reduce((sum, line) => sum + number(line.quantity), 0);
  $('scan-total').textContent = `${state.scan.lines.length} line${state.scan.lines.length === 1 ? '' : 's'} · ${formatNumber(total)} quantity`;
  validateScanStock(false);
}

function validateScanStock(showToast = true) {
  const operation = state.scan.operationType;
  const truckId = Number($('scan-truck').value || 0);
  const errors = [];
  for (const line of state.scan.lines) {
    const available = availableFor(operation, line.product_id, truckId);
    if (available !== null && number(line.quantity) > available + 1e-8) errors.push(`${productById(line.product_id)?.name}: ${formatNumber(line.quantity)} requested, ${formatNumber(available)} projected available`);
  }
  $('scan-stock-message').textContent = errors.length ? errors.join(' · ') : 'Projected stock check passed';
  $('scan-stock-message').className = `nk-small ${errors.length ? 'nk-quantity-low' : 'nk-muted'}`;
  if (errors.length && showToast) toast(errors[0], 'error');
  return !errors.length;
}

function buildScanDraft(desiredState = 'draft') {
  const operationType = $('scan-operation').value;
  const config = OP_CONFIG[operationType] || {};
  const tripValue = $('scan-trip').value;
  const draft = {
    external_uid: state.scan.preset?.external_uid || uid('NK-OP'), kind: 'stock_operation', operation_type: operationType,
    partner_id: Number($('scan-partner').value || 0) || false,
    reason_id: Number($('scan-reason').value || 0) || false,
    truck_id: Number($('scan-truck').value || 0) || false,
    trip_id: tripValue && !tripValue.startsWith('local:') ? Number(tripValue) : false,
    trip_external_uid: tripValue?.startsWith('local:') ? tripValue.slice(6) : false,
    reference: $('scan-reference').value.trim(), notes: $('scan-notes').value.trim(),
    lines: clone(state.scan.lines), desired_state: desiredState,
    created_on_device: state.scan.preset?.created_on_device || nowIso(), updated_on_device: nowIso(), sync_state: 'pending',
  };
  if (!draft.lines.length) throw new Error('Scan at least one product.');
  if (config.partnerRequired && !draft.partner_id) throw new Error(`Select the required ${config.partner === 'supplier' ? 'supplier' : 'customer'}.`);
  if (config.reasonRequired && !draft.reason_id) throw new Error('Select a movement reason.');
  if (config.tripRequired && !draft.trip_id && !draft.trip_external_uid) throw new Error('Select a distribution trip.');
  if (config.truckRequired && !draft.truck_id) throw new Error('Select the assigned truck.');
  const reason = reasonById(draft.reason_id);
  if (reason?.requires_note && !draft.notes) throw new Error('The selected reason requires an explanation in Notes.');
  if (desiredState === 'done' && !validateScanStock(false)) throw new Error('One or more product quantities exceed projected available stock.');
  return draft;
}

function showScanReview() {
  try {
    const draft = buildScanDraft('draft');
    state.review = { source: 'new', draft };
    renderReview(draft, true);
    closeModal('scan-modal');
    openModal('review-modal');
  } catch (error) {
    toast(error.message, 'error');
  }
}


function operationDocumentName(operation) {
  return `${operation.name || operation.reference || 'Nut King Operation'} · ${operation.operation_label || OP_LABELS[operation.operation_type] || 'Stock Operation'}`;
}

function cachedLogoDataUrl() {
  try {
    const image = document.querySelector('.nk-brand img');
    if (!image || !image.complete) return '';
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || 300;
    canvas.height = image.naturalHeight || 160;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas.toDataURL('image/png');
  } catch (error) {
    return '';
  }
}

function printCachedOperation(operation) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    toast('Allow pop-ups to print the Nut King document.', 'error');
    return;
  }
  const workflowState = operation.workflow_state || desiredOperationState(operation);
  const provisional = Boolean(operation.local) || !state.serverOnline;
  const watermark = operation.local
    ? `${operationStateLabel(workflowState).toUpperCase()} ON DEVICE · WAITING FOR SYNCHRONIZATION`
    : 'OFFLINE CACHED COPY · VERIFY AFTER SYNCHRONIZATION';
  const logo = cachedLogoDataUrl();
  const party = operation.partner || partnerById(operation.partner_id)?.name || 'Not applicable';
  const truck = operation.truck || truckById(operation.truck_id)?.name || 'Not applicable';
  const trip = operation.trip || tripById(operation.trip_id)?.name || 'Not applicable';
  const reason = operation.reason || reasonById(operation.reason_id)?.name || 'Not applicable';
  const rows = (operation.lines || []).map((line) => {
    const product = productById(line.product_id);
    return `<tr><td>${html(line.product || product?.name || '')}</td><td>${html(line.barcode || product?.barcode || '—')}</td><td class="num">${formatNumber(line.quantity)}</td><td>${html(line.uom || product?.uom || '')}</td><td>${html(line.lot_reference || '—')}</td><td>${html(line.expiration_date || '—')}</td></tr>`;
  }).join('');
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${html(operationDocumentName(operation))}</title><style>@page{size:A4;margin:15mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#17120f;margin:0;font-size:12px}.head{border-top:8px solid #ef1b23;padding-top:12px;display:flex;justify-content:space-between;align-items:center}.head img{max-width:170px;max-height:78px}.watermark{margin:14px 0;padding:10px;border:2px solid #ef1b23;background:#fff4f4;color:#b20d14;text-align:center;font-weight:700}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px 18px;margin:16px 0}.meta div{border-bottom:1px solid #ddd;padding:5px 0}.meta span{display:block;color:#6b625d;font-size:10px;text-transform:uppercase}.meta strong{display:block;margin-top:3px}table{width:100%;border-collapse:collapse;margin-top:14px}th{background:#ffc928;text-align:left}th,td{border:1px solid #cfc7c0;padding:7px}.num{text-align:right}.notes{margin-top:14px;border:1px solid #ddd;padding:10px}.sig{display:flex;gap:40px;margin-top:55px}.sig div{width:50%;border-top:1px solid #17120f;padding-top:6px}.foot{margin-top:18px;color:#6b625d;font-size:10px}@media print{button{display:none}}</style></head><body><div class="head"><div><h1 style="margin:0">Nut King Stock Operation</h1><p style="margin:4px 0">Sesame Foods Limited</p><h2 style="margin:8px 0 0">${html(operation.name || operation.reference || 'Device Draft')}</h2></div>${logo ? `<img src="${logo}" alt="The Nut Kings">` : ''}</div>${provisional ? `<div class="watermark">${html(watermark)}</div>` : ''}<div class="meta"><div><span>Operation</span><strong>${html(operation.operation_label || OP_LABELS[operation.operation_type] || '')}</strong></div><div><span>Status</span><strong>${html(operationStateLabel(workflowState))}</strong></div><div><span>Date</span><strong>${html(formatDateTime(operation.date || operation.created_on_device))}</strong></div><div><span>User</span><strong>${html(operation.user || state.snapshot.user?.name || '')}</strong></div><div><span>Supplier / Customer</span><strong>${html(party)}</strong></div><div><span>Truck / Trip</span><strong>${html(`${truck}${trip !== 'Not applicable' ? ` · ${trip}` : ''}`)}</strong></div><div><span>Movement Reason</span><strong>${html(reason)}</strong></div><div><span>Reference</span><strong>${html(operation.reference || 'Not set')}</strong></div></div><table><thead><tr><th>Product</th><th>Barcode</th><th class="num">Quantity</th><th>Unit</th><th>Batch / Lot</th><th>Expiration</th></tr></thead><tbody>${rows}</tbody></table>${operation.notes ? `<div class="notes"><strong>Notes:</strong><br>${html(operation.notes)}</div>` : ''}<div class="sig"><div>Prepared / Processed By</div><div>Authorized Signature</div></div><div class="foot">Printed from Nut King Operations ${provisional ? 'using the device copy. This document is not the authoritative server record until synchronization succeeds.' : ''}</div><script>window.onload=()=>{window.print()}<\/script></body></html>`);
  printWindow.document.close();
}

function printOperation(operation) {
  if (!operation.local && operation.print_url && state.serverOnline) {
    const win = window.open(operation.print_url, '_blank');
    if (!win) toast('Allow pop-ups to open the official Nut King PDF.', 'error');
    return;
  }
  printCachedOperation(operation);
}

function statusFlowHtml(currentState) {
  if (currentState === 'cancelled') return '<div class="nk-status-flow"><span class="cancelled active">Cancelled</span></div>';
  const order = ['draft', 'confirmed', 'done'];
  const currentIndex = Math.max(0, order.indexOf(currentState));
  return `<div class="nk-status-flow">${order.map((step, index) => `<span class="${index <= currentIndex ? 'active' : ''} ${step === currentState ? 'current' : ''}">${operationStateLabel(step)}</span>`).join('')}</div>`;
}

function renderReview(operation, editableActions = false) {
  const lines = operation.lines || [];
  const party = partnerById(operation.partner_id)?.name || 'Not applicable';
  const truck = truckById(operation.truck_id)?.name || 'Not applicable';
  const trip = operation.trip_external_uid ? localOpenTrips().find((item) => item.local_uid === operation.trip_external_uid)?.name : tripById(operation.trip_id)?.name;
  const workflowState = operation.workflow_state || desiredOperationState(operation);
  $('review-title').textContent = operation.name ? `${operation.name} · ${operation.operation_label || OP_LABELS[operation.operation_type]}` : `Review ${OP_LABELS[operation.operation_type] || 'Operation'}`;
  $('review-content').innerHTML = `${statusFlowHtml(workflowState)}<div class="nk-review-meta"><div><span>Operation</span><strong>${html(operation.operation_label || OP_LABELS[operation.operation_type] || operation.operation_type)}</strong></div><div><span>Status</span><strong>${html(operationStateLabel(workflowState))}${operation.local ? ' · Device' : ''}</strong></div><div><span>Date</span><strong>${formatDateTime(operation.date || operation.created_on_device)}</strong></div><div><span>Customer / Supplier</span><strong>${html(operation.partner || party)}</strong></div><div><span>Truck / Trip</span><strong>${html([operation.truck || truck, operation.trip || trip].filter((value) => value && value !== 'Not applicable').join(' · ') || 'Not applicable')}</strong></div><div><span>Reference</span><strong>${html(operation.reference || 'Not set')}</strong></div></div><div class="nk-table-wrap"><table class="nk-table"><thead><tr><th>Product</th><th>Barcode</th><th class="number">Quantity</th><th>Unit</th><th>Batch / Lot</th><th>Expiration</th></tr></thead><tbody>${lines.map((line) => { const product = productById(line.product_id); return `<tr><td><strong>${html(line.product || product?.name || '')}</strong></td><td>${html(line.barcode || product?.barcode || '—')}</td><td class="number">${formatNumber(line.quantity)}</td><td>${html(line.uom || product?.uom || '')}</td><td>${html(line.lot_reference || '—')}</td><td>${html(line.expiration_date || '—')}</td></tr>`; }).join('')}</tbody></table></div>${operation.reason || operation.reason_id ? `<div class="nk-card" style="margin-top:14px"><strong>Movement Reason:</strong> ${html(operation.reason || reasonById(operation.reason_id)?.name || '')}</div>` : ''}${operation.notes ? `<div class="nk-card" style="margin-top:14px"><strong>Notes</strong><div class="nk-small nk-muted" style="margin-top:7px">${html(operation.notes)}</div></div>` : ''}${operation.local ? `<div class="nk-warning-note" style="margin-top:14px">This is a device operation. ${workflowState === 'done' ? 'It is completed locally and will become official after successful synchronization.' : 'Its workflow state will be created in Odoo when synchronization succeeds.'}</div>` : ''}${operation.sync_error ? `<div class="nk-warning-note" style="margin-top:14px">${html(operation.sync_error)}</div>` : ''}`;
  const reviewActions = $('review-actions');
  if (!reviewActions) throw new Error('Review action controls are unavailable. Reload the Nut King workspace.');
  if (editableActions) {
    reviewActions.innerHTML = '<button class="nk-button light" id="review-back">Back</button><button class="nk-button secondary" id="save-draft">Save Draft</button><button class="nk-button dark" id="confirm-operation">Confirm</button><button class="nk-button primary" id="complete-operation">Complete</button>';
    return;
  }
  const buttons = ['<button class="nk-button light" data-close-modal="review-modal">Close</button>'];
  if (operation.local) {
    if (workflowState === 'draft') buttons.push(`<button class="nk-button light local-edit-operation" data-uid="${html(operation.external_uid)}">Edit</button>`, `<button class="nk-button secondary local-operation-state" data-uid="${html(operation.external_uid)}" data-state="confirmed">Confirm</button>`, `<button class="nk-button primary local-operation-state" data-uid="${html(operation.external_uid)}" data-state="done">Complete</button>`, `<button class="nk-button danger local-operation-state" data-uid="${html(operation.external_uid)}" data-state="cancelled">Cancel</button>`);
    if (workflowState === 'confirmed') buttons.push(`<button class="nk-button primary local-operation-state" data-uid="${html(operation.external_uid)}" data-state="done">Complete</button>`, `<button class="nk-button danger local-operation-state" data-uid="${html(operation.external_uid)}" data-state="cancelled">Cancel</button>`);
    if (workflowState === 'cancelled') buttons.push(`<button class="nk-button secondary local-operation-state" data-uid="${html(operation.external_uid)}" data-state="draft">Return to Draft</button>`);
    buttons.push(`<button class="nk-button dark print-operation" data-local-uid="${html(operation.external_uid)}">Print ${workflowState === 'done' ? 'Provisional Copy' : 'Device Copy'}</button>`);
    if (['draft', 'cancelled'].includes(workflowState)) buttons.push(`<button class="nk-button danger queue-delete-modal" data-uid="${html(operation.external_uid)}">Delete</button>`);
  } else {
    if (workflowState === 'draft') buttons.push(`<button class="nk-button secondary operation-action" data-id="${operation.id}" data-action="confirm">Confirm</button>`, `<button class="nk-button primary operation-action" data-id="${operation.id}" data-action="process">Complete</button>`, `<button class="nk-button danger operation-action" data-id="${operation.id}" data-action="cancel">Cancel</button>`);
    if (workflowState === 'confirmed') buttons.push(`<button class="nk-button primary operation-action" data-id="${operation.id}" data-action="process">Complete</button>`, `<button class="nk-button danger operation-action" data-id="${operation.id}" data-action="cancel">Cancel</button>`);
    if (workflowState === 'cancelled') buttons.push(`<button class="nk-button secondary operation-action" data-id="${operation.id}" data-action="reset_draft">Return to Draft</button>`);
    buttons.push(`<button class="nk-button dark print-operation" data-server-id="${operation.id}">Print</button>`);
    if (operation.web_url && state.snapshot.permissions?.system) buttons.push(`<a class="nk-button light" href="${html(operation.web_url)}">Backend</a>`);
  }
  reviewActions.innerHTML = buttons.join('');
}

async function saveReviewedDraft(desiredState) {
  if (!state.review?.draft) return;
  const draft = { ...state.review.draft, desired_state: desiredState, sync_state: 'pending', sync_error: '' };
  if (desiredState === 'done' && !validateCachedOperationStock(draft, true)) return;
  await queuePut(draft);
  closeModal('review-modal');
  state.scan = { operationType: '', lines: [], preset: {} };
  const messages = {
    draft: 'Draft saved safely on this device.',
    confirmed: 'Operation confirmed on this device.',
    done: 'Operation completed on this device. It will become official after synchronization.',
    cancelled: 'Operation cancelled on this device.',
  };
  toast(messages[desiredState] || 'Operation saved.', 'success');
  navigate('operations');
  if (state.serverOnline) syncQueue(false);
}

function openLocalOperation(uidValue) {
  const item = state.queue.find((entry) => entry.external_uid === uidValue);
  if (!item) return;
  const workflowState = desiredOperationState(item);
  const operation = { ...item, local: true, state: item.sync_state === 'error' ? 'error' : workflowState, workflow_state: workflowState };
  state.review = { source: 'queue', draft: item, operation };
  renderReview(operation, false);
  openModal('review-modal');
}

function openServerOperation(id) {
  const operation = state.snapshot.recent_operations.find((item) => item.id === Number(id));
  if (!operation) return;
  state.review = { source: 'server', operation };
  renderReview(operation, false);
  openModal('review-modal');
}


function editLocalOperation(uidValue) {
  const item = state.queue.find((entry) => entry.external_uid === uidValue);
  if (!item || desiredOperationState(item) !== 'draft') return;
  closeModal('review-modal');
  openScan(item.operation_type, item);
}

async function setLocalOperationState(uidValue, desiredState) {
  const item = state.queue.find((entry) => entry.external_uid === uidValue);
  if (!item) return;
  if (desiredState === 'done' && !validateCachedOperationStock(item, true)) return;
  if (item.kind === 'operation_event') {
    const actionByState = { confirmed: 'confirm', done: 'process', cancelled: 'cancel', draft: 'reset_draft' };
    const action = actionByState[desiredState];
    if (!action) return;
    if (desiredState === 'draft' && item.base_state === 'draft') {
      await queueDelete(item.external_uid);
      closeModal('review-modal');
      toast('The pending action was removed. The server operation remains in Draft.', 'success');
      return;
    }
    item.action = action;
  } else {
    item.desired_state = desiredState;
    delete item.process_on_sync;
  }
  item.sync_state = 'pending';
  item.sync_error = '';
  item.updated_on_device = nowIso();
  await queuePut(item);
  closeModal('review-modal');
  toast(desiredState === 'done' ? 'Completed on this device. Synchronization will post the official stock movement.' : `Operation moved to ${operationStateLabel(desiredState)}.`, 'success');
  if (state.serverOnline) syncQueue(false);
}

async function operationAction(operationId, action) {
  const operation = state.snapshot.recent_operations.find((item) => item.id === Number(operationId));
  if (!operation) {
    toast('The cached operation could not be found. Synchronize and try again.', 'error');
    return;
  }
  if (action === 'process' && !validateCachedOperationStock(operation, true)) return;
  if (state.serverOnline) {
    try {
      const data = await fetchJSON('/nutking/api/operation-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation_id: Number(operationId), action }) }, 60000);
      toast(`${data.operation.name} updated successfully.`, 'success');
      closeModal('review-modal');
      await refreshSnapshot(false);
      return;
    } catch (error) {
      toast(error.message, 'error');
      return;
    }
  }
  await queuePut({
    external_uid: uid('NK-OP-ACTION'), kind: 'operation_event', operation_id: Number(operationId), action,
    operation_type: operation.operation_type, truck_id: operation.truck_id || false,
    lines: clone(operation.lines || []), created_on_device: nowIso(), sync_state: 'pending',
    reference: operation.name, base_state: operation.state,
  });
  toast(action === 'process' ? 'Completion saved on this device. It will post when synchronized.' : 'Operation action saved on this device.', 'success');
  closeModal('review-modal');
}

function renderCountDraftOptions() {
  $('count-draft-select').innerHTML = '<option value="">Start a new count</option>' + state.countDrafts.map((draft) => option(draft.external_uid, `${draft.reference || draft.warehouse_type} · ${formatDateTime(draft.updated_at)}`, draft.external_uid === state.countDraftUid)).join('');
}

function openCount(type = 'raw') {
  if (!state.snapshot.permissions?.[type === 'raw' ? 'raw' : 'finished']) {
    toast('You do not have access to this warehouse count.', 'error');
    return;
  }
  navigate('inventory');
  $('count-warehouse').value = type;
  state.countDraftUid = '';
  const rows = clone(state.snapshot.inventory_rows?.[type] || []);
  state.countRows = rows.map((row) => ({ ...row, counted_quantity: '' }));
  $('count-reference').value = '';
  $('count-date').value = today();
  $('count-draft-select').value = '';
  $('count-scan').value = '';
  delete $('count-scan').dataset.productId;
  closeProductAutocomplete('count');
  renderCountRows();
  $('count-scan').focus();
}

function countFilteredRows() {
  const search = String($('count-search').value || '').trim().toLowerCase();
  const filter = $('count-filter').value || 'all';
  return state.countRows.filter((row) => {
    const counted = row.counted_quantity !== '' && row.counted_quantity !== null && row.counted_quantity !== undefined;
    const difference = counted ? number(row.counted_quantity) - number(row.quantity) : 0;
    if (filter === 'counted' && !counted) return false;
    if (filter === 'uncounted' && counted) return false;
    if (filter === 'variance' && (!counted || Math.abs(difference) < 1e-8)) return false;
    if (search && ![row.product, row.barcode, row.default_code, row.lot_name].some((value) => String(value || '').toLowerCase().includes(search))) return false;
    return true;
  });
}

function renderCountRows() {
  const rows = countFilteredRows();
  $('count-body').innerHTML = rows.length ? rows.map((row) => {
    const counted = row.counted_quantity !== '' && row.counted_quantity !== null && row.counted_quantity !== undefined;
    const difference = counted ? number(row.counted_quantity) - number(row.quantity) : 0;
    const differenceClass = difference > 0 ? 'positive' : difference < 0 ? 'negative' : '';
    return `<tr><td><strong>${html(row.product)}</strong><div class="nk-small nk-muted">${html(row.default_code || '')}</div></td><td>${html(row.barcode || '—')}</td><td>${html(row.lot_name || (row.tracking !== 'none' ? 'Lot required for new count' : '—'))}</td><td class="number">${formatNumber(row.quantity)}</td><td><input class="nk-input count-input" style="max-width:130px;text-align:right" type="number" min="0" step="0.001" data-key="${html(row.row_key)}" value="${counted ? row.counted_quantity : ''}" placeholder="Count"></td><td class="number nk-difference ${differenceClass}">${counted ? formatNumber(difference) : '—'}</td><td>${html(formatDate(row.last_count_date) || 'Never')}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="nk-empty">No physical-inventory rows match this filter.</td></tr>';
  const countedRows = state.countRows.filter((row) => row.counted_quantity !== '' && row.counted_quantity !== null && row.counted_quantity !== undefined);
  const varianceRows = countedRows.filter((row) => Math.abs(number(row.counted_quantity) - number(row.quantity)) > 1e-8);
  const varianceTotal = varianceRows.reduce((sum, row) => sum + number(row.counted_quantity) - number(row.quantity), 0);
  $('count-summary').textContent = `${countedRows.length} of ${state.countRows.length} rows counted`;
  $('count-variance-summary').textContent = `${varianceRows.length} variance line${varianceRows.length === 1 ? '' : 's'} · Net difference ${formatNumber(varianceTotal)}`;
}

function addCountScan() {
  const type = $('count-warehouse').value;
  const product = autocompleteSelectedProduct('count');
  if (!product) {
    toast('Scan a valid product for this warehouse.', 'error');
    return;
  }
  const matching = state.countRows.filter((row) => row.product_id === product.id);
  if (!matching.length) {
    toast('This product is not available in the current count snapshot.', 'error');
    return;
  }
  if (matching.length > 1) {
    toast(`${product.name} has multiple lot or stock rows. Enter the count on the correct row.`, 'error');
    $('count-search').value = product.name;
    renderCountRows();
    return;
  }
  const quantity = number($('count-scan-qty').value);
  const row = matching[0];
  row.counted_quantity = (row.counted_quantity === '' ? 0 : number(row.counted_quantity)) + quantity;
  $('count-scan').value = '';
  delete $('count-scan').dataset.productId;
  closeProductAutocomplete('count');
  $('count-scan-qty').value = '1';
  renderCountRows();
  $('count-scan').focus();
}

function countDraftPayload() {
  const countedRows = state.countRows.filter((row) => row.counted_quantity !== '' && row.counted_quantity !== null && row.counted_quantity !== undefined);
  if (!countedRows.length) throw new Error('Enter at least one counted quantity.');
  return {
    external_uid: state.countDraftUid || uid('NK-COUNT-DRAFT'),
    warehouse_type: $('count-warehouse').value,
    count_date: $('count-date').value || today(),
    reference: $('count-reference').value.trim(),
    rows: clone(state.countRows),
    updated_at: nowIso(),
  };
}

async function saveCountOnDevice() {
  try {
    const draft = countDraftPayload();
    await storePut('countDrafts', draft);
    state.countDraftUid = draft.external_uid;
    state.countDrafts = await storeAll('countDrafts');
    renderCountDraftOptions();
    renderSyncCentre();
    toast('Physical count saved safely on this device.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function submitCount() {
  try {
    const draft = countDraftPayload();
    const lines = draft.rows.filter((row) => row.counted_quantity !== '' && row.counted_quantity !== null && row.counted_quantity !== undefined).map((row) => ({
      quant_id: row.quant_id || false, product_id: row.product_id, location_id: row.location_id,
      lot_id: row.lot_id || false, lot_reference: row.lot_name || '', package_id: row.package_id || false, owner_id: row.owner_id || false,
      expected_quantity: number(row.quantity), counted_quantity: number(row.counted_quantity),
    }));
    const queueItem = { external_uid: uid('NK-COUNT'), kind: 'physical_inventory', warehouse_type: draft.warehouse_type, count_date: draft.count_date, reference: draft.reference, lines, created_on_device: nowIso(), sync_state: 'pending' };
    await queuePut(queueItem);
    if (state.countDraftUid) await storeDelete('countDrafts', state.countDraftUid);
    state.countDraftUid = '';
    state.countDrafts = await storeAll('countDrafts');
    state.countRows = [];
    renderCountDraftOptions();
    renderCountRows();
    toast('Physical inventory submitted. It will apply through Odoo when synchronized.', 'success');
    navigate('sync');
    if (state.serverOnline) syncQueue(false);
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function openCountDraft(uidValue) {
  const draft = state.countDrafts.find((item) => item.external_uid === uidValue);
  if (!draft) return;
  navigate('inventory');
  state.countDraftUid = draft.external_uid;
  $('count-warehouse').value = draft.warehouse_type;
  $('count-date').value = draft.count_date;
  $('count-reference').value = draft.reference || '';
  state.countRows = clone(draft.rows || []);
  renderCountDraftOptions();
  $('count-draft-select').value = draft.external_uid;
  renderCountRows();
}

function openTripCreate() {
  $('trip-truck').innerHTML = '<option value="">Select truck</option>' + state.snapshot.trucks.map((truck) => option(truck.id, `${truck.name} · ${truck.registration}`)).join('');
  $('trip-driver').innerHTML = '<option value="">Select driver</option>' + state.snapshot.staff.filter((member) => member.role === 'driver').map((member) => option(member.id, member.name)).join('');
  $('trip-team').innerHTML = state.snapshot.staff.filter((member) => ['distribution', 'driver', 'supervisor'].includes(member.role)).map((member) => option(member.id, `${member.name} · ${member.role.replaceAll('_', ' ')}`)).join('');
  $('trip-customers').innerHTML = state.snapshot.customers.map((customer) => option(customer.id, `${customer.name}${customer.route ? ` · ${customer.route}` : ''}`)).join('');
  $('trip-route').value = '';
  const departure = new Date(Date.now() + 30 * 60 * 1000);
  departure.setMinutes(departure.getMinutes() - departure.getTimezoneOffset());
  $('trip-departure').value = departure.toISOString().slice(0, 16);
  $('trip-notes').value = '';
  openModal('trip-modal');
}

async function saveTrip() {
  const truckId = Number($('trip-truck').value || 0);
  const driverId = Number($('trip-driver').value || 0);
  const routeName = $('trip-route').value.trim();
  if (!truckId || !driverId || !routeName) {
    toast('Truck, driver, and route are required.', 'error');
    return;
  }
  const item = {
    external_uid: uid('NK-TRIP'), kind: 'trip_create', local_name: `Pending · ${truckById(truckId)?.name || 'Trip'}`,
    truck_id: truckId, driver_id: driverId, team_ids: selectedValues($('trip-team')), customer_ids: selectedValues($('trip-customers')),
    route_name: routeName, planned_departure: $('trip-departure').value ? new Date($('trip-departure').value).toISOString() : nowIso(), notes: $('trip-notes').value.trim(), created_on_device: nowIso(), sync_state: 'pending',
  };
  await queuePut(item);
  closeModal('trip-modal');
  toast('Distribution trip saved on this device.', 'success');
  if (state.serverOnline) syncQueue(false);
}

function getTripFromElement(element) {
  if (element.dataset.tripLocal) return localOpenTrips().find((trip) => trip.local_uid === element.dataset.tripLocal);
  return tripById(element.dataset.tripId);
}

function openTripDetails(trip) {
  if (!trip) return;
  state.currentTrip = trip;
  $('trip-review-title').textContent = `${trip.name} · ${trip.truck_name}`;
  $('trip-review-content').innerHTML = `<div class="nk-review-meta"><div><span>Status</span><strong>${html(trip.state_label || trip.state)}</strong></div><div><span>Route</span><strong>${html(trip.route_name)}</strong></div><div><span>Driver</span><strong>${html(trip.driver_name || 'Not assigned')}</strong></div><div><span>Planned Departure</span><strong>${formatDateTime(trip.planned_departure)}</strong></div><div><span>Actual Departure</span><strong>${formatDateTime(trip.actual_departure)}</strong></div><div><span>Actual Return</span><strong>${formatDateTime(trip.actual_return)}</strong></div></div><div class="nk-trip-totals"><div><span>Loaded</span><strong>${formatNumber(trip.total_loaded)}</strong></div><div><span>Delivered</span><strong>${formatNumber(trip.total_delivered)}</strong></div><div><span>Returned</span><strong>${formatNumber(trip.total_returned)}</strong></div><div><span>Damaged</span><strong>${formatNumber(trip.total_damaged)}</strong></div><div><span>Variance</span><strong>${formatNumber(trip.total_variance)}</strong></div></div>${trip.reconciliation_lines?.length ? `<div class="nk-table-wrap" style="margin-top:15px"><table class="nk-table"><thead><tr><th>Product</th><th class="number">Loaded</th><th class="number">Delivered</th><th class="number">Returned</th><th class="number">Damaged</th><th class="number">Variance</th></tr></thead><tbody>${trip.reconciliation_lines.map((line) => `<tr><td>${html(line.product)}</td><td class="number">${formatNumber(line.loaded)}</td><td class="number">${formatNumber(line.delivered)}</td><td class="number">${formatNumber(line.returned)}</td><td class="number">${formatNumber(line.damaged)}</td><td class="number ${Math.abs(number(line.variance)) > .0001 ? 'nk-quantity-low' : ''}">${formatNumber(line.variance)}</td></tr>`).join('')}</tbody></table></div>` : ''}${trip.variance_explanation ? `<div class="nk-card" style="margin-top:14px"><strong>Variance Explanation</strong><div class="nk-small nk-muted" style="margin-top:6px">${html(trip.variance_explanation)}</div></div>` : ''}`;
  openModal('trip-review-modal');
}

async function tripEvent(trip, action) {
  if (!trip) return;
  let explanation = '';
  if (action === 'close' && Math.abs(number(trip.total_variance)) > .0001) {
    explanation = window.prompt('Enter the variance explanation before closing this trip:', trip.variance_explanation || '') || '';
    if (!explanation) return;
  }
  await queuePut({ external_uid: uid('NK-TRIP-EVENT'), kind: 'trip_event', trip_id: trip.id || false, trip_external_uid: trip.local_uid || false, action, variance_explanation: explanation, reference: `${trip.name}: ${action}`, created_on_device: nowIso(), sync_state: 'pending' });
  toast('Trip action saved. It will update Odoo when synchronized.', 'success');
  if (state.serverOnline) syncQueue(false);
}

function scanForTrip(trip, operationType) {
  if (!trip) return;
  openScan(operationType, { trip_id: trip.id || false, trip_external_uid: trip.local_uid || false, truck_id: trip.truck_id, reference: trip.name });
}

function renderOperationTypeFilter() {
  $('operation-type-filter').innerHTML = '<option value="all">All operation types</option>' + Object.entries(OP_LABELS).map(([value, label]) => option(value, label)).join('');
}

function bindEvents() {
  all('.nk-nav-button').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.route)));
  all('[data-route-target]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.routeTarget)));
  all('[data-scan]').forEach((button) => button.addEventListener('click', () => openScan(button.dataset.scan)));
  all('[data-count]').forEach((button) => button.addEventListener('click', () => openCount(button.dataset.count)));
  all('[data-close-modal]').forEach((button) => button.addEventListener('click', () => closeModal(button.dataset.closeModal)));
  all('.nk-modal-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeModal(backdrop.id); }));
  $('mobile-menu').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  $('top-sync').addEventListener('click', () => syncQueue(true));
  $('sync-now').addEventListener('click', () => syncQueue(true));
  $('scan-operation').addEventListener('change', () => { state.scan.operationType = $('scan-operation').value; state.scan.lines = []; $('scan-product').value = ''; delete $('scan-product').dataset.productId; closeProductAutocomplete('scan'); populateScanFields(state.scan.operationType); $('scan-modal-title').textContent = OP_LABELS[state.scan.operationType]; renderScanLines(); });
  $('scan-trip').addEventListener('change', () => { syncTripTruck(); if ($('scan-product').value.trim().length >= PRODUCT_SEARCH_MIN_CHARS) renderProductAutocomplete('scan'); });
  $('scan-truck').addEventListener('change', () => { if ($('scan-product').value.trim().length >= PRODUCT_SEARCH_MIN_CHARS) renderProductAutocomplete('scan'); });
  $('scan-add').addEventListener('click', addScanLine);
  bindProductAutocomplete('scan');
  $('scan-review').addEventListener('click', showScanReview);
  $('scan-clear').addEventListener('click', () => { state.scan.lines = []; renderScanLines(); });
  $('scan-lines-body').addEventListener('change', (event) => { if (event.target.matches('.scan-line-qty')) { state.scan.lines[Number(event.target.dataset.index)].quantity = number(event.target.value); renderScanLines(); } });
  $('scan-lines-body').addEventListener('click', (event) => { const button = event.target.closest('.scan-line-remove'); if (button) { state.scan.lines.splice(Number(button.dataset.index), 1); renderScanLines(); } });
  $('review-actions').addEventListener('click', async (event) => {
    const closeButton = event.target.closest('[data-close-modal]');
    if (closeButton) { closeModal(closeButton.dataset.closeModal); return; }
    if (event.target.id === 'review-back') { closeModal('review-modal'); openModal('scan-modal'); }
    if (event.target.id === 'save-draft') await saveReviewedDraft('draft');
    if (event.target.id === 'confirm-operation') await saveReviewedDraft('confirmed');
    if (event.target.id === 'complete-operation') await saveReviewedDraft('done');
    const actionButton = event.target.closest('.operation-action'); if (actionButton) await operationAction(actionButton.dataset.id, actionButton.dataset.action);
    const localStateButton = event.target.closest('.local-operation-state'); if (localStateButton) await setLocalOperationState(localStateButton.dataset.uid, localStateButton.dataset.state);
    const editButton = event.target.closest('.local-edit-operation'); if (editButton) editLocalOperation(editButton.dataset.uid);
    const printButton = event.target.closest('.print-operation'); if (printButton) { const operation = printButton.dataset.localUid ? localOperationRows().find((item) => item.external_uid === printButton.dataset.localUid) : state.snapshot.recent_operations.find((item) => item.id === Number(printButton.dataset.serverId)); if (operation) printOperation(operation); }
    const deleteButton = event.target.closest('.queue-delete-modal'); if (deleteButton) { await queueDelete(deleteButton.dataset.uid); closeModal('review-modal'); toast('Local operation deleted.', 'success'); }
  });
  ['raw-search', 'raw-filter'].forEach((id) => $(id).addEventListener('input', () => renderStock('raw')));
  ['finished-search', 'finished-filter'].forEach((id) => $(id).addEventListener('input', () => renderStock('finished')));
  ['trip-search', 'trip-filter'].forEach((id) => $(id).addEventListener('input', renderDistribution));
  $('trip-grid').addEventListener('click', async (event) => {
    const detail = event.target.closest('.trip-details'); if (detail) openTripDetails(getTripFromElement(detail));
    const scan = event.target.closest('.trip-scan'); if (scan) scanForTrip(getTripFromElement(scan), scan.dataset.operation);
    const action = event.target.closest('.trip-event'); if (action) await tripEvent(getTripFromElement(action), action.dataset.action);
  });
  $('new-trip').addEventListener('click', openTripCreate);
  $('trip-save').addEventListener('click', saveTrip);
  $('count-warehouse').addEventListener('change', () => openCount($('count-warehouse').value));
  $('count-add-scan').addEventListener('click', addCountScan);
  bindProductAutocomplete('count');
  ['count-search', 'count-filter'].forEach((id) => $(id).addEventListener('input', renderCountRows));
  $('count-body').addEventListener('change', (event) => { if (event.target.matches('.count-input')) { const row = state.countRows.find((item) => item.row_key === event.target.dataset.key); if (row) row.counted_quantity = event.target.value === '' ? '' : number(event.target.value); renderCountRows(); } });
  $('count-zero-visible').addEventListener('click', () => { countFilteredRows().forEach((row) => { row.counted_quantity = 0; }); renderCountRows(); });
  $('count-clear').addEventListener('click', () => { state.countRows.forEach((row) => { row.counted_quantity = ''; }); renderCountRows(); });
  $('count-save-device').addEventListener('click', saveCountOnDevice);
  $('count-submit').addEventListener('click', submitCount);
  $('count-draft-select').addEventListener('change', () => { if ($('count-draft-select').value) openCountDraft($('count-draft-select').value); else openCount($('count-warehouse').value); });
  $('open-native-count').addEventListener('click', () => {
    const key = $('count-warehouse').value === 'raw' ? 'raw_inventory' : 'finished_inventory';
    const actionId = state.snapshot.native_actions?.[key];
    window.location.href = actionId ? `/web#action=${actionId}` : '/web';
  });
  ['operation-search', 'operation-filter', 'operation-type-filter'].forEach((id) => $(id).addEventListener('input', renderOperations));
  $('new-operation').addEventListener('click', () => openScan());
  $('operations-body').addEventListener('click', (event) => { const local = event.target.closest('.local-operation-review'); if (local) openLocalOperation(local.dataset.uid); const server = event.target.closest('.server-operation-review'); if (server) openServerOperation(server.dataset.id); });
  all('.contact-tab').forEach((button) => button.addEventListener('click', () => { state.contactTab = button.dataset.contactTab; renderContacts(); }));
  $('contact-search').addEventListener('input', renderContacts);
  $('queue-list').addEventListener('click', async (event) => { const retry = event.target.closest('.queue-retry'); if (retry) { const item = state.queue.find((entry) => entry.external_uid === retry.dataset.uid); if (item) { item.sync_state = 'pending'; item.sync_error = ''; await queuePut(item); syncQueue(true); } } const remove = event.target.closest('.queue-delete'); if (remove && window.confirm('Delete this unsynchronized device action?')) await queueDelete(remove.dataset.uid); });
  $('count-draft-list').addEventListener('click', async (event) => { const open = event.target.closest('.count-draft-open'); if (open) openCountDraft(open.dataset.uid); const remove = event.target.closest('.count-draft-delete'); if (remove && window.confirm('Delete this saved physical count?')) { await storeDelete('countDrafts', remove.dataset.uid); state.countDrafts = await storeAll('countDrafts'); renderAll(); } });
  $('clear-history').addEventListener('click', async () => { await storeClear('history'); state.history = []; renderSyncCentre(); });
  window.addEventListener('online', async () => { await checkServer(); if (state.serverOnline) syncQueue(false); });
  window.addEventListener('offline', () => { state.serverOnline = false; updateConnectionUI(); });
  window.addEventListener('hashchange', () => navigate(routeFromHash(), false));
}

function showStartupError(error) {
  console.error('Nut King workspace startup failed', error);
  const message = error?.message || String(error || 'Unknown startup error');
  const pill = $('connection-pill');
  if (pill) pill.classList.add('offline');
  if ($('connection-text')) $('connection-text').textContent = 'Workspace startup error';
  if ($('offline-banner')) {
    $('offline-banner').classList.add('show');
    $('offline-banner').innerHTML = `<strong>The Nut King workspace could not start.</strong> ${html(message)}<br><button class="nk-button light small" id="nk-reload-workspace" type="button">Reload Workspace</button>`;
    $('nk-reload-workspace')?.addEventListener('click', () => window.location.reload());
  }
  document.documentElement.dataset.nkBoot = 'error';
}

async function init() {
  document.documentElement.dataset.nkBoot = 'starting';
  bindEvents();
  renderOperationTypeFilter();
  await loadLocalState();
  renderAll();
  navigate(routeFromHash(), false);
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/nutking/sw.js?v=0.5.0', { scope: '/nutking/' });
      registration.update().catch(() => {});
    } catch (error) {
      console.warn('Nut King service worker registration failed', error);
    }
  }
  if (navigator.storage?.persist) {
    try { await navigator.storage.persist(); } catch (error) { console.warn('Persistent storage request failed', error); }
  }
  const online = await checkServer();
  if (online) {
    if (state.queue.length) await syncQueue(false);
    else await refreshSnapshot(false);
  } else if (!state.snapshot.saved_at) {
    toast('Open the Nut King workspace once while online to download the first operational snapshot.', 'error');
  }
  document.documentElement.dataset.nkBoot = 'ready';
  window.setInterval(async () => {
    const reachable = await checkServer();
    if (reachable && state.queue.length) syncQueue(false);
  }, 30000);
}

function startWorkspace() {
  Promise.resolve(init()).catch(showStartupError);
}

window.addEventListener('error', (event) => {
  if (document.documentElement.dataset.nkBoot !== 'ready') showStartupError(event.error || new Error(event.message));
});
window.addEventListener('unhandledrejection', (event) => {
  if (document.documentElement.dataset.nkBoot !== 'ready') showStartupError(event.reason || new Error('Unhandled startup error'));
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startWorkspace, { once: true });
else startWorkspace();
