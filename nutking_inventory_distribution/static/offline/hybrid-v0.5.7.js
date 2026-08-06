'use strict';

/* Nut King v0.5.7 hybrid layer.
 *
 * The base workspace still manages caching, trips, physical inventory and
 * device storage. This layer replaces the four main warehouse stock actions
 * with Odoo-native stock.picking transfers and mirrors Odoo's natural states:
 * Draft → Waiting → Ready → Done.
 */

const NATIVE_KINDS = new Set(['native_transfer', 'native_transfer_event', 'native_return', 'contact_create']);
const NATIVE_OPERATION_TYPES = new Set(['raw_receipt', 'raw_issue', 'finished_add', 'finished_issue', 'truck_load', 'customer_delivery', 'truck_return']);
const nativeBase = {
  emptySnapshot,
  refreshSnapshot,
  syncQueue,
  projectedBalances,
  projectedOnHand,
  localOperationRows,
  renderOperations,
  renderStock,
  renderContacts,
  renderReview,
  openLocalOperation,
  openServerOperation,
  saveReviewedDraft,
  operationAction,
  populateScanFields,
  buildScanDraft,
  showScanReview,
  renderSyncCentre,
  bindEvents,
};

OP_LABELS.finished_issue = 'Issue Finished Goods to Truck';
OP_CONFIG.raw_issue = { productType: 'raw_material', stockSource: 'raw' };
OP_CONFIG.finished_issue = {
  productType: 'finished_good', partner: 'customer', partnerOptional: true,
  truckRequired: true, stockSource: 'finished',
};
ROUTE_INFO.operations = ['Stock Transfers', 'Odoo-native transfers, reservations, detailed operations, returns, and printing'];
ROUTE_INFO.contacts = ['Contacts & Trucks', 'Odoo customers, companies, suppliers, trucks, and staff'];

emptySnapshot = function hybridEmptySnapshot() {
  const snapshot = nativeBase.emptySnapshot();
  snapshot.native_transfers = [];
  snapshot.product_details = [];
  snapshot.stock_by_location = [];
  snapshot.hybrid_locations = [];
  return snapshot;
};

function hybridLocalCustomers() {
  return state.queue
    .filter((item) => item.kind === 'contact_create' && item.sync_state !== 'error')
    .map((item) => ({
      id: `local:${item.external_uid}`,
      local_uid: item.external_uid,
      local: true,
      name: item.name,
      code: item.customer_code || '',
      phone: item.phone || item.mobile || '',
      email: item.email || '',
      route: item.route || '',
      address: [item.street, item.street2, item.city].filter(Boolean).join(', '),
      notes: item.notes || '',
      company_type: item.company_type || 'company',
    }));
}

function hybridCustomers() {
  const byName = new Map();
  for (const customer of [...hybridLocalCustomers(), ...(state.snapshot.customers || [])]) {
    byName.set(`${customer.local ? 'local' : 'server'}:${customer.id}`, customer);
  }
  return [...byName.values()];
}


const entityAutocomplete = {
  partner: { results: [], activeIndex: -1 },
  truck: { results: [], activeIndex: -1 },
};

function hybridPartnerOptions() {
  const config = OP_CONFIG[state.scan.operationType] || {};
  if (config.partner === 'supplier') return state.snapshot.suppliers || [];
  if (config.partner === 'customer') return hybridCustomers();
  return [];
}

function hybridEntityInput(kind) {
  return $(kind === 'partner' ? 'scan-partner-search' : 'scan-truck-search');
}

function hybridEntityMenu(kind) {
  return $(kind === 'partner' ? 'scan-partner-suggestions' : 'scan-truck-suggestions');
}

function hybridEntityHidden(kind) {
  return $(kind === 'partner' ? 'scan-partner' : 'scan-truck');
}

function hybridEntityOptions(kind) {
  return kind === 'partner' ? hybridPartnerOptions() : (state.snapshot.trucks || []);
}

function hybridEntityValue(kind, item) {
  if (kind === 'partner' && item.local) return `local:${item.local_uid}`;
  return String(item.id || '');
}

function hybridEntityLabel(kind, item) {
  if (!item) return '';
  if (kind === 'truck') return [item.name, item.registration].filter(Boolean).join(' · ');
  return [item.name, item.code].filter(Boolean).join(' · ');
}

function hybridEntitySearchText(kind, item) {
  if (kind === 'truck') return [item.name, item.registration, item.make, item.model, item.driver].join(' ').toLowerCase();
  return [item.name, item.code, item.phone, item.email, item.route, item.address].join(' ').toLowerCase();
}

function hybridCloseEntityAutocomplete(kind) {
  const input = hybridEntityInput(kind);
  const menu = hybridEntityMenu(kind);
  if (!input || !menu) return;
  entityAutocomplete[kind] = { results: [], activeIndex: -1 };
  menu.classList.remove('open');
  menu.innerHTML = '';
  input.setAttribute('aria-expanded', 'false');
}

function hybridRenderEntityAutocomplete(kind) {
  const input = hybridEntityInput(kind);
  const menu = hybridEntityMenu(kind);
  if (!input || !menu || input.closest('.nk-field')?.hidden) return;
  const query = input.value.trim().toLowerCase();
  const results = hybridEntityOptions(kind)
    .filter((item) => !query || hybridEntitySearchText(kind, item).includes(query))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    .slice(0, 15);
  entityAutocomplete[kind] = { results, activeIndex: results.length ? 0 : -1 };
  if (!results.length) {
    menu.innerHTML = `<div class="nk-autocomplete-empty">No matching ${kind === 'truck' ? 'truck' : 'contact'} was found in the synchronized data.</div>`;
  } else {
    menu.innerHTML = results.map((item, index) => {
      const secondary = kind === 'truck'
        ? [item.registration, item.driver].filter(Boolean).join(' · ')
        : [item.code, item.phone, item.route].filter(Boolean).join(' · ');
      return `<button type="button" class="nk-autocomplete-item ${index === 0 ? 'active' : ''}" role="option" aria-selected="${index === 0 ? 'true' : 'false'}" data-value="${html(hybridEntityValue(kind, item))}"><span><strong>${html(item.name || '')}</strong><small>${html(secondary || (kind === 'truck' ? 'Truck' : 'Odoo Contact'))}</small></span></button>`;
    }).join('');
  }
  menu.classList.add('open');
  input.setAttribute('aria-expanded', 'true');
}

function hybridSetEntityActive(kind, nextIndex) {
  const data = entityAutocomplete[kind];
  if (!data.results.length) return;
  data.activeIndex = (nextIndex + data.results.length) % data.results.length;
  all('.nk-autocomplete-item', hybridEntityMenu(kind)).forEach((item, index) => {
    const active = index === data.activeIndex;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', active ? 'true' : 'false');
    if (active) item.scrollIntoView({ block: 'nearest' });
  });
}

function hybridSelectEntity(kind, item) {
  if (!item) return;
  const hidden = hybridEntityHidden(kind);
  const input = hybridEntityInput(kind);
  const value = hybridEntityValue(kind, item);
  hidden.value = value;
  input.value = hybridEntityLabel(kind, item);
  input.dataset.selectedValue = value;
  hybridCloseEntityAutocomplete(kind);
  hidden.dispatchEvent(new Event('change', { bubbles: true }));
}

function hybridSyncEntitySearchFromHidden(kind) {
  const hidden = hybridEntityHidden(kind);
  const input = hybridEntityInput(kind);
  if (!hidden || !input) return;
  const selected = String(hidden.value || '');
  const item = hybridEntityOptions(kind).find((candidate) => hybridEntityValue(kind, candidate) === selected);
  input.value = item ? hybridEntityLabel(kind, item) : '';
  if (item) input.dataset.selectedValue = selected;
  else delete input.dataset.selectedValue;
}

function hybridBindEntityAutocomplete(kind) {
  const input = hybridEntityInput(kind);
  const menu = hybridEntityMenu(kind);
  if (!input || !menu || input.dataset.bound === '1') return;
  input.dataset.bound = '1';
  input.addEventListener('input', () => {
    const hidden = hybridEntityHidden(kind);
    hidden.value = '';
    delete input.dataset.selectedValue;
    hybridRenderEntityAutocomplete(kind);
  });
  input.addEventListener('focus', () => hybridRenderEntityAutocomplete(kind));
  input.addEventListener('keydown', (event) => {
    const data = entityAutocomplete[kind];
    const open = menu.classList.contains('open');
    if (event.key === 'ArrowDown' && open && data.results.length) {
      event.preventDefault(); hybridSetEntityActive(kind, data.activeIndex + 1); return;
    }
    if (event.key === 'ArrowUp' && open && data.results.length) {
      event.preventDefault(); hybridSetEntityActive(kind, data.activeIndex - 1); return;
    }
    if (event.key === 'Escape') { hybridCloseEntityAutocomplete(kind); return; }
    if (event.key === 'Enter' && open && data.results.length) {
      event.preventDefault(); hybridSelectEntity(kind, data.results[Math.max(0, data.activeIndex)]);
    }
  });
  input.addEventListener('blur', () => window.setTimeout(() => hybridCloseEntityAutocomplete(kind), 160));
  menu.addEventListener('mousedown', (event) => {
    const button = event.target.closest('.nk-autocomplete-item');
    if (!button) return;
    event.preventDefault();
    const item = hybridEntityOptions(kind).find((candidate) => hybridEntityValue(kind, candidate) === button.dataset.value);
    hybridSelectEntity(kind, item);
  });
}

partnerById = function hybridPartnerById(value) {
  if (String(value || '').startsWith('local:')) {
    const uidValue = String(value).slice(6);
    return hybridLocalCustomers().find((item) => item.local_uid === uidValue);
  }
  return [...(state.snapshot.customers || []), ...(state.snapshot.suppliers || [])]
    .find((item) => item.id === Number(value));
};

function hybridProductDetail(productId) {
  return (state.snapshot.product_details || []).find((item) => item.product_id === Number(productId)) || null;
}

function hybridTransferById(id) {
  return (state.snapshot.native_transfers || []).find((item) => item.id === Number(id)) || null;
}

function hybridNativeStageFromState(stateValue) {
  if (stateValue === 'draft') return 'draft';
  if (stateValue === 'assigned') return 'ready';
  if (stateValue === 'done') return 'done';
  if (stateValue === 'cancel') return 'cancel';
  return 'waiting';
}

function hybridCachedAvailability(item) {
  const truckId = item.truck_id || false;
  return (item.lines || []).every((line) => {
    const available = availableFor(item.operation_type, line.product_id, truckId);
    return available === null || number(available) + 1e-8 >= number(line.quantity);
  });
}

function hybridLocalNativeStage(item) {
  if (item.native_stage) return item.native_stage;
  let stage = item.base_native_stage || 'draft';
  const actions = item.kind === 'native_transfer'
    ? (item.actions || [])
    : item.kind === 'native_return'
      ? ['return']
      : [item.action].filter(Boolean);
  for (const action of actions) {
    if (action === 'mark_todo') stage = 'waiting';
    if (action === 'check_availability') stage = hybridCachedAvailability(item) ? 'ready' : 'waiting';
    if (action === 'validate') stage = 'done';
    if (action === 'cancel') stage = 'cancel';
  }
  return stage;
}

function hybridNativeLabel(stage) {
  return ({ draft: 'Draft', waiting: 'Waiting', ready: 'Ready', done: 'Done', cancel: 'Cancelled' })[stage] || stage;
}

function hybridStatusFlow(stage) {
  const steps = ['draft', 'waiting', 'ready', 'done'];
  const currentIndex = steps.indexOf(stage);
  return `<div class="nk-native-statusbar">${steps.map((step, index) => {
    const classes = [step === stage ? 'active' : '', currentIndex >= 0 && index < currentIndex ? 'passed' : ''].filter(Boolean).join(' ');
    return `<span class="${classes}">${hybridNativeLabel(step)}</span>`;
  }).join('')}</div>${stage === 'cancel' ? '<div class="nk-native-cancelled">Cancelled</div>' : ''}`;
}

function hybridLocationIsWithin(locationId, parentId) {
  const target = Number(parentId || 0);
  let current = Number(locationId || 0);
  if (!target || !current) return false;
  const locations = new Map((state.snapshot.hybrid_locations || []).map((location) => [Number(location.id), location]));
  const visited = new Set();
  while (current && !visited.has(current)) {
    if (current === target) return true;
    visited.add(current);
    current = Number(locations.get(current)?.parent_id || 0);
  }
  return false;
}

function hybridSourceLocationId(operation) {
  if (operation.source_id) return Number(operation.source_id);
  const type = operation.operation_type;
  if (type === 'raw_issue') return Number(state.snapshot.locations?.raw?.id || 0);
  if (['finished_issue', 'truck_load'].includes(type)) return Number(state.snapshot.locations?.finished?.id || 0);
  if (['customer_delivery', 'truck_return'].includes(type)) return Number(truckById(operation.truck_id)?.stock_location_id || 0);
  return 0;
}

function hybridApplyProjection(balance, item, onHand = false) {
  const stage = hybridLocalNativeStage(item);
  if (stage !== 'done') return;
  const type = item.operation_type;
  const lines = item.lines || item.moves || [];
  const truckKey = String(item.truck_id || '');
  if (truckKey && !balance.trucks[truckKey]) balance.trucks[truckKey] = {};
  for (const line of lines) {
    const productKey = String(line.product_id);
    const quantity = number(line.quantity ?? line.demand);
    if (type === 'raw_receipt') balance.raw[productKey] = number(balance.raw[productKey]) + quantity;
    if (type === 'raw_issue') balance.raw[productKey] = number(balance.raw[productKey]) - quantity;
    if (type === 'finished_add') balance.finished[productKey] = number(balance.finished[productKey]) + quantity;
    if (['finished_issue', 'truck_load'].includes(type)) {
      balance.finished[productKey] = number(balance.finished[productKey]) - quantity;
      if (truckKey) balance.trucks[truckKey][productKey] = number(balance.trucks[truckKey][productKey]) + quantity;
    }
    if (type === 'customer_delivery' && truckKey) balance.trucks[truckKey][productKey] = number(balance.trucks[truckKey][productKey]) - quantity;
    if (type === 'truck_return' && truckKey) {
      balance.trucks[truckKey][productKey] = number(balance.trucks[truckKey][productKey]) - quantity;
      balance.finished[productKey] = number(balance.finished[productKey]) + quantity;
    }
  }
}

projectedBalances = function hybridProjectedBalances() {
  const result = nativeBase.projectedBalances();
  for (const item of state.queue.filter((entry) => NATIVE_KINDS.has(entry.kind) && entry.sync_state !== 'error')) {
    if (item.kind !== 'contact_create') hybridApplyProjection(result, item, false);
  }
  return result;
};

projectedOnHand = function hybridProjectedOnHand() {
  const result = nativeBase.projectedOnHand();
  for (const item of state.queue.filter((entry) => NATIVE_KINDS.has(entry.kind) && entry.sync_state !== 'error')) {
    if (item.kind !== 'contact_create') hybridApplyProjection(result, item, true);
  }
  return result;
};

refreshSnapshot = async function hybridRefreshSnapshot(showMessage = false) {
  try {
    const [baseData, hybridData] = await Promise.all([
      fetchJSON('/nutking/api/bootstrap'),
      fetchJSON('/nutking/api/hybrid-bootstrap'),
    ]);
    const data = { ...baseData, ...hybridData, app_version: APP_VERSION };
    await persistSnapshot(data);
    state.serverOnline = true;
    if (showMessage) toast('Nut King data synchronized successfully.', 'success');
    await addHistory('success', 'Downloaded Odoo transfers, product forecast, reservations, locations, and move history.', { kind: 'bootstrap' });
    renderAll();
    return true;
  } catch (error) {
    state.serverOnline = false;
    if (showMessage) toast(error.message, 'error');
    updateConnectionUI();
    return false;
  }
};

async function hybridProcessSyncResults(results) {
  for (const result of results || []) {
    const item = state.queue.find((entry) => entry.external_uid === result.external_uid);
    if (!item) continue;
    if (result.status === 'processed') {
      await queueDelete(result.external_uid);
      await addHistory('success', `${result.reference || 'Action'} synchronized successfully.`, { kind: result.kind, reference: result.reference });
    } else if (result.status === 'needs_action') {
      item.sync_state = 'attention';
      item.sync_notice = result.dialog?.includes('backorder') || result.dialog === 'stock.backorder.confirmation'
        ? 'Odoo requires a backorder decision before validation.'
        : 'Odoo requires an additional confirmation before this action can finish.';
      item.requires_dialog = result.dialog || 'odoo_action';
      item.picking_id = result.picking_id || item.picking_id;
      item.reference = result.reference || item.reference;
      await storePut('queue', item);
      await addHistory('attention', item.sync_notice, { kind: item.kind, reference: item.reference || '' });
    } else {
      item.sync_state = 'error';
      item.sync_error = result.error || 'The server rejected this action.';
      item.attempts = number(item.attempts) + 1;
      await storePut('queue', item);
      await addHistory('error', item.sync_error, { kind: item.kind, reference: item.reference || '' });
    }
  }
}

syncQueue = async function hybridSyncQueue(force = false) {
  if (state.syncing) return;
  state.syncing = true;
  updateConnectionUI();
  try {
    const online = await checkServer();
    if (!online) {
      if (force) toast('The Nut King server is not reachable. Your work remains safe on this device.', 'error');
      return;
    }
    const sendable = state.queue.filter((item) => item.sync_state === 'pending' || !item.sync_state);
    if (!sendable.length) {
      await refreshSnapshot(force);
      return;
    }
    const nativeItems = sendable.filter((item) => NATIVE_KINDS.has(item.kind));
    const legacyItems = sendable.filter((item) => !NATIVE_KINDS.has(item.kind));
    if (nativeItems.length) {
      const response = await fetchJSON('/nutking/api/native-sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_name: deviceId(), app_version: APP_VERSION, transactions: nativeItems }),
      }, 90000);
      await hybridProcessSyncResults(response.results);
    }
    if (legacyItems.length) {
      const response = await fetchJSON('/nutking/api/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_name: deviceId(), app_version: APP_VERSION, transactions: legacyItems }),
      }, 90000);
      await hybridProcessSyncResults(response.results);
    }
    state.queue = await storeAll('queue');
    await refreshSnapshot(false);
    const attention = state.queue.some((item) => ['error', 'attention'].includes(item.sync_state));
    toast(attention ? 'Synchronization completed with actions requiring review.' : 'All waiting Nut King actions synchronized.', attention ? 'error' : 'success');
  } catch (error) {
    state.serverOnline = false;
    await addHistory('error', `Synchronization failed: ${error.message}`, { kind: 'sync' });
    if (force) toast(error.message, 'error');
  } finally {
    state.syncing = false;
    updateConnectionUI();
    renderAll();
  }
};

populateScanFields = function hybridPopulateScanFields(operationType, preset = {}) {
  nativeBase.populateScanFields(operationType, preset);
  const config = OP_CONFIG[operationType] || {};

  if (config.partner) {
    const partners = config.partner === 'supplier' ? (state.snapshot.suppliers || []) : hybridCustomers();
    const partnerValue = preset.partner_external_uid ? `local:${preset.partner_external_uid}` : String(preset.partner_id || '');
    $('scan-partner').innerHTML = '<option value=""></option>' + partners.map((partner) => {
      const value = partner.local ? `local:${partner.local_uid}` : String(partner.id);
      return option(value, hybridEntityLabel('partner', partner), value === partnerValue);
    }).join('');
    $('scan-partner-label').textContent = config.partner === 'supplier'
      ? 'Supplier'
      : config.partnerOptional ? 'Customer / Company (optional)' : 'Customer / Company';
    $('scan-partner-search').placeholder = config.partner === 'supplier'
      ? 'Search supplier name, code, or phone'
      : 'Search customer or company';
    $('scan-partner-field').hidden = false;
    hybridSyncEntitySearchFromHidden('partner');
  } else {
    $('scan-partner-field').hidden = true;
    $('scan-partner').value = '';
    $('scan-partner-search').value = '';
  }

  const showTruck = Boolean(config.truckRequired || operationType === 'finished_damage');
  $('scan-truck-field').hidden = !showTruck;
  if (showTruck) {
    $('scan-truck').innerHTML = '<option value=""></option>' + (state.snapshot.trucks || []).map((truck) => option(truck.id, hybridEntityLabel('truck', truck), Number(preset.truck_id) === Number(truck.id))).join('');
    hybridSyncEntitySearchFromHidden('truck');
  } else {
    $('scan-truck').value = '';
    $('scan-truck-search').value = '';
  }

  // Routine Odoo transfers use Contact, Reference and Notes. Custom movement
  // reasons remain available only for exception workflows that explicitly need them.
  $('scan-reason-field').hidden = !config.reasonRequired;
};

buildScanDraft = function hybridBuildScanDraft() {
  const operationType = $('scan-operation').value;
  if (!NATIVE_OPERATION_TYPES.has(operationType)) return nativeBase.buildScanDraft('draft');
  const config = OP_CONFIG[operationType] || {};
  const tripValue = $('scan-trip').value;
  const partnerValue = $('scan-partner').value;
  const draft = {
    external_uid: state.scan.preset?.external_uid || uid('NK-XFER'),
    kind: 'native_transfer', operation_type: operationType,
    partner_id: partnerValue && !partnerValue.startsWith('local:') ? Number(partnerValue) : false,
    partner_external_uid: partnerValue?.startsWith('local:') ? partnerValue.slice(6) : false,
    reason_id: Number($('scan-reason').value || 0) || false,
    truck_id: Number($('scan-truck').value || 0) || false,
    trip_id: tripValue && !tripValue.startsWith('local:') ? Number(tripValue) : false,
    trip_external_uid: tripValue?.startsWith('local:') ? tripValue.slice(6) : false,
    reference: $('scan-reference').value.trim(), notes: $('scan-notes').value.trim(),
    lines: clone(state.scan.lines), actions: clone(state.scan.preset?.actions || []),
    created_on_device: state.scan.preset?.created_on_device || nowIso(), updated_on_device: nowIso(),
    sync_state: 'pending', online_created: state.serverOnline,
  };
  if (!draft.lines.length) throw new Error('Scan at least one product.');
  if (config.partnerRequired && !draft.partner_id && !draft.partner_external_uid) throw new Error('Select the required customer or supplier.');
  if (config.reasonRequired && !draft.reason_id) throw new Error('Select a movement reason.');
  if (config.tripRequired && !draft.trip_id && !draft.trip_external_uid) throw new Error('Select a distribution trip.');
  if (config.truckRequired && !draft.truck_id) throw new Error('Select the assigned truck.');
  const reason = reasonById(draft.reason_id);
  if (reason?.requires_note && !draft.notes) throw new Error('The selected reason requires an explanation in Notes.');
  return draft;
};

showScanReview = function hybridShowScanReview() {
  try {
    const draft = buildScanDraft();
    if (draft.kind !== 'native_transfer') return nativeBase.showScanReview();
    state.review = { source: 'new-native', draft, operation: hybridLocalTransferRow(draft) };
    renderReview(state.review.operation, true);
    closeModal('scan-modal');
    openModal('review-modal');
  } catch (error) {
    toast(error.message, 'error');
  }
};

function hybridLocalTransferRow(item) {
  const stage = hybridLocalNativeStage(item);
  const partnerValue = item.partner_external_uid ? `local:${item.partner_external_uid}` : item.partner_id;
  return {
    ...item,
    local: true,
    native: true,
    name: item.reference || `Device Transfer ${String(item.external_uid || '').slice(-8)}`,
    operation_label: OP_LABELS[item.operation_type] || 'Stock Transfer',
    state: item.sync_state === 'error' ? 'error' : stage,
    native_stage: stage,
    state_label: hybridNativeLabel(stage),
    partner: partnerById(partnerValue)?.name || '',
    truck: truckById(item.truck_id)?.name || '',
    trip: item.trip_external_uid ? localOpenTrips().find((trip) => trip.local_uid === item.trip_external_uid)?.name : tripById(item.trip_id)?.name || '',
    date: item.created_on_device,
    quantity: (item.lines || []).reduce((sum, line) => sum + number(line.quantity), 0),
    user: state.snapshot.user?.name || '',
    available_actions: hybridActionsForStage(stage),
    source_id: hybridSourceLocationId(item),
  };
}

function hybridActionsForStage(stage) {
  if (stage === 'draft') return ['mark_todo', 'cancel'];
  if (stage === 'waiting') return ['check_availability', 'validate', 'cancel', 'print'];
  if (stage === 'ready') return ['validate', 'cancel', 'print'];
  if (stage === 'done') return ['return', 'print'];
  return [];
}

localOperationRows = function hybridLocalOperationRows() {
  const legacy = nativeBase.localOperationRows().filter((item) => !NATIVE_KINDS.has(item.kind));
  const nativeRows = state.queue
    .filter((item) => ['native_transfer', 'native_transfer_event', 'native_return'].includes(item.kind))
    .map((item) => {
      if (item.kind === 'native_transfer') return hybridLocalTransferRow(item);
      const base = hybridTransferById(item.picking_id) || {
        id: item.picking_id, name: item.reference || `Transfer ${item.picking_id || ''}`,
        operation_type: item.operation_type, operation_label: OP_LABELS[item.operation_type],
        lines: item.lines || [], truck_id: item.truck_id, partner_id: item.partner_id,
        native_stage: item.base_native_stage || 'waiting', state: item.base_state || 'confirmed',
      };
      const row = hybridLocalTransferRow({ ...base, ...item, actions: [item.action], base_native_stage: base.native_stage });
      row.name = base.name;
      row.reference = base.reference || item.reference || '';
      row.lines = item.lines || base.lines || [];
      return row;
    });
  return [...nativeRows, ...legacy];
};

renderOperations = function hybridRenderOperations() {
  const operations = [...localOperationRows(), ...(state.snapshot.native_transfers || []), ...(state.snapshot.recent_operations || []).map((item) => ({ ...item, legacy: true }))];
  const search = String($('operation-search')?.value || '').toLowerCase();
  const status = $('operation-filter')?.value || 'all';
  const type = $('operation-type-filter')?.value || 'all';
  const filtered = operations.filter((operation) => {
    const stage = operation.native ? operation.native_stage : operation.legacy ? operation.state : operation.native_stage || hybridNativeStageFromState(operation.state);
    if (status === 'pending' && !(operation.local && ['pending', 'attention'].includes(operation.sync_state))) return false;
    if (status === 'error' && operation.sync_state !== 'error' && operation.state !== 'error') return false;
    if (!['all', 'pending', 'error'].includes(status) && stage !== status) return false;
    if (type !== 'all' && operation.operation_type !== type) return false;
    const productNames = (operation.lines || []).map((line) => line.product || productById(line.product_id)?.name || '').join(' ');
    return !search || [operation.name, operation.operation_label, operation.partner, operation.truck, operation.reference, productNames]
      .some((value) => String(value || '').toLowerCase().includes(search));
  });
  $('operations-body').innerHTML = filtered.length ? filtered.map((operation) => {
    const isNative = operation.native || !operation.legacy;
    const stage = isNative ? (operation.native_stage || hybridNativeStageFromState(operation.state)) : operation.state;
    const party = operation.partner || operation.truck || '—';
    const action = operation.local
      ? `<button class="nk-button small light local-operation-review" data-uid="${html(operation.external_uid)}">Open</button>`
      : `<button class="nk-button small light server-operation-review" data-id="${operation.id}" data-native="${isNative ? '1' : '0'}">Open</button>`;
    const syncText = operation.local ? `<div class="nk-small ${operation.sync_state === 'error' ? 'nk-quantity-low' : 'nk-muted'}">${html(operation.sync_state === 'attention' ? 'Needs Odoo decision' : operation.sync_state === 'error' ? operation.sync_error || 'Sync error' : 'Waiting to synchronize')}</div>` : '';
    return `<tr><td><strong>${html(operation.name)}</strong>${syncText}</td><td>${formatDateTime(operation.scheduled_date || operation.date)}</td><td>${html(operation.operation_label || OP_LABELS[operation.operation_type] || 'Stock Transfer')}</td><td>${html(party)}</td><td class="number">${formatNumber(operation.quantity)}</td><td>${html(operation.user || '')}</td><td>${badge(stage === 'cancel' ? 'cancelled' : stage, isNative ? hybridNativeLabel(stage) : operationStateLabel(stage))}</td><td>${action}</td></tr>`;
  }).join('') : '<tr><td colspan="8" class="nk-empty">No stock transfers match the selected filters.</td></tr>';
};

function hybridNativeLines(operation) {
  if (operation.moves?.length) return operation.moves.map((move) => ({
    move_id: move.id, product_id: move.product_id, product: move.product,
    barcode: move.barcode, quantity: move.demand, reserved_quantity: move.quantity,
    uom: move.uom, lot_reference: move.lot_reference, expiration_date: move.expiration_date,
  }));
  return operation.lines || [];
}

renderReview = function hybridRenderReview(operation, editableActions = false) {
  if (!operation.native && !NATIVE_KINDS.has(operation.kind)) return nativeBase.renderReview(operation, editableActions);
  const stage = operation.native_stage || hybridNativeStageFromState(operation.state);
  const lines = hybridNativeLines(operation);
  $('review-title').textContent = `${operation.name || 'New'} · ${operation.operation_label || OP_LABELS[operation.operation_type] || 'Stock Transfer'}`;
  $('review-content').innerHTML = `${hybridStatusFlow(stage)}
    <div class="nk-grid nk-grid-3 nk-review-meta">
      <div class="nk-card"><span>Operation Type</span><strong>${html(operation.operation_label || OP_LABELS[operation.operation_type] || '')}</strong></div>
      <div class="nk-card"><span>Contact</span><strong>${html(operation.partner || 'Not set')}</strong></div>
      <div class="nk-card"><span>Scheduled Date</span><strong>${formatDateTime(operation.scheduled_date || operation.date)}</strong></div>
      <div class="nk-card"><span>Source Location</span><strong>${html(operation.source || 'Odoo default')}</strong></div>
      <div class="nk-card"><span>Destination Location</span><strong>${html(operation.destination || operation.truck || 'Odoo default')}</strong></div>
      <div class="nk-card"><span>Reference</span><strong>${html(operation.reference || 'Not set')}</strong></div>
    </div>
    <div class="nk-table-wrap" style="margin-top:18px"><table class="nk-table"><thead><tr><th>Product</th><th>Barcode</th><th class="number">Demand</th><th class="number">Reserved / Quantity</th><th>Unit</th><th>Batch / Lot</th></tr></thead><tbody>${lines.map((line) => `<tr><td><button class="nk-product-link" data-product-id="${line.product_id}">${html(line.product || productById(line.product_id)?.name || '')}</button></td><td>${html(line.barcode || productById(line.product_id)?.barcode || '—')}</td><td class="number">${formatNumber(line.quantity ?? line.demand)}</td><td class="number">${formatNumber(line.reserved_quantity || 0)}</td><td>${html(line.uom || productById(line.product_id)?.uom || '')}</td><td>${html(line.lot_reference || '—')}</td></tr>`).join('')}</tbody></table></div>
    ${operation.reason || operation.reason_id ? `<div class="nk-card" style="margin-top:14px"><strong>Movement Reason:</strong> ${html(operation.reason || reasonById(operation.reason_id)?.name || '')}</div>` : ''}
    ${operation.notes ? `<div class="nk-card" style="margin-top:14px"><strong>Notes</strong><div class="nk-small nk-muted" style="margin-top:7px">${html(operation.notes)}</div></div>` : ''}
    ${operation.local ? `<div class="nk-sync-note ${operation.sync_state === 'error' ? 'error' : ''}">${operation.sync_state === 'attention' ? html(operation.sync_notice || 'Odoo needs a decision.') : operation.sync_state === 'error' ? html(operation.sync_error || 'Synchronization error') : 'Waiting to synchronize. The displayed business state is provisional until Odoo accepts the queued action.'}</div>` : ''}`;
  const actions = $('review-actions');
  if (editableActions) {
    actions.innerHTML = '<button type="button" class="nk-button light" id="review-back">Back</button><button type="button" class="nk-button secondary" id="native-save-draft">Save Draft</button><button type="button" class="nk-button primary" id="native-mark-todo">Mark as Todo</button>';
    $('review-back').onclick = (event) => {
      event.preventDefault(); event.stopPropagation();
      closeModal('review-modal'); openModal('scan-modal');
    };
    $('native-save-draft').onclick = async (event) => {
      event.preventDefault(); event.stopPropagation();
      try { await saveReviewedDraft('draft'); } catch (error) { console.error(error); toast(error.message || 'Unable to save the draft.', 'error'); }
    };
    $('native-mark-todo').onclick = async (event) => {
      event.preventDefault(); event.stopPropagation();
      try { await saveReviewedDraft('confirmed'); } catch (error) { console.error(error); toast(error.message || 'Unable to mark the transfer as todo.', 'error'); }
    };
    all('.nk-product-link', $('review-content')).forEach((button) => {
      button.onclick = (event) => {
        event.preventDefault(); event.stopPropagation();
        hybridOpenProductFromClick(Number(button.dataset.productId));
      };
    });
    return;
  }
  const buttons = ['<button class="nk-button light" data-close-modal="review-modal">Close</button>'];
  const available = operation.available_actions || hybridActionsForStage(stage);
  if (operation.local && operation.kind === 'native_transfer' && stage === 'draft') buttons.push(`<button class="nk-button light local-edit-operation" data-uid="${html(operation.external_uid)}">Edit</button>`);
  if (available.includes('mark_todo')) buttons.push(`<button class="nk-button primary native-operation-action" data-action="mark_todo">Mark as Todo</button>`);
  if (available.includes('check_availability')) buttons.push(`<button class="nk-button primary native-operation-action" data-action="check_availability">Check Availability</button>`);
  if (['waiting', 'ready'].includes(stage)) buttons.push('<button class="nk-button light" id="open-detailed-operations">Detailed Operations</button>');
  if (available.includes('validate')) buttons.push(`<button class="nk-button primary native-operation-action" data-action="validate">Validate</button>`);
  if (available.includes('return')) buttons.push(`<button class="nk-button secondary native-operation-action" data-action="return">Return</button>`);
  if (available.includes('cancel')) buttons.push(`<button class="nk-button danger native-operation-action" data-action="cancel">Cancel</button>`);
  buttons.push(`<button class="nk-button dark native-print">Print${operation.local ? ' Device Copy' : ''}</button>`);
  if (!operation.local && operation.web_url && state.snapshot.permissions?.system) buttons.push(`<a class="nk-button light" href="${html(operation.web_url)}">Backend</a>`);
  if (operation.local && ['draft', 'cancel'].includes(stage)) buttons.push(`<button class="nk-button danger queue-delete-modal" data-uid="${html(operation.external_uid)}">Delete</button>`);
  if (operation.sync_state === 'attention' && String(operation.requires_dialog || '').includes('backorder')) {
    buttons.push('<button class="nk-button secondary backorder-choice" data-choice="create">Create Backorder</button><button class="nk-button light backorder-choice" data-choice="cancel">No Backorder</button>');
  }
  actions.innerHTML = buttons.join('');
};

saveReviewedDraft = async function hybridSaveReviewedDraft(desiredState) {
  if (state.review?.draft?.kind !== 'native_transfer') return nativeBase.saveReviewedDraft(desiredState);
  const draft = clone(state.review.draft);
  draft.actions = desiredState === 'confirmed' ? ['mark_todo'] : desiredState === 'done' ? ['mark_todo', 'validate'] : [];
  draft.sync_state = 'pending';
  await queuePut(draft);
  closeModal('review-modal');
  state.scan = { operationType: '', lines: [], preset: {} };
  toast(draft.actions.length ? 'Mark as Todo saved. Odoo will confirm the transfer during synchronization.' : 'Native Odoo transfer draft saved on this device.', 'success');
  navigate('operations');
  if (state.serverOnline) syncQueue(false);
};

openLocalOperation = function hybridOpenLocalOperation(uidValue) {
  const item = state.queue.find((entry) => entry.external_uid === uidValue);
  if (!item || !NATIVE_KINDS.has(item.kind)) return nativeBase.openLocalOperation(uidValue);
  const operation = item.kind === 'native_transfer' ? hybridLocalTransferRow(item) : localOperationRows().find((row) => row.external_uid === uidValue);
  state.review = { source: 'native-local', draft: item, operation, allocations: clone(item.allocations || []) };
  renderReview(operation, false);
  openModal('review-modal');
};

openServerOperation = function hybridOpenServerOperation(id) {
  const operation = hybridTransferById(id);
  if (!operation) return nativeBase.openServerOperation(id);
  state.review = { source: 'native-server', operation: { ...operation, native: true }, allocations: [] };
  renderReview(state.review.operation, false);
  openModal('review-modal');
};

async function hybridQueueNativeAction(action, extras = {}) {
  const operation = state.review?.operation;
  if (!operation) return;
  if (operation.local && operation.kind === 'native_transfer') {
    const item = state.queue.find((entry) => entry.external_uid === operation.external_uid);
    if (!item) return;
    if (action === 'cancel') item.actions = ['cancel'];
    else if (action === 'mark_todo') item.actions = [...new Set([...(item.actions || []), 'mark_todo'])];
    else if (action === 'check_availability') item.actions = [...new Set([...(item.actions || []), 'mark_todo', 'check_availability'])];
    else if (action === 'validate') item.actions = [...new Set([...(item.actions || []), 'mark_todo', 'check_availability', 'validate'])];
    Object.assign(item, extras, { allocations: clone(state.review.allocations || item.allocations || []), sync_state: 'pending', sync_error: '', sync_notice: '' });
    await queuePut(item);
  } else {
    const source = operation.local
      ? state.queue.find((entry) => entry.external_uid === operation.external_uid)
      : operation;
    await queuePut({
      external_uid: uid(action === 'return' ? 'NK-RETURN' : 'NK-XFER-ACTION'),
      kind: action === 'return' ? 'native_return' : 'native_transfer_event',
      action,
      picking_id: operation.id || source?.picking_id || false,
      transfer_external_uid: source?.kind === 'native_transfer' ? source.external_uid : source?.transfer_external_uid || false,
      operation_type: operation.operation_type,
      base_native_stage: operation.native_stage || hybridNativeStageFromState(operation.state),
      base_state: operation.state,
      lines: clone(operation.lines || []),
      truck_id: operation.truck_id || false,
      partner_id: operation.partner_id || false,
      reference: operation.name,
      allocations: clone(state.review.allocations || []),
      created_on_device: nowIso(), sync_state: 'pending', ...extras,
    });
  }
  closeModal('review-modal');
  const labels = { mark_todo: 'Mark as Todo', check_availability: 'Check Availability', validate: 'Validate', cancel: 'Cancel', return: 'Return' };
  toast(`${labels[action] || action} saved${state.serverOnline ? ' and is being sent to Odoo' : ' on this device'}.`, 'success');
  if (state.serverOnline) syncQueue(false);
}

operationAction = async function hybridOperationAction(operationId, action) {
  const operation = hybridTransferById(operationId);
  if (!operation) return nativeBase.operationAction(operationId, action);
  state.review = { source: 'native-server', operation: { ...operation, native: true }, allocations: [] };
  await hybridQueueNativeAction(action);
};

function hybridOpenDetailedOperations() {
  const operation = state.review?.operation;
  if (!operation) return;
  const sourceId = hybridSourceLocationId(operation);
  const lines = hybridNativeLines(operation);
  const existing = state.review.allocations || [];
  const rows = [];
  for (const line of lines) {
    const candidates = (state.snapshot.stock_by_location || []).filter((quant) => quant.product_id === Number(line.product_id) && (!sourceId || hybridLocationIsWithin(quant.location_id, sourceId)));
    if (!candidates.length) {
      rows.push({ product_id: line.product_id, product: line.product || productById(line.product_id)?.name, location_id: sourceId, location: operation.source || 'Default source', lot_id: false, lot: '', available_quantity: 0, quantity: 0 });
    } else {
      for (const candidate of candidates) {
        const saved = existing.find((item) => item.product_id === line.product_id && item.location_id === candidate.location_id && Number(item.lot_id || 0) === Number(candidate.lot_id || 0));
        rows.push({ ...candidate, product: line.product || productById(line.product_id)?.name, quantity: saved?.quantity || 0 });
      }
    }
  }
  state.review.allocationRows = rows;
  $('detail-operation-title').textContent = `${operation.name || 'Transfer'} · Detailed Operations`;
  $('detail-operation-body').innerHTML = rows.map((row, index) => `<tr><td><button class="nk-product-link" data-product-id="${row.product_id}">${html(row.product)}</button></td><td>${html(row.location || 'Default source')}</td><td>${html(row.lot || '—')}</td><td class="number">${formatNumber(row.available_quantity)}</td><td class="number"><input class="nk-input detailed-qty" type="number" min="0" step="0.001" data-index="${index}" value="${number(row.quantity)}"></td></tr>`).join('') || '<tr><td colspan="5" class="nk-empty">No synchronized location details are available.</td></tr>';
  $('force-demand-field').hidden = !(state.snapshot.permissions?.supervisor || state.snapshot.permissions?.system);
  $('detail-force-demand').checked = Boolean(state.review.force_demand);
  openModal('detailed-operations-modal');
}

function hybridSaveDetailedOperations() {
  const rows = state.review?.allocationRows || [];
  const allocations = rows.filter((row) => number(row.quantity) > 0).map((row) => ({
    product_id: row.product_id, location_id: row.location_id,
    lot_id: row.lot_id || false, package_id: row.package_id || false,
    quantity: number(row.quantity),
  }));
  state.review.allocations = allocations;
  state.review.force_demand = Boolean($('detail-force-demand').checked);
  closeModal('detailed-operations-modal');
  toast(`${allocations.length} detailed allocation line${allocations.length === 1 ? '' : 's'} saved on this device.`, 'success');
}

function hybridOpenProductFromClick(productId) {
  if (!productId) return;
  const detail = hybridProductDetail(productId);
  const backendUrl = detail?.backend_url || `/web#id=${productId}&model=product.product&view_type=form`;
  if (state.serverOnline) {
    const opened = window.open(backendUrl, '_blank', 'noopener');
    if (!opened) window.location.href = backendUrl;
    return;
  }
  hybridOpenProductDetails(productId);
}

function hybridOpenProductDetails(productId) {
  const product = productById(productId);
  const detail = hybridProductDetail(productId) || {
    product_id: productId, name: product?.name || '', barcode: product?.barcode || '',
    default_code: product?.default_code || '', uom: product?.uom || '',
    on_hand: projectedOnHand()[product?.type === 'raw_material' ? 'raw' : 'finished']?.[String(productId)] || 0,
    free_qty: projectedBalances()[product?.type === 'raw_material' ? 'raw' : 'finished']?.[String(productId)] || 0,
    incoming_qty: 0, outgoing_qty: 0, forecasted_qty: 0, locations: [], reservations: [], moves: [],
  };
  $('product-detail-title').textContent = detail.name;
  $('product-detail-content').innerHTML = `<div class="nk-snapshot-banner">${state.serverOnline ? 'Odoo product information' : `Offline inventory snapshot · Last synchronized ${formatDateTime(state.snapshot.saved_at)}`}</div>
    <div class="nk-grid nk-grid-5 nk-product-kpis">
      ${renderKpi('On Hand', formatNumber(detail.on_hand), detail.uom)}
      ${renderKpi('Free to Use', formatNumber(detail.free_qty), detail.uom)}
      ${renderKpi('Incoming', formatNumber(detail.incoming_qty), detail.uom)}
      ${renderKpi('Outgoing', formatNumber(detail.outgoing_qty), detail.uom)}
      ${renderKpi('Forecasted', formatNumber(detail.forecasted_qty), detail.uom)}
    </div>
    <div class="nk-grid nk-grid-2 nk-section">
      <div class="nk-card"><h3>Locations & Lots</h3><div class="nk-table-wrap"><table class="nk-table"><thead><tr><th>Location</th><th>Lot</th><th class="number">On Hand</th><th class="number">Reserved</th><th class="number">Available</th></tr></thead><tbody>${(detail.locations || []).map((row) => `<tr><td>${html(row.location)}</td><td>${html(row.lot || '—')}</td><td class="number">${formatNumber(row.quantity)}</td><td class="number">${formatNumber(row.reserved)}</td><td class="number">${formatNumber(row.available)}</td></tr>`).join('') || '<tr><td colspan="5" class="nk-empty">No location rows.</td></tr>'}</tbody></table></div></div>
      <div class="nk-card"><h3>Used By / Reservations</h3><div class="nk-table-wrap"><table class="nk-table"><thead><tr><th>Reference</th><th>Customer</th><th class="number">Demand</th><th class="number">Reserved</th><th>Status</th></tr></thead><tbody>${(detail.reservations || []).map((row) => `<tr><td>${html(row.reference)}</td><td>${html(row.partner || row.truck || '—')}</td><td class="number">${formatNumber(row.demand)}</td><td class="number">${formatNumber(row.reserved)}</td><td>${html(row.state)}</td></tr>`).join('') || '<tr><td colspan="5" class="nk-empty">No open reservations in the synchronized snapshot.</td></tr>'}</tbody></table></div></div>
    </div>
    <div class="nk-card nk-section"><h3>Moves History</h3><div class="nk-table-wrap"><table class="nk-table"><thead><tr><th>Date</th><th>Reference</th><th>From</th><th>To</th><th class="number">Demand</th><th class="number">Quantity</th><th>Status</th></tr></thead><tbody>${(detail.moves || []).map((move) => `<tr><td>${formatDateTime(move.date)}</td><td>${html(move.reference)}</td><td>${html(move.source)}</td><td>${html(move.destination)}</td><td class="number">${formatNumber(move.demand)}</td><td class="number">${formatNumber(move.quantity)}</td><td>${html(move.state)}</td></tr>`).join('') || '<tr><td colspan="7" class="nk-empty">No move history in the synchronized snapshot.</td></tr>'}</tbody></table></div></div>`;
  $('open-odoo-product').hidden = !state.serverOnline;
  $('open-odoo-product').dataset.url = detail.backend_url || `/web#id=${productId}&model=product.product&view_type=form`;
  openModal('product-detail-modal');
}

renderStock = function hybridRenderStock(type) {
  nativeBase.renderStock(type);
  all(`#${type}-stock-body tr`).forEach((row) => {
    const nameCell = row.querySelector('td:first-child');
    const text = nameCell?.querySelector('strong')?.textContent;
    const product = (state.snapshot.products || []).find((item) => item.name === text);
    if (nameCell && product) {
      nameCell.innerHTML = `<button class="nk-product-link" data-product-id="${product.id}">${html(product.name)}</button><div class="nk-small nk-muted">${html(product.default_code || '')}</div>`;
    }
  });
};

renderContacts = function hybridRenderContacts() {
  nativeBase.renderContacts();
  if (state.contactTab !== 'customers') {
    $('new-customer')?.setAttribute('hidden', 'hidden');
    return;
  }
  $('new-customer')?.removeAttribute('hidden');
  const search = String($('contact-search')?.value || '').trim().toLowerCase();
  const customers = hybridCustomers().filter((item) => [item.name, item.code, item.phone, item.route, item.address].some((value) => String(value || '').toLowerCase().includes(search)));
  $('contacts-content').innerHTML = `<div class="nk-table-wrap"><table class="nk-table"><thead><tr><th>Customer / Company</th><th>Type</th><th>Phone</th><th>Email</th><th>Route</th><th>Delivery Address</th></tr></thead><tbody>${customers.map((item) => `<tr><td><strong>${html(item.name)}</strong><div class="nk-small nk-muted">${html(item.code || '')}${item.local ? ' · Waiting to sync' : ''}</div></td><td>${html(item.company_type === 'person' ? 'Individual' : 'Company')}</td><td>${html(item.phone || '—')}</td><td>${html(item.email || '—')}</td><td>${html(item.route || '—')}</td><td>${html(item.address || '—')}</td></tr>`).join('') || '<tr><td colspan="6" class="nk-empty">No customers or companies found.</td></tr>'}</tbody></table></div>`;
};

async function hybridSaveCustomer() {
  const name = $('customer-name').value.trim();
  if (!name) return toast('Enter the customer or company name.', 'error');
  const item = {
    external_uid: uid('NK-CUSTOMER'), kind: 'contact_create',
    name, company_type: $('customer-type').value,
    customer_code: $('customer-code').value.trim(), phone: $('customer-phone').value.trim(),
    mobile: $('customer-mobile').value.trim(), email: $('customer-email').value.trim(),
    street: $('customer-street').value.trim(), street2: $('customer-street2').value.trim(),
    city: $('customer-city').value.trim(), route: $('customer-route').value.trim(),
    notes: $('customer-notes').value.trim(), created_on_device: nowIso(), sync_state: 'pending',
  };
  await queuePut(item);
  closeModal('customer-modal');
  toast('Customer / company saved. It will become an Odoo Contact when synchronized.', 'success');
  renderContacts();
  if (state.serverOnline) syncQueue(false);
}

renderSyncCentre = function hybridRenderSyncCentre() {
  nativeBase.renderSyncCentre();
  const labels = {
    native_transfer: 'Odoo Stock Transfer', native_transfer_event: 'Odoo Transfer Action',
    native_return: 'Odoo Return', contact_create: 'Create Customer / Company',
  };
  all('#queue-list .nk-list-item').forEach(() => {});
  const waiting = state.queue;
  $('queue-list').innerHTML = waiting.length ? waiting.map((item) => `<div class="nk-list-item"><strong>${html(labels[item.kind] || OP_LABELS[item.operation_type] || item.kind)}</strong><div class="nk-small nk-muted">${html(item.reference || item.name || item.external_uid)} · ${formatDateTime(item.created_on_device)}</div>${item.sync_state === 'attention' ? `<div class="nk-small nk-warning-text">${html(item.sync_notice || 'Odoo needs a decision.')}</div>` : ''}${item.sync_error ? `<div class="nk-small nk-quantity-low">${html(item.sync_error)}</div>` : ''}<div class="nk-actions" style="margin-top:8px">${item.sync_state === 'error' ? `<button class="nk-button small secondary queue-retry" data-uid="${html(item.external_uid)}">Retry</button>` : ''}${['native_transfer', 'native_transfer_event', 'native_return'].includes(item.kind) ? `<button class="nk-button small light local-operation-review" data-uid="${html(item.external_uid)}">Open</button>` : ''}<button class="nk-button small danger queue-delete" data-uid="${html(item.external_uid)}">Delete</button></div></div>`).join('') : '<div class="nk-empty">No device actions are waiting.</div>';
};

bindEvents = function hybridBindEvents() {
  nativeBase.bindEvents();
  hybridBindEntityAutocomplete('partner');
  hybridBindEntityAutocomplete('truck');
  $('scan-trip').addEventListener('change', () => window.setTimeout(() => hybridSyncEntitySearchFromHidden('truck'), 0));
  $('review-actions').addEventListener('click', async (event) => {
    if (event.target.id === 'native-save-draft') await saveReviewedDraft('draft');
    if (event.target.id === 'native-mark-todo') await saveReviewedDraft('confirmed');
    const nativeAction = event.target.closest('.native-operation-action');
    if (nativeAction) {
      const action = nativeAction.dataset.action;
      if (action === 'validate' && !window.confirm('Validate this transfer using Odoo’s native inventory flow?')) return;
      if (action === 'cancel' && !window.confirm('Cancel this stock transfer?')) return;
      if (action === 'return' && !window.confirm('Create an Odoo return for the completed transfer?')) return;
      await hybridQueueNativeAction(action, { force_demand: Boolean(state.review?.force_demand) });
    }
    if (event.target.id === 'open-detailed-operations') hybridOpenDetailedOperations();
    if (event.target.closest('.native-print')) {
      const operation = state.review?.operation;
      if (!operation) return;
      if (!operation.local && operation.print_url && state.serverOnline) window.open(operation.print_url, '_blank', 'noopener');
      else printCachedOperation({ ...operation, operation_label: operation.operation_label, lines: hybridNativeLines(operation) });
    }
    const backorder = event.target.closest('.backorder-choice');
    if (backorder) {
      const item = state.queue.find((entry) => entry.external_uid === state.review?.operation?.external_uid);
      if (item) {
        item.backorder = backorder.dataset.choice;
        item.sync_state = 'pending'; item.sync_notice = ''; item.requires_dialog = '';
        await queuePut(item); closeModal('review-modal'); syncQueue(true);
      }
    }
  });
  document.body.addEventListener('click', (event) => {
    const productButton = event.target.closest('.nk-product-link');
    if (productButton) {
      event.preventDefault();
      hybridOpenProductFromClick(Number(productButton.dataset.productId));
    }
    const localReview = event.target.closest('.local-operation-review');
    if (localReview && localReview.closest('#queue-list')) openLocalOperation(localReview.dataset.uid);
  });
  $('detail-operation-body').addEventListener('change', (event) => {
    if (!event.target.matches('.detailed-qty')) return;
    const row = state.review?.allocationRows?.[Number(event.target.dataset.index)];
    if (row) row.quantity = number(event.target.value);
  });
  $('save-detailed-operations').addEventListener('click', hybridSaveDetailedOperations);
  $('open-odoo-product').addEventListener('click', () => {
    const url = $('open-odoo-product').dataset.url;
    if (url) window.open(url, '_blank', 'noopener');
  });
  $('new-customer').addEventListener('click', () => {
    ['customer-name','customer-code','customer-phone','customer-mobile','customer-email','customer-street','customer-street2','customer-city','customer-route','customer-notes'].forEach((id) => { $(id).value = ''; });
    $('customer-type').value = 'company';
    openModal('customer-modal');
  });
  $('customer-save').addEventListener('click', hybridSaveCustomer);
};

// Update filters to Odoo-native stages before workspace initialization.
const operationFilter = $('operation-filter');
if (operationFilter) operationFilter.innerHTML = '<option value="all">All statuses</option><option value="draft">Draft</option><option value="waiting">Waiting</option><option value="ready">Ready</option><option value="done">Done</option><option value="cancel">Cancelled</option><option value="pending">Waiting to sync</option><option value="error">Sync error</option>';
