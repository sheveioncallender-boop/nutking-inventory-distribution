const DB_NAME = 'nutking-offline-v2';
const STORE = 'transactions';
let bootstrap = {products: [], trucks: [], customers: [], suppliers: [], reasons: [], trips: [], capabilities: [], balances: {raw: {}, finished: {}, trucks: {}}};
const $ = (id) => document.getElementById(id);
const RAW_OPERATIONS = new Set(['raw_receipt', 'raw_issue', 'raw_supplier_return', 'raw_damage', 'raw_expired', 'raw_adjustment']);
const SUPPLIER_OPERATIONS = new Set(['raw_receipt', 'raw_supplier_return']);
const CUSTOMER_OPERATIONS = new Set(['customer_delivery', 'customer_return']);
const TRUCK_OPERATIONS = new Set(['truck_load', 'customer_delivery', 'truck_return', 'finished_damage']);
const TRIP_OPERATIONS = new Set(['truck_load', 'customer_delivery', 'truck_return', 'finished_damage']);
const REQUIRED_TRIP = new Set(['truck_load', 'customer_delivery', 'truck_return']);
const REQUIRED_TRUCK = new Set(['truck_load', 'customer_delivery', 'truck_return']);
const REQUIRED_PARTNER = new Set(['raw_receipt', 'raw_supplier_return', 'customer_delivery', 'customer_return']);
const REQUIRED_REASON = new Set(['raw_issue', 'raw_supplier_return', 'raw_damage', 'raw_expired', 'truck_return', 'customer_return', 'finished_damage']);

function uid() { return `NK-OFF-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
function openDB() { return new Promise((resolve, reject) => { const request = indexedDB.open(DB_NAME, 1); request.onupgradeneeded = () => request.result.createObjectStore(STORE, {keyPath: 'external_uid'}); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function all() { const db = await openDB(); return new Promise((resolve, reject) => { const request = db.transaction(STORE).objectStore(STORE).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function put(value) { const db = await openDB(); return new Promise((resolve, reject) => { const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); }
async function del(key) { const db = await openDB(); return new Promise((resolve, reject) => { const request = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); }

function adjustBalance(snapshot, transaction) {
  const productId = String(transaction.lines[0].product_id);
  const quantity = Number(transaction.lines[0].quantity);
  const truckId = String(transaction.truck_id || '');
  const ensureTruck = () => { snapshot.trucks[truckId] ||= {}; snapshot.trucks[truckId][productId] ||= 0; };
  snapshot.raw[productId] ||= 0; snapshot.finished[productId] ||= 0;
  if (transaction.operation_type === 'raw_receipt') snapshot.raw[productId] += quantity;
  if (['raw_issue', 'raw_supplier_return', 'raw_damage', 'raw_expired'].includes(transaction.operation_type)) snapshot.raw[productId] -= quantity;
  if (transaction.operation_type === 'finished_add') snapshot.finished[productId] += quantity;
  if (transaction.operation_type === 'truck_load') { snapshot.finished[productId] -= quantity; ensureTruck(); snapshot.trucks[truckId][productId] += quantity; }
  if (['customer_delivery', 'truck_return'].includes(transaction.operation_type)) { ensureTruck(); snapshot.trucks[truckId][productId] -= quantity; if (transaction.operation_type === 'truck_return') snapshot.finished[productId] += quantity; }
  if (transaction.operation_type === 'finished_damage') { if (transaction.truck_id) { ensureTruck(); snapshot.trucks[truckId][productId] -= quantity; } else snapshot.finished[productId] -= quantity; }
}
async function projectedBalances() {
  const base = JSON.parse(JSON.stringify(bootstrap.balances || {raw: {}, finished: {}, trucks: {}}));
  base.raw ||= {}; base.finished ||= {}; base.trucks ||= {};
  for (const transaction of await all()) adjustBalance(base, transaction);
  return base;
}
async function availableFor(operationType, productId, truckId) {
  const balances = await projectedBalances();
  const key = String(productId);
  if (['raw_issue', 'raw_supplier_return', 'raw_damage', 'raw_expired'].includes(operationType)) return Number(balances.raw[key] || 0);
  if (operationType === 'truck_load' || (operationType === 'finished_damage' && !truckId)) return Number(balances.finished[key] || 0);
  if (['customer_delivery', 'truck_return'].includes(operationType) || (operationType === 'finished_damage' && truckId)) return Number((balances.trucks[String(truckId)] || {})[key] || 0);
  return null;
}

function setMessage(text, error = false) { $('message').textContent = text; $('message').className = `small message${error ? ' error' : ''}`; }
function setConnection() { const online = navigator.onLine; $('connection').textContent = online ? 'Online' : 'Offline — transactions are saved on this device'; $('connection').className = online ? 'online' : 'offline'; }
async function render() { const items = await all(); $('pending').textContent = `${items.length} waiting`; $('queue').innerHTML = items.length ? items.map((item) => `<div class="queue-item"><strong>${escapeHtml(item.operation_type.replaceAll('_', ' '))}</strong><div>${escapeHtml(item.product_name)} × ${escapeHtml(item.lines[0].quantity)}</div><div class="small">${escapeHtml(new Date(item.created_on_device).toLocaleString())} · ${escapeHtml(item.external_uid)}</div></div>`).join('') : '<p class="small">Nothing waiting to synchronize.</p>'; }
function option(value, label) { return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`; }
function updateDependentFields() {
  const operation = $('operation').value;
  const partners = SUPPLIER_OPERATIONS.has(operation) ? bootstrap.suppliers : CUSTOMER_OPERATIONS.has(operation) ? bootstrap.customers : [];
  $('partner').innerHTML = '<option value="">Not applicable</option>' + partners.map((item) => option(item.id, item.name)).join('');
  $('partner').disabled = partners.length === 0;
  $('truck').disabled = !TRUCK_OPERATIONS.has(operation);
  $('trip').disabled = !TRIP_OPERATIONS.has(operation);
  const reasonArea = RAW_OPERATIONS.has(operation) ? 'raw' : ['truck_load', 'customer_delivery', 'truck_return', 'customer_return'].includes(operation) ? 'distribution' : 'finished';
  const reasons = bootstrap.reasons.filter((reason) => reason.applies_to === 'all' || reason.applies_to === reasonArea);
  $('reason').innerHTML = '<option value="">Not applicable</option>' + reasons.map((item) => option(item.id, item.name)).join('');
}
function updateTrip() { const trip = bootstrap.trips.find((item) => item.id === Number($('trip').value)); if (trip) $('truck').value = String(trip.truck_id); }
async function loadBootstrap() {
  try { const response = await fetch('/nutking/api/bootstrap', {cache: 'no-store'}); if (!response.ok) throw new Error('Unable to load current Nut King data'); bootstrap = await response.json(); localStorage.setItem('nk-bootstrap-v2', JSON.stringify(bootstrap)); }
  catch (error) { bootstrap = JSON.parse(localStorage.getItem('nk-bootstrap-v2') || '{"products":[],"trucks":[],"customers":[],"suppliers":[],"reasons":[],"trips":[],"capabilities":[],"balances":{"raw":{},"finished":{},"trucks":{}}}'); }
  const allowed = new Set(bootstrap.capabilities || []);
  for (const item of [...$('operation').options]) if (!allowed.has(item.value)) item.remove();
  if (!$('operation').options.length) { setMessage('This account has no offline stock-operation role. Ask a Nut King administrator to assign the correct role.', true); $('save').disabled = true; }
  $('truck').innerHTML = '<option value="">Not applicable</option>' + bootstrap.trucks.map((item) => option(item.id, item.name)).join('');
  $('trip').innerHTML = '<option value="">Not applicable</option>' + bootstrap.trips.map((item) => option(item.id, `${item.name} · ${item.truck_name} · ${item.route_name}`)).join('');
  updateDependentFields();
}
async function save() {
  const code = $('barcode').value.trim();
  const product = bootstrap.products.find((item) => item.barcode === code);
  if (!product) { setMessage('Barcode not found in the downloaded Nut King product list.', true); return; }
  const operationType = $('operation').value;
  const expectedType = RAW_OPERATIONS.has(operationType) ? 'raw_material' : 'finished_good';
  if (product.type !== expectedType) { setMessage(`This operation requires a ${expectedType.replace('_', ' ')} product.`, true); return; }
  const quantity = Number($('quantity').value);
  if (!(quantity > 0)) { setMessage('Enter a quantity greater than zero.', true); return; }
  if (REQUIRED_TRIP.has(operationType) && !$('trip').value) { setMessage('Select the distribution trip for this operation.', true); return; }
  if (REQUIRED_TRUCK.has(operationType) && !$('truck').value) { setMessage('Select the assigned truck for this operation.', true); return; }
  if (REQUIRED_PARTNER.has(operationType) && !$('partner').value) { setMessage('Select the customer or supplier for this operation.', true); return; }
  if (REQUIRED_REASON.has(operationType) && !$('reason').value) { setMessage('Select a movement reason for this operation.', true); return; }
  const selectedReason = bootstrap.reasons.find((item) => item.id === Number($('reason').value));
  if (selectedReason?.requires_note && !$('notes').value.trim()) { setMessage('The selected reason requires an explanatory note.', true); return; }
  const projectedAvailable = await availableFor(operationType, product.id, Number($('truck').value) || false);
  if (projectedAvailable !== null && quantity > projectedAvailable) {
    setMessage(`Only ${projectedAvailable} is available based on the last sync and this device's waiting scans.`, true); return;
  }
  const transaction = {
    external_uid: uid(), device_name: navigator.userAgent.slice(0, 120), created_on_device: new Date().toISOString(), operation_type: operationType,
    trip_id: Number($('trip').value) || false, truck_id: Number($('truck').value) || false, partner_id: Number($('partner').value) || false,
    reason_id: Number($('reason').value) || false, notes: $('notes').value, product_name: product.name,
    lines: [{product_id: product.id, quantity, lot_reference: $('lot').value || false}],
  };
  await put(transaction); $('barcode').value = ''; $('lot').value = ''; setMessage('Saved safely on this device.'); await render(); if (navigator.onLine) await sync();
}
async function sync() {
  const items = await all();
  if (!items.length) { setMessage('Nothing is waiting to synchronize.'); return; }
  if (!navigator.onLine) { setMessage('Still offline. Transactions remain safe on this device.'); return; }
  try {
    const response = await fetch('/nutking/api/sync', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({transactions: items})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Synchronization was rejected');
    for (const result of data.results || []) if (result.status === 'processed') await del(result.external_uid);
    const errors = (data.results || []).filter((item) => item.status === 'error');
    setMessage(errors.length ? `${errors.length} transaction(s) need supervisor review. They remain on this device.` : 'Synchronization completed.', errors.length > 0);
    if (!(data.results || []).some((item) => item.status === 'error')) await loadBootstrap();
    await render();
  } catch (error) { setMessage('Synchronization failed. Transactions remain on this device.', true); }
}
window.addEventListener('online', () => { setConnection(); sync(); });
window.addEventListener('offline', setConnection);
$('save').addEventListener('click', save); $('sync').addEventListener('click', sync); $('operation').addEventListener('change', updateDependentFields); $('trip').addEventListener('change', updateTrip); $('barcode').addEventListener('keydown', (event) => { if (event.key === 'Enter') save(); });
(async () => { setConnection(); if ('serviceWorker' in navigator) navigator.serviceWorker.register('/nutking/sw.js', {scope: '/nutking/'}); await loadBootstrap(); await render(); if (navigator.onLine) await sync(); })();
