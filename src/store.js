import { createClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import { errorMessage, reportError } from './error-handling.js';

const projectUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
// Prefer the current key type, retaining the old anon variable for existing setups.
const publicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
const configured = Boolean(
  projectUrl && publicKey &&
  !projectUrl.includes('YOUR-PROJECT') &&
  !publicKey.includes('your-anon-public-key')
);

/** No credentials means a private, browser-only preview; configured builds use Supabase. */
export const isLocalMode = !configured;
export const supabase = configured ? createClient(projectUrl, publicKey) : null;

const TABLES = ['properties', 'rooms', 'people', 'charges', 'payments', 'expenses', 'maintenance'];
const LOCAL_KEY = 'sakan-lodge-local-db-v1';
const LOCAL_CHANGE_EVENT = 'sakan-local-change';
const LOCAL_ACTOR_KEY = 'sakan-lodge-local-actor-v1';
const PROPERTY_ANCHOR_FIXES = {
  'local-fulham': { name: 'Fulham', lease_anchor: '2026-10-13' },
  'local-oaklands': { name: 'Oaklands Park', lease_anchor: '2026-10-17' },
  'local-clapham': { name: 'Clapham', lease_anchor: '2026-10-23' },
};

export const getLocalActor = () => isLocalMode ? window.localStorage.getItem(LOCAL_ACTOR_KEY) : null;

export function setLocalActor(name) {
  if (!isLocalMode) return;
  if (name) window.localStorage.setItem(LOCAL_ACTOR_KEY, name);
  else window.localStorage.removeItem(LOCAL_ACTOR_KEY);
  if (!name) return;
  const db = readLocalDb();
  auditLocal(db, 'started a local session');
  writeLocalDb(db);
}

export function restoreLocalBackup(data) {
  if (!isLocalMode) throw new Error('Local backup restore is only available in local mode.');
  // Accept backups made before the repair queue was added; newer tables default empty.
  const required = [...TABLES.filter((table) => table !== 'maintenance'), 'audit'];
  if (!data || required.some((table) => !Array.isArray(data[table])) || !Array.isArray(data.properties)) {
    throw new Error('This file is not a valid SAKAN Lodge backup.');
  }
  const propertyIds = new Set(data.properties.map((p) => p.id));
  const personIds = new Set(data.people.map((p) => p.id));
  if (!Array.isArray(data.maintenance)) data.maintenance = [];
  if (data.rooms.some((r) => !propertyIds.has(r.property_id)) || data.people.some((p) => !propertyIds.has(p.property_id)) ||
      data.payments.some((p) => !personIds.has(p.person_id) || !propertyIds.has(p.property_id))) {
    throw new Error('The backup has missing property or resident references and cannot be restored.');
  }
  auditLocal(data, 'restored a local data backup');
  writeLocalDb(Object.fromEntries([...required, 'maintenance'].map((table) => [table, data[table]])));
}

function makeSeedDb() {
  const properties = [
    { id: 'local-fulham', name: 'Fulham', lease_rent: 1500, lease_anchor: '2026-10-13', lease_start: null, lease_first_amount: null, electricity_cap: 800, bills_amount: 0, bills_frequency: 'monthly' },
    { id: 'local-oaklands', name: 'Oaklands Park', lease_rent: 1500, lease_anchor: '2026-10-17', lease_start: null, lease_first_amount: null, electricity_cap: 800, bills_amount: 0, bills_frequency: 'monthly' },
    { id: 'local-clapham', name: 'Clapham', lease_rent: 1680, lease_anchor: '2026-10-23', lease_start: '2026-08-29', lease_first_amount: 1680, electricity_cap: 800, bills_amount: 0, bills_frequency: 'monthly' },
    { id: 'local-woodville', name: 'Woodville', lease_rent: 1650, lease_anchor: '2026-09-11', lease_start: null, lease_first_amount: null, electricity_cap: 800, bills_amount: 0, bills_frequency: 'monthly' },
  ];
  const roomDefs = {
    'local-fulham': [['Granny flat', 2], ['Room 1', 1], ['Room 2', 1], ['Room 3', 1], ['Room 4', 1]],
    'local-oaklands': [['Room 1', 3], ['Room 2', 3], ['Room 3', 3], ['Room 4', 1], ['Room 5', 1], ['Room 6', 1], ['Room 7', 1]],
    'local-clapham': [['Room 01-1', 1], ['Room 01-2', 1], ['Room 02', 1], ['Room 03', 1], ['Room 04', 1], ['Room 05', 1], ['Room 06', 1]],
    'local-woodville': [['Room 1', 1], ['Room 2', 1], ['Room 3', 1], ['Room 4', 1], ['Room 5', 1], ['Room 6', 1]],
  };
  const rooms = properties.flatMap((p) => roomDefs[p.id].map(([label, capacity], i) => ({
    id: `${p.id}-room-${i + 1}`, property_id: p.id, label, capacity, sort: i,
  })));
  return { properties, rooms, people: [], charges: [], payments: [], expenses: [], maintenance: [], audit: [] };
}

function applyPropertyAnchorFixes(db) {
  let changed = false;
  if (!db || !Array.isArray(db.properties)) return changed;
  for (const [propertyId, patch] of Object.entries(PROPERTY_ANCHOR_FIXES)) {
    const property = db.properties.find((row) => row.id === propertyId || row.name === patch.name);
    if (!property) continue;
    const next = { ...property, ...patch };
    if (property.lease_anchor !== next.lease_anchor) {
      property.lease_anchor = next.lease_anchor;
      if (property.id === propertyId && property.name !== patch.name) property.name = patch.name;
      changed = true;
    }
  }
  return changed;
}

function readLocalDb() {
  const raw = window.localStorage.getItem(LOCAL_KEY);
  if (!raw) {
    const seed = makeSeedDb();
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(seed));
    return seed;
  }
  try {
    const db = JSON.parse(raw);
    for (const table of [...TABLES, 'audit']) if (!Array.isArray(db[table])) db[table] = [];
    // Keep the artifact's specified layout current in an existing empty local preview.
    if (db.people.length === 0 && db.charges.length === 0 && db.payments.length === 0 && db.expenses.length === 0) {
      const seed = makeSeedDb();
      db.rooms = db.rooms.map((room) => {
        const updated = seed.rooms.find((item) => item.id === room.id);
        return updated ? { ...room, label: updated.label, capacity: updated.capacity, sort: updated.sort } : room;
      });
      db.properties = db.properties.map((property) => {
        const updated = seed.properties.find((item) => item.id === property.id);
        return updated ? { ...property, ...updated } : property;
      });
      window.localStorage.setItem(LOCAL_KEY, JSON.stringify(db));
    }
    if (applyPropertyAnchorFixes(db)) {
      window.localStorage.setItem(LOCAL_KEY, JSON.stringify(db));
    }
    return db;
  } catch (error) {
    // Preserve the original local data for recovery. Never silently replace it.
    throw new Error('Local Sakan Lodge data could not be read. Your existing browser data has been preserved. Export or copy the local storage entry before attempting recovery.', { cause: error });
  }
}

function writeLocalDb(db) {
  window.localStorage.setItem(LOCAL_KEY, JSON.stringify(db));
  window.dispatchEvent(new Event(LOCAL_CHANGE_EVENT));
}

const newId = () => globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function auditLocal(db, action) {
  db.audit.unshift({ id: newId(), at: new Date().toISOString(), by: getLocalActor() || 'Local preview', action });
  db.audit = db.audit.slice(0, 300);
}

function describeLocalChange(db, table, row, verb) {
  const property = db.properties.find((p) => p.id === (row.property_id || row.propertyId))?.name;
  const person = db.people.find((p) => p.id === (row.person_id || row.personId));
  const subject = table === 'people' ? row.name : table === 'properties' ? row.name : table === 'rooms' ? row.label : table === 'payments' ? `${row.kind || 'rent'} payment${person ? ` for ${person.name}` : ''}` : table === 'expenses' ? `${row.category} expense${property ? ` at ${property}` : ''}` : table === 'maintenance' ? `${row.title || 'repair'}${property ? ` at ${property}` : ''}` : table;
  return `${verb} ${subject || table}`;
}

/** Local-mode records stay in this browser only and are never uploaded. */
export async function deleteRow(table, id) {
  if (isLocalMode) {
    try {
      const db = readLocalDb();
      if (table === 'properties') {
        const propertyId = id;
        const removedPeople = new Set(db.people.filter((person) => person.property_id === propertyId).map((person) => person.id));
        db.properties = db.properties.filter((row) => row.id !== propertyId);
        db.rooms = db.rooms.filter((row) => row.property_id !== propertyId);
        db.people = db.people.filter((row) => row.property_id !== propertyId);
        db.charges = db.charges.filter((row) => !removedPeople.has(row.person_id));
        db.payments = db.payments.filter((row) => row.property_id !== propertyId);
        db.expenses = db.expenses.filter((row) => row.property_id !== propertyId);
        db.maintenance = (db.maintenance || []).filter((row) => row.property_id !== propertyId);
        auditLocal(db, `deleted property and all linked records: ${propertyId}`);
        writeLocalDb(db);
        return true;
      }
      const prior = db[table] || [];
      const deleted = prior.find((row) => row.id === id);
      db[table] = prior.filter((row) => row.id !== id);
      if (table === 'rooms') db.people = db.people.map((p) => p.room_id === id ? { ...p, room_id: null } : p);
      if (table === 'people') {
        const personId = id;
        db.charges = db.charges.filter((row) => row.person_id !== personId);
        db.payments = db.payments.filter((row) => row.person_id !== personId);
        db.maintenance = (db.maintenance || []).filter((row) => row.room_id !== id);
      }
      auditLocal(db, deleted ? describeLocalChange(db, table, deleted, 'deleted') : `deleted ${table} entry`);
      writeLocalDb(db);
      return true;
    } catch (error) {
      reportError(`Local delete failed for ${table}:`, error);
      alert(errorMessage(error));
      return false;
    }
  }

  try {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) {
      alert(error.message);
      return false;
    }
    return true;
  } catch (error) {
    reportError(`Supabase delete failed for ${table}:`, error);
    alert(errorMessage(error));
    return false;
  }
}

export async function signOut() {
  if (isLocalMode) return;
  try {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch (error) {
    reportError('Sign out failed:', error);
    alert(errorMessage(error));
  }
}

/** Loads all current rows; realtime keeps the two live sessions in sync. */
export function useStore(session) {
  const [db, setDb] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      if (isLocalMode) {
        setDb(readLocalDb());
        setError(null);
        return;
      }
      const res = await Promise.all(TABLES.map((t) => supabase.from(t).select('*')));
      const audit = await supabase.from('audit').select('*').order('at', { ascending: false }).limit(300);
      const o = {};
      TABLES.forEach((t, i) => {
        if (res[i].error) throw res[i].error;
        o[t] = Array.isArray(res[i].data) ? res[i].data : [];
      });
      if (audit.error) throw audit.error;
      o.audit = Array.isArray(audit.data) ? audit.data : [];
      setDb(o);
      setError(null);
    } catch (e) {
      reportError('load records', e);
      setError(e);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    reload();
    if (isLocalMode) {
      const onChange = () => reload();
      window.addEventListener('storage', onChange);
      window.addEventListener(LOCAL_CHANGE_EVENT, onChange);
      return () => {
        window.removeEventListener('storage', onChange);
        window.removeEventListener(LOCAL_CHANGE_EVENT, onChange);
      };
    }
    let timer;
    const ch = supabase
      .channel('ledger')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        clearTimeout(timer);
        timer = setTimeout(reload, 150);
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(ch);
    };
  }, [session, reload]);

  return { db, error, reload };
}


/** Records the electricity expense and all resident shares as one database transaction. */
export async function postElectricityBill({ propertyId, billDate, qStart, qEnd, amount, shares }) {
  const expenseNote = `Quarter ${qStart} to ${qEnd}`;
  if (isLocalMode) {
    try {
      const db = readLocalDb();
      const now = new Date().toISOString();
      db.expenses.push({
        id: newId(), property_id: propertyId, date: billDate, category: 'Electricity',
        amount: Number(amount), note: expenseNote, paid_from: 'business', reimbursed: false, created_at: now,
      });
      for (const share of shares) {
        db.charges.push({
          id: newId(), person_id: share.personId, kind: 'electricity', period_start: qStart,
          period_end: qEnd, due_date: billDate, amount: Number(share.amount),
          note: `Electricity over cap: ${share.nights} of ${share.totalNights} nights`, created_at: now,
        });
      }
      auditLocal(db, `posted electricity bill for ${propertyId}: ${expenseNote}, $${Number(amount).toFixed(2)}, ${shares.length} share(s)`);
      writeLocalDb(db);
      return true;
    } catch (error) {
      reportError('Posting local electricity bill failed:', error);
      alert(errorMessage(error));
      return false;
    }
  }

  try {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.rpc('post_electricity_bill', {
      p_property_id: propertyId,
      p_bill_date: billDate,
      p_q_start: qStart,
      p_q_end: qEnd,
      p_amount: Number(amount),
      p_shares: shares,
    });
    if (error) throw error;
    return true;
  } catch (error) {
    reportError('Posting electricity bill failed:', error);
    alert(`Could not post the electricity bill. Nothing was saved. ${errorMessage(error)}`);
    return false;
  }
}

export async function save(table, row, id, action) {
  if (isLocalMode) {
    try {
      const db = readLocalDb();
      const rows = db[table] || [];
      const values = Array.isArray(row) ? row : [row];
      if (id) {
        db[table] = rows.map((old) => old.id === id ? { ...old, ...row } : old);
        const old = rows.find((item) => item.id === id) || {};
        auditLocal(db, action || describeLocalChange(db, table, { ...old, ...row }, 'updated'));
      } else {
        const inserted = values.map((item) => ({
          ...item,
          id: item.id || newId(),
          created_at: item.created_at || new Date().toISOString(),
        }));
        db[table] = [...rows, ...inserted];
        for (const item of inserted) auditLocal(db, action || describeLocalChange(db, table, item, 'added'));
      }
      writeLocalDb(db);
      return true;
    } catch (error) {
      reportError(`Local save failed for ${table}:`, error);
      alert(errorMessage(error));
      return false;
    }
  }

  try {
    if (!supabase) throw new Error('Supabase is not configured.');
    const q = id ? supabase.from(table).update(row).eq('id', id) : supabase.from(table).insert(row);
    const { error } = await q;
    if (error) throw error;
    return true;
  } catch (error) {
    reportError(`Supabase save failed for ${table}:`, error);
    alert(errorMessage(error));
    return false;
  }
}
