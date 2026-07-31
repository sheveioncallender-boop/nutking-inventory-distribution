'use strict';

const DB_NAME = 'nutking-offline';
const DB_VERSION = 3;
const STORE = 'transactions';
const CACHE_KEY = 'nk-bootstrap-v3';
const HISTORY_KEY = 'nk-sync-history-v1';

const OP_LABELS = {
  raw_receipt: 'Receive Raw Materials',
  raw_issue: 'Issue Raw Materials',
  raw_supplier_return: 'Return Raw Materials to Supplier',
  raw_damage: 'Record Damaged Raw Materials',
  raw_expired: 'Record Expired Raw Materials',
  finished_add: 'Receive Finished Goods',
  finished_issue: 'Issue Finished Goods',
  truck_load: 'Load Truck',
  customer_delivery: 'Customer Delivery',
  truck_return: 'Return Truck Stock',
  customer_return: 'Customer Return',
  finished_damage: 'Record Damaged Finished Goods',
};
const RAW_OPERATIONS = new Set(['raw_receipt', 'raw_issue', 'raw_supplier_return', 'raw_damage', 'raw_expired']);
const SUPPLIER_OPERATIONS = new Set(['raw_receipt', 'raw_supplier_return']);
const CUSTOMER_OPERATIONS = new Set(['customer_delivery', 'customer_return', 'finished_issue']);
const REQUIRED_PARTNER = new Set(['raw_receipt', 'raw_supplier_return', 'customer_delivery', 'customer_return']);
const REQUIRED_REASON = new Set(['raw_issue', 'raw_supplier_return', 'raw_damage', 'raw_expired', 'finished_issue', 'truck_return', 'customer_return', 'finished_damage']);
const REQUIRED_TRUCK = new Set(['truck_load', 'customer_delivery', 'truck_return']);
const REQUIRED_TRIP = new Set(['truck_load', 'customer_delivery', 'truck_return']);
const STOCK_OUT_RAW = new Set(['raw_issue', 'raw_supplier_return', 'raw_damage', 'raw_expired']);
const STOCK_OUT_FINISHED = new Set(['finished_issue', 'truck_load']);
const STOCK_OUT_TRUCK = new Set(['customer_delivery', 'truck_return']);

let bootstrap = {
  user: {}, capabilities: [], balances: {raw: {}, finished: {}, trucks: {}}, products: [], trucks: [], customers: [], suppliers: [], trips: [], reasons: [], recent_operations: [], server_time: '',
};
let scanLines = [];
let currentReview = null;

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const uid = () => `NK-OFF-${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(16)}`;
const number = (value) => Number(value || 0);
const fmt = (value) => new Intl.NumberFormat(undefined, {maximumFractionDigits: 3}).format(number(value));
const dateText = (value) => value ? new Date(value).toLocaleString() : 'Not set';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, {keyPath: 'external_uid'});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function dbAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}
async function dbPut(item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
async function dbDelete(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function historyItems() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function addHistory(item) {
  const items = historyItems();
  items.unshift(item);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 50)));
}
function setMessage(text, error = false) {
  $('message').textContent = text;
  $('message').className = `small message ${error ? 'error' : text ? 'success' : ''}`;
}
function setReviewMessage(text, error = false) {
  $('review-message').textContent = text;
  $('review-message').className = `small message ${error ? 'error' : text ? 'success' : ''}`;
}
function setConnection() {
  const online = navigator.onLine;
  $('connection').textContent = online ? 'Online' : 'Offline — using the last synchronized Nut King data';
  $('connection').className = online ? 'online' : 'offline';
}
function option(value, label) { return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`; }

function allowedOperations() {
  return Object.keys(OP_LABELS).filter((key) => (bootstrap.capabilities || []).includes(key));
}
function operationProductType(operationType) {
  return RAW_OPERATIONS.has(operationType) ? 'raw_material' : 'finished_good';
}
function productSearchValue(product) {
  return product.barcode || product.default_code || product.name;
}
function findProduct(value) {
  const query = String(value || '').trim().toLowerCase();
  if (!query) return null;
  return bootstrap.products.find((product) => [product.barcode, product.default_code, product.name, `${product.name} — ${product.barcode || product.default_code || ''}`]
    .filter(Boolean).some((candidate) => String(candidate).trim().toLowerCase() === query)) || null;
}
function productById(id) { return bootstrap.products.find((item) => item.id === Number(id)); }
function partnerById(id) { return [...bootstrap.customers, ...bootstrap.suppliers].find((item) => item.id === Number(id)); }
function reasonById(id) { return bootstrap.reasons.find((item) => item.id === Number(id)); }
function tripById(id) { return bootstrap.trips.find((item) => item.id === Number(id)); }
function truckById(id) { return bootstrap.trucks.find((item) => item.id === Number(id)); }

function adjustBalance(snapshot, transaction) {
  for (const line of transaction.lines || []) {
    const productId = String(line.product_id);
    const quantity = number(line.quantity);
    const truckId = String(transaction.truck_id || '');
    snapshot.raw[productId] ||= 0;
    snapshot.finished[productId] ||= 0;
    if (transaction.operation_type === 'raw_receipt') snapshot.raw[productId] += quantity;
    if (STOCK_OUT_RAW.has(transaction.operation_type)) snapshot.raw[productId] -= quantity;
    if (transaction.operation_type === 'finished_add') snapshot.finished[productId] += quantity;
    if (transaction.operation_type === 'finished_issue') snapshot.finished[productId] -= quantity;
    if (transaction.operation_type === 'truck_load') {
      snapshot.finished[productId] -= quantity;
      snapshot.trucks[truckId] ||= {};
      snapshot.trucks[truckId][productId] ||= 0;
      snapshot.trucks[truckId][productId] += quantity;
    }
    if (['customer_delivery', 'truck_return'].includes(transaction.operation_type)) {
      snapshot.trucks[truckId] ||= {};
      snapshot.trucks[truckId][productId] ||= 0;
      snapshot.trucks[truckId][productId] -= quantity;
      if (transaction.operation_type === 'truck_return') snapshot.finished[productId] += quantity;
    }
    if (transaction.operation_type === 'finished_damage') {
      if (transaction.truck_id) {
        snapshot.trucks[truckId] ||= {};
        snapshot.trucks[truckId][productId] ||= 0;
        snapshot.trucks[truckId][productId] -= quantity;
      } else snapshot.finished[productId] -= quantity;
    }
  }
}
async function projectedBalances() {
  const base = JSON.parse(JSON.stringify(bootstrap.balances || {raw: {}, finished: {}, trucks: {}}));
  base.raw ||= {}; base.finished ||= {}; base.trucks ||= {};
  for (const transaction of await dbAll()) adjustBalance(base, transaction);
  return base;
}
async function availableFor(operationType, productId, truckId) {
  const balances = await projectedBalances();
  const key = String(productId);
  if (STOCK_OUT_RAW.has(operationType)) return number(balances.raw[key]);
  if (STOCK_OUT_FINISHED.has(operationType) || (operationType === 'finished_damage' && !truckId)) return number(balances.finished[key]);
  if (STOCK_OUT_TRUCK.has(operationType) || (operationType === 'finished_damage' && truckId)) return number((balances.trucks[String(truckId)] || {})[key]);
  return null;
}

function setTab(tab) {
  document.querySelectorAll('.nav button').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === `panel-${tab}`));
  if (tab === 'raw' || tab === 'finished') renderStockPanels();
  if (tab === 'queue') renderQueue();
  if (tab === 'trips') renderTrips();
  if (tab === 'contacts') renderCustomers();
}

function populateOperationOptions() {
  const allowed = allowedOperations();
  $('operation').innerHTML = allowed.map((key) => option(key, OP_LABELS[key])).join('');
  document.querySelectorAll('[data-operation]').forEach((button) => {
    button.hidden = !allowed.includes(button.dataset.operation);
  });
  const requested = new URLSearchParams(window.location.search).get('operation_type');
  if (requested && allowed.includes(requested)) $('operation').value = requested;
  if (!$('operation').value && allowed.length) $('operation').value = allowed[0];
  updateDependentFields();
}
function populateProducts() {
  const expected = operationProductType($('operation').value);
  const products = bootstrap.products.filter((item) => item.type === expected);
  $('product-options').innerHTML = products.map((product) => {
    const value = productSearchValue(product);
    const extra = [product.barcode, product.default_code].filter(Boolean).join(' / ');
    return `<option value="${escapeHtml(value)}">${escapeHtml(product.name)}${extra ? ` — ${escapeHtml(extra)}` : ''}</option>`;
  }).join('');
}
function updateDependentFields() {
  const operation = $('operation').value;
  $('scan-title').textContent = OP_LABELS[operation] || 'Rapid Scan';
  const partners = SUPPLIER_OPERATIONS.has(operation) ? bootstrap.suppliers : CUSTOMER_OPERATIONS.has(operation) ? bootstrap.customers : [];
  $('partner').innerHTML = `<option value="">${REQUIRED_PARTNER.has(operation) ? 'Select required option' : 'Not applicable'}</option>` + partners.map((item) => option(item.id, `${item.name}${item.code ? ` · ${item.code}` : ''}`)).join('');
  $('partner').disabled = partners.length === 0;
  $('truck').disabled = !['truck_load', 'customer_delivery', 'truck_return', 'finished_damage'].includes(operation);
  $('trip').disabled = !REQUIRED_TRIP.has(operation);
  const reasonArea = RAW_OPERATIONS.has(operation) ? 'raw' : ['truck_load', 'customer_delivery', 'truck_return', 'customer_return'].includes(operation) ? 'distribution' : 'finished';
  const reasons = bootstrap.reasons.filter((reason) => reason.applies_to === 'all' || reason.applies_to === reasonArea);
  $('reason').innerHTML = `<option value="">${REQUIRED_REASON.has(operation) ? 'Select movement reason' : 'Not applicable'}</option>` + reasons.map((item) => option(item.id, item.name)).join('');
  $('reason').disabled = !REQUIRED_REASON.has(operation) && !reasons.length;
  scanLines = [];
  renderScanLines();
  populateProducts();
  setMessage('');
  $('product-input').focus();
}
function updateTripTruck() {
  const trip = tripById($('trip').value);
  if (trip) $('truck').value = String(trip.truck_id);
}
function chooseOperation(operationType) {
  if (!allowedOperations().includes(operationType)) return;
  $('operation').value = operationType;
  updateDependentFields();
  setTab('scan');
  window.scrollTo({top: $('scan-title').getBoundingClientRect().top + window.scrollY - 15, behavior: 'smooth'});
}

async function addLine() {
  const product = findProduct($('product-input').value);
  if (!product) { setMessage('Product not found. Scan a valid barcode or select a downloaded Nut King product.', true); return; }
  const operationType = $('operation').value;
  const expectedType = operationProductType(operationType);
  if (product.type !== expectedType) { setMessage(`This operation requires a ${expectedType.replace('_', ' ')} product.`, true); return; }
  const quantity = number($('scan-quantity').value);
  if (!(quantity > 0)) { setMessage('Enter a quantity greater than zero.', true); return; }
  const truckId = Number($('truck').value) || false;
  const available = await availableFor(operationType, product.id, truckId);
  const currentRequested = scanLines.filter((line) => line.product_id === product.id).reduce((sum, line) => sum + number(line.quantity), 0);
  if (available !== null && currentRequested + quantity > available) {
    setMessage(`Only ${fmt(available)} is available based on the last sync and waiting drafts on this device.`, true);
    return;
  }
  const lot = $('lot').value.trim();
  const expiration = $('expiration').value || '';
  const existing = scanLines.find((line) => line.product_id === product.id && line.lot_reference === lot && line.expiration_date === expiration);
  if (existing) existing.quantity = number(existing.quantity) + quantity;
  else scanLines.push({
    product_id: product.id, product_name: product.name, barcode: product.barcode || product.default_code || '', quantity, uom: product.uom, lot_reference: lot, expiration_date: expiration,
  });
  $('product-input').value = '';
  $('lot').value = '';
  $('expiration').value = '';
  $('scan-quantity').value = '1';
  setMessage(`${product.name} added. ${existing ? 'Quantity increased.' : ''}`);
  renderScanLines();
  $('product-input').focus();
}
function renderScanLines() {
  if (!scanLines.length) {
    $('scan-lines').innerHTML = '<tr><td colspan="7" class="empty">Scan the first product to begin.</td></tr>';
    return;
  }
  $('scan-lines').innerHTML = scanLines.map((line, index) => `<tr><td><strong>${escapeHtml(line.product_name)}</strong></td><td>${escapeHtml(line.barcode || '—')}</td><td class="qty"><input data-line-qty="${index}" type="number" min="0.001" step="0.001" value="${escapeHtml(line.quantity)}" style="min-width:95px"></td><td>${escapeHtml(line.uom)}</td><td>${escapeHtml(line.lot_reference || '—')}</td><td>${escapeHtml(line.expiration_date || '—')}</td><td><button class="danger" data-remove-line="${index}" type="button">Remove</button></td></tr>`).join('');
  document.querySelectorAll('[data-remove-line]').forEach((button) => button.addEventListener('click', () => { scanLines.splice(Number(button.dataset.removeLine), 1); renderScanLines(); }));
  document.querySelectorAll('[data-line-qty]').forEach((input) => input.addEventListener('change', () => {
    const value = number(input.value);
    if (value > 0) scanLines[Number(input.dataset.lineQty)].quantity = value;
    else { input.value = scanLines[Number(input.dataset.lineQty)].quantity; setMessage('Quantity must be greater than zero.', true); }
  }));
}
function validateHeader() {
  const operationType = $('operation').value;
  if (!operationType) return 'Select an operation.';
  if (!scanLines.length) return 'Scan or add at least one product.';
  if (REQUIRED_PARTNER.has(operationType) && !$('partner').value) return 'Select the required customer or supplier.';
  if (REQUIRED_REASON.has(operationType) && !$('reason').value) return 'Select a movement reason.';
  if (REQUIRED_TRIP.has(operationType) && !$('trip').value) return 'Select the distribution trip.';
  if (REQUIRED_TRUCK.has(operationType) && !$('truck').value) return 'Select the truck.';
  const reason = reasonById($('reason').value);
  if (reason?.requires_note && !$('notes').value.trim()) return 'The selected reason requires an explanatory note.';
  return '';
}
function buildTransaction() {
  const reference = $('reference').value.trim();
  const notes = [$('notes').value.trim(), reference ? `Reference: ${reference}` : ''].filter(Boolean).join('\n');
  return {
    external_uid: uid(), device_name: navigator.userAgent.slice(0, 120), created_on_device: new Date().toISOString(), operation_type: $('operation').value,
    partner_id: Number($('partner').value) || false, truck_id: Number($('truck').value) || false, trip_id: Number($('trip').value) || false,
    reason_id: Number($('reason').value) || false, notes, lines: scanLines.map((line) => ({product_id: line.product_id, quantity: number(line.quantity), lot_reference: line.lot_reference || false, expiration_date: line.expiration_date || false})),
  };
}
function showReview() {
  const error = validateHeader();
  if (error) { setMessage(error, true); return; }
  currentReview = buildTransaction();
  const partner = partnerById(currentReview.partner_id);
  const reason = reasonById(currentReview.reason_id);
  const trip = tripById(currentReview.trip_id);
  const truck = truckById(currentReview.truck_id);
  $('review-title').textContent = `Review: ${OP_LABELS[currentReview.operation_type]}`;
  $('review-meta').innerHTML = [
    ['Operation', OP_LABELS[currentReview.operation_type]], ['Created By', bootstrap.user.name || 'Current user'], ['Customer / Supplier', partner?.name || 'Not applicable'], ['Movement Reason', reason?.name || 'Not applicable'], ['Distribution Trip', trip?.name || 'Not applicable'], ['Truck', truck?.name || 'Not applicable'], ['Total Lines', currentReview.lines.length], ['Total Quantity', fmt(currentReview.lines.reduce((sum, line) => sum + number(line.quantity), 0))],
  ].map(([label, value]) => `<div><b>${escapeHtml(label)}</b>${escapeHtml(value)}</div>`).join('');
  $('review-lines').innerHTML = `<table><thead><tr><th>Product</th><th>Quantity</th><th>Unit</th><th>Batch / Lot</th><th>Expiration</th></tr></thead><tbody>${currentReview.lines.map((line) => { const product = productById(line.product_id); return `<tr><td><strong>${escapeHtml(product?.name || line.product_id)}</strong></td><td class="qty">${escapeHtml(fmt(line.quantity))}</td><td>${escapeHtml(product?.uom || '')}</td><td>${escapeHtml(line.lot_reference || '—')}</td><td>${escapeHtml(line.expiration_date || '—')}</td></tr>`; }).join('')}</tbody></table>`;
  $('confirm-draft').textContent = navigator.onLine ? 'Create Draft & Open Review Screen' : 'Save Offline Draft';
  setReviewMessage('');
  $('review-overlay').classList.add('open');
}
function closeReview() { $('review-overlay').classList.remove('open'); currentReview = null; setReviewMessage(''); }
function clearScan() {
  scanLines = [];
  ['partner', 'reason', 'trip', 'truck'].forEach((id) => { if (!$(id).disabled) $(id).value = ''; });
  ['reference', 'product-input', 'lot', 'expiration', 'notes'].forEach((id) => { $(id).value = ''; });
  $('scan-quantity').value = '1';
  renderScanLines();
  setMessage('Rapid scan cleared.');
  $('product-input').focus();
}
async function confirmDraft() {
  if (!currentReview) return;
  $('confirm-draft').disabled = true;
  setReviewMessage(navigator.onLine ? 'Creating the Nut King draft…' : 'Saving safely on this device…');
  if (navigator.onLine) {
    try {
      const response = await fetch('/nutking/api/create-draft', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(currentReview)});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The draft could not be created.');
      window.location.href = data.web_url;
      return;
    } catch (error) {
      if (error instanceof TypeError) {
        await dbPut(currentReview);
        setReviewMessage('Connection was lost. The draft was saved safely on this device.', false);
        clearScan();
        setTimeout(() => { closeReview(); setTab('queue'); renderAll(); }, 650);
      } else setReviewMessage(error.message || 'The draft could not be created.', true);
    }
  } else {
    await dbPut(currentReview);
    setReviewMessage('Offline draft saved. It will synchronize to Odoo as a Draft operation.', false);
    clearScan();
    setTimeout(() => { closeReview(); setTab('queue'); renderAll(); }, 650);
  }
  $('confirm-draft').disabled = false;
}

async function sync() {
  const items = await dbAll();
  if (!items.length) { setMessage('Nothing is waiting to synchronize.'); return; }
  if (!navigator.onLine) { setMessage('Still offline. Drafts remain safe on this device.', true); return; }
  setMessage(`Synchronizing ${items.length} draft(s)…`);
  try {
    const response = await fetch('/nutking/api/sync', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({transactions: items})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Synchronization was rejected.');
    let errorCount = 0;
    for (const result of data.results || []) {
      if (result.status === 'processed') {
        await dbDelete(result.external_uid);
        addHistory({external_uid: result.external_uid, operation: result.operation, web_url: result.web_url, synced_at: new Date().toISOString()});
      } else if (result.status === 'error') {
        errorCount += 1;
        const item = items.find((entry) => entry.external_uid === result.external_uid);
        if (item) { item.sync_error = result.error || 'Synchronization error'; await dbPut(item); }
      }
    }
    setMessage(errorCount ? `${errorCount} draft(s) need review. They remain on this device.` : 'Synchronization completed. Draft operations are ready for review in Odoo.', errorCount > 0);
    await loadBootstrap(true);
    await renderAll();
  } catch (error) { setMessage(error.message || 'Synchronization failed. Drafts remain on this device.', true); }
}

async function renderStockPanels() {
  const balances = await projectedBalances();
  renderStock('raw', balances.raw, $('raw-search').value);
  renderStock('finished', balances.finished, $('finished-search').value);
}
function renderStock(kind, balanceMap, searchTerm) {
  const expected = kind === 'raw' ? 'raw_material' : 'finished_good';
  const term = String(searchTerm || '').toLowerCase();
  const products = bootstrap.products.filter((product) => product.type === expected && (!term || `${product.name} ${product.barcode} ${product.default_code}`.toLowerCase().includes(term)));
  const low = products.filter((product) => product.minimum_qty > 0 && number(balanceMap[String(product.id)]) <= product.minimum_qty).length;
  const totalQty = products.reduce((sum, product) => sum + number(balanceMap[String(product.id)]), 0);
  $(`${kind}-kpis`).innerHTML = `<div class="kpi"><span>Products</span><strong>${products.length}</strong></div><div class="kpi"><span>Total Quantity</span><strong>${escapeHtml(fmt(totalQty))}</strong></div><div class="kpi"><span>Low Stock</span><strong>${low}</strong></div><div class="kpi"><span>Last Sync</span><strong style="font-size:14px">${escapeHtml(dateText(bootstrap.server_time))}</strong></div>`;
  $(`${kind}-stock`).innerHTML = `<table><thead><tr><th>Product</th><th>Barcode</th><th>Internal Ref.</th><th>Pack Size</th><th>Quantity</th><th>Unit</th><th>Minimum</th></tr></thead><tbody>${products.length ? products.map((product) => { const qty = number(balanceMap[String(product.id)]); const lowClass = product.minimum_qty > 0 && qty <= product.minimum_qty ? ' style="color:#ef1b23"' : ''; return `<tr><td><strong>${escapeHtml(product.name)}</strong></td><td>${escapeHtml(product.barcode || '—')}</td><td>${escapeHtml(product.default_code || '—')}</td><td>${escapeHtml(product.pack_size || '—')}</td><td class="qty"${lowClass}>${escapeHtml(fmt(qty))}</td><td>${escapeHtml(product.uom)}</td><td>${escapeHtml(fmt(product.minimum_qty))}</td></tr>`; }).join('') : '<tr><td colspan="7" class="empty">No matching products.</td></tr>'}</tbody></table>`;
}
function renderTrips() {
  $('trips-list').innerHTML = bootstrap.trips.length ? bootstrap.trips.map((trip) => `<div class="list-item"><strong>${escapeHtml(trip.name)} · ${escapeHtml(trip.route_name || 'No route')}</strong><div class="small">${escapeHtml(trip.truck_name)} · ${escapeHtml(dateText(trip.planned_departure))} · <span class="badge ${escapeHtml(trip.state)}">${escapeHtml(trip.state.replaceAll('_', ' '))}</span></div></div>`).join('') : '<p class="small">No active distribution trips were downloaded.</p>';
  $('trucks-list').innerHTML = bootstrap.trucks.length ? bootstrap.trucks.map((truck) => `<div class="list-item"><strong>${escapeHtml(truck.name)} · ${escapeHtml(truck.registration || '')}</strong><div class="small">Barcode: ${escapeHtml(truck.barcode || 'Not set')} · <span class="badge">${escapeHtml(truck.status.replaceAll('_', ' '))}</span></div></div>`).join('') : '<p class="small">No active trucks were downloaded.</p>';
}
function renderCustomers() {
  const term = $('customer-search').value.toLowerCase();
  const customers = bootstrap.customers.filter((customer) => !term || `${customer.name} ${customer.code} ${customer.route} ${customer.phone}`.toLowerCase().includes(term));
  $('customer-list').innerHTML = customers.length ? customers.map((customer) => `<div class="list-item"><strong>${escapeHtml(customer.name)}${customer.code ? ` · ${escapeHtml(customer.code)}` : ''}</strong><div class="small">${escapeHtml(customer.route || 'No route')} · ${escapeHtml(customer.phone || 'No phone')}</div><div class="small">${escapeHtml(customer.address || '')}</div></div>`).join('') : '<p class="small">No matching customers.</p>';
  $('supplier-list').innerHTML = bootstrap.suppliers.length ? bootstrap.suppliers.map((supplier) => `<div class="list-item"><strong>${escapeHtml(supplier.name)}${supplier.code ? ` · ${escapeHtml(supplier.code)}` : ''}</strong><div class="small">${escapeHtml(supplier.phone || 'No phone')}</div></div>`).join('') : '<p class="small">No raw-material suppliers were downloaded.</p>';
}
async function renderQueue() {
  const items = await dbAll();
  $('pending').textContent = `${items.length} waiting`;
  $('queue-list').innerHTML = items.length ? items.map((item) => `<div class="queue-item"><strong>${escapeHtml(OP_LABELS[item.operation_type] || item.operation_type)}</strong><div>${item.lines.map((line) => `${escapeHtml(productById(line.product_id)?.name || line.product_id)} × ${escapeHtml(fmt(line.quantity))}`).join('<br>')}</div><div class="small">${escapeHtml(dateText(item.created_on_device))} · ${escapeHtml(item.external_uid)}</div>${item.sync_error ? `<div class="small error">${escapeHtml(item.sync_error)}</div>` : ''}<div class="queue-actions"><button class="danger" data-delete-queue="${escapeHtml(item.external_uid)}">Delete Local Draft</button></div></div>`).join('') : '<p class="small">Nothing is waiting to synchronize.</p>';
  document.querySelectorAll('[data-delete-queue]').forEach((button) => button.addEventListener('click', async () => { if (window.confirm('Delete this unsynchronized local draft?')) { await dbDelete(button.dataset.deleteQueue); await renderAll(); } }));
  const history = historyItems();
  $('sync-history').innerHTML = history.length ? history.map((item) => `<div class="list-item"><strong>${escapeHtml(item.operation || 'Synchronized Draft')}</strong><div class="small">${escapeHtml(dateText(item.synced_at))}</div>${item.web_url ? `<div style="margin-top:7px"><a href="${escapeHtml(item.web_url)}">Open Draft in Odoo</a></div>` : ''}</div>`).join('') : '<p class="small">No drafts synchronized from this device yet.</p>';
  $('recent-operations').innerHTML = bootstrap.recent_operations.length ? bootstrap.recent_operations.map((operation) => `<div class="list-item"><strong><a href="${escapeHtml(operation.url)}">${escapeHtml(operation.name)} · ${escapeHtml(operation.operation_label)}</a></strong><div class="small">${escapeHtml(dateText(operation.date))} · ${escapeHtml(fmt(operation.quantity))} · <span class="badge ${escapeHtml(operation.state)}">${escapeHtml(operation.state)}</span>${operation.partner ? ` · ${escapeHtml(operation.partner)}` : ''}${operation.truck ? ` · ${escapeHtml(operation.truck)}` : ''}</div></div>`).join('') : '<p class="small">No recent server operations were downloaded.</p>';
}
async function renderAll() {
  await renderQueue();
  await renderStockPanels();
  renderTrips();
  renderCustomers();
}

async function loadBootstrap(force = false) {
  let loadedOnline = false;
  if (navigator.onLine || force) {
    try {
      const response = await fetch('/nutking/api/bootstrap', {cache: 'no-store'});
      if (!response.ok) throw new Error('Unable to load current Nut King data.');
      bootstrap = await response.json();
      localStorage.setItem(CACHE_KEY, JSON.stringify(bootstrap));
      loadedOnline = true;
    } catch (error) {
      try { bootstrap = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { bootstrap = {}; }
    }
  } else {
    try { bootstrap = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { bootstrap = {}; }
  }
  bootstrap = Object.assign({user:{},capabilities:[],balances:{raw:{},finished:{},trucks:{}},products:[],trucks:[],customers:[],suppliers:[],trips:[],reasons:[],recent_operations:[],server_time:''}, bootstrap || {});
  bootstrap.balances ||= {raw:{},finished:{},trucks:{}};
  $('welcome').textContent = bootstrap.user?.name ? `Signed in as ${bootstrap.user.name}` : 'Using the last downloaded workspace.';
  $('sync-status').textContent = `Last sync: ${bootstrap.server_time ? dateText(bootstrap.server_time) : 'not yet'}`;
  $('truck').innerHTML = '<option value="">Not applicable</option>' + bootstrap.trucks.map((item) => option(item.id, `${item.name}${item.registration ? ` · ${item.registration}` : ''}`)).join('');
  $('trip').innerHTML = '<option value="">Not applicable</option>' + bootstrap.trips.map((item) => option(item.id, `${item.name} · ${item.truck_name} · ${item.route_name || 'No route'}`)).join('');
  populateOperationOptions();
  if (!allowedOperations().length) {
    setMessage('This account has no Nut King stock-operation role. Ask the administrator to assign the correct role.', true);
    $('review-button').disabled = true;
  }
  if (loadedOnline) setMessage('Current Nut King data downloaded.');
}

function bindEvents() {
  document.querySelectorAll('.nav button').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));
  document.querySelectorAll('[data-operation]').forEach((button) => button.addEventListener('click', () => chooseOperation(button.dataset.operation)));
  $('operation').addEventListener('change', updateDependentFields);
  $('trip').addEventListener('change', updateTripTruck);
  $('add-line').addEventListener('click', addLine);
  $('product-input').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); addLine(); } });
  $('review-button').addEventListener('click', showReview);
  $('clear-button').addEventListener('click', clearScan);
  $('sync-button').addEventListener('click', sync);
  $('queue-sync').addEventListener('click', sync);
  $('review-close').addEventListener('click', closeReview);
  $('review-back').addEventListener('click', closeReview);
  $('confirm-draft').addEventListener('click', confirmDraft);
  $('review-overlay').addEventListener('click', (event) => { if (event.target === $('review-overlay')) closeReview(); });
  $('raw-search').addEventListener('input', renderStockPanels);
  $('finished-search').addEventListener('input', renderStockPanels);
  $('customer-search').addEventListener('input', renderCustomers);
  window.addEventListener('online', async () => { setConnection(); await sync(); });
  window.addEventListener('offline', setConnection);
}

(async () => {
  setConnection();
  bindEvents();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/nutking/sw.js', {scope: '/nutking/'});
  await loadBootstrap();
  await renderAll();
  const requested = new URLSearchParams(window.location.search).get('operation_type');
  if (requested) chooseOperation(requested);
  if (navigator.onLine) await sync();
})();
