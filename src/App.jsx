import { useEffect, useMemo, useRef, useState } from 'react';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { errorMessage } from './error-handling.js';
import { findPossibleDuplicatePayment } from './financial-safety.js';
import TenantStatements from './features/reports/TenantStatements.jsx';
import { propertyProfitability } from './features/reports/finance-utils.js';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase, useStore, save, deleteRow, signOut, isLocalMode, postElectricityBill, getLocalActor, setLocalActor, restoreLocalBackup } from './store.js';
import * as L from './ledger.js';
import { accountChoices, bondStatusLabel, reorderList, sortPeopleByRentUrgency, sortRoomsByRentUrgency, tabFromPath, visibleTodaySections } from './app-helpers.js';
import PropertyPulseList from './features/home/PropertyPulse.jsx';
import TenantCommunications from './features/communications/TenantCommunications.jsx';

const TEAM = accountChoices();
const LOGO = '/ledger/sakan-logo.jpg';
const CATS = {
  'Head lease': ['Landlord rent'],
  'Running the houses': ['Cleaning', 'Lawn mowing', 'Rubbish removal'],
  Utilities: ['Electricity', 'Gas', 'Water', 'Internet'],
  Property: ['Setup & furnishings', 'Repairs & maintenance', 'Other'],
};
const fmt = (n) => '$' + (+n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum = (xs, f = (x) => x) => L.money(xs.reduce((s, x) => s + (+f(x) || 0), 0));
const nice = (s) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : '');
const dayAfter = (s) => { if (!s) return undefined; const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

export default function App() {
  const [session, setSession] = useState(undefined);
  const [selectedUser, setSelectedUser] = useState(() => isLocalMode ? getLocalActor() : null);
  const [showUserChooser, setShowUserChooser] = useState(false);
  const [headerVisible, setHeaderVisible] = useState(true);
  const lastScrollYRef = useRef(0);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const onScroll = () => {
      const currentY = window.scrollY;
      if (currentY <= 0) {
        setHeaderVisible(true);
      } else if (currentY > lastScrollYRef.current) {
        setHeaderVisible(false);
      } else {
        setHeaderVisible(true);
      }
      lastScrollYRef.current = currentY;
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (isLocalMode) {
      setSession({ user: { id: 'local-preview', email: getLocalActor() || 'Local preview' }, local: true });
      return;
    }

    let active = true;
    let unsubscribe = null;

    const setup = async () => {
      try {
        if (!supabase) {
          if (active) setSession(null);
          return;
        }
        const { data: initial } = await supabase.auth.getSession();
        if (!active) return;
        setSession(initial.session ?? null);
        const { data } = supabase.auth.onAuthStateChange((_e, s) => {
          if (active) setSession(s ?? null);
        });
        unsubscribe = () => data.subscription.unsubscribe();
      } catch (error) {
        console.error('Session bootstrap failed:', error);
        if (active) setSession(null);
      }
    };

    setup();
    return () => {
      active = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  if (session === undefined) return <div className="pad">Loading…</div>;
  if (showUserChooser || (isLocalMode && (!selectedUser || location.pathname === '/signin'))) {
    return (
      <Routes>
        <Route path="/signin" element={<UserChooser onPick={(name) => {
          setShowUserChooser(false);
          setSelectedUser(name);
          if (isLocalMode) {
            setLocalActor(name);
            setSession({ user: { id: 'local-preview', email: name }, local: true });
            navigate('/home', { replace: true });
          } else {
            navigate('/signin', { replace: true });
          }
        }} />} />
        <Route path="*" element={<Navigate to="/signin" replace />} />
      </Routes>
    );
  }
  if (!session) {
    return (
      <Routes>
        <Route path="/signin" element={<Login selectedUser={selectedUser || 'User'} onBack={() => {
          setSelectedUser(null);
          setShowUserChooser(true);
          navigate('/signin', { replace: true });
        }} />} />
        <Route path="*" element={<Navigate to="/signin" replace />} />
      </Routes>
    );
  }

  const accountName = session.user.user_metadata?.ledger_name || TEAM.find((name) => session.user.email?.toLowerCase().startsWith(name.toLowerCase())) || session.user.email;
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/signin" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<Main session={session} accountName={isLocalMode ? selectedUser : accountName} headerVisible={headerVisible} onSwitchLocal={() => {
          setLocalActor(null);
          setSelectedUser(null);
          navigate('/signin', { replace: true });
        }} />} />
        <Route path="/today" element={<Main session={session} accountName={isLocalMode ? selectedUser : accountName} headerVisible={headerVisible} onSwitchLocal={() => {
          setLocalActor(null);
          setSelectedUser(null);
          navigate('/signin', { replace: true });
        }} />} />
        <Route path="/communications" element={<Main session={session} accountName={isLocalMode ? selectedUser : accountName} headerVisible={headerVisible} onSwitchLocal={() => { setLocalActor(null); setSelectedUser(null); navigate("/signin", { replace: true }); }} />} />
        <Route path="/rooms" element={<Main session={session} accountName={isLocalMode ? selectedUser : accountName} headerVisible={headerVisible} onSwitchLocal={() => {
          setLocalActor(null);
          setSelectedUser(null);
          navigate('/signin', { replace: true });
        }} />} />
        <Route path="/rooms/:residentId" element={<Main session={session} accountName={isLocalMode ? selectedUser : accountName} headerVisible={headerVisible} onSwitchLocal={() => {
          setLocalActor(null);
          setSelectedUser(null);
          navigate('/signin', { replace: true });
        }} />} />
        <Route path="/rent" element={<Main session={session} accountName={isLocalMode ? selectedUser : accountName} headerVisible={headerVisible} onSwitchLocal={() => {
          setLocalActor(null);
          setSelectedUser(null);
          navigate('/signin', { replace: true });
        }} />} />
        <Route path="/expenses" element={<Main session={session} accountName={isLocalMode ? selectedUser : accountName} headerVisible={headerVisible} onSwitchLocal={() => {
          setLocalActor(null);
          setSelectedUser(null);
          navigate('/signin', { replace: true });
        }} />} />
        <Route path="/reports" element={<Main session={session} accountName={isLocalMode ? selectedUser : accountName} headerVisible={headerVisible} onSwitchLocal={() => {
          setLocalActor(null);
          setSelectedUser(null);
          navigate('/signin', { replace: true });
        }} />} />
        <Route path="/activity" element={<Main session={session} accountName={isLocalMode ? selectedUser : accountName} headerVisible={headerVisible} onSwitchLocal={() => {
          setLocalActor(null);
          setSelectedUser(null);
          navigate('/signin', { replace: true });
        }} />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}


function UserChooser({ onPick }) {
  return (
    <div className="user-chooser">
      <img src={LOGO} alt="SAKAN Lodge" />
      <h1>SAKAN Lodge</h1>
      <p className="tagline">Hospitality in its true sense</p>
      <p className="chooser-prompt">Who's using the ledger?</p>
      <div className="chooser-buttons">
        {TEAM.map((name) => {
          const className = name === 'Danish' ? 'danish' : name === 'Faizan' ? 'faizan' : 'joint';
          return <button className={className} key={name} onClick={() => onPick(name)}>{name}</button>;
        })}
      </div>
      <p className="chooser-note">Choose who is using the ledger. Changes are saved in this browser and activity is labelled with your name. Set up Supabase later to share updates across devices.</p>
    </div>
  );
}

function Login({ selectedUser, onBack }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  return (
    <form className="pad login" onSubmit={async (e) => {
      e.preventDefault();
      setErr('');
      if (!email.trim() || !pw.trim()) {
        setErr('Enter both email and password.');
        return;
      }
      setLoading(true);
      try {
        if (!supabase) throw new Error('Supabase is not configured.');
        const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
      } catch (error) {
        console.error('Login failed:', error);
        setErr(error?.message || 'Unable to sign in right now.');
      } finally {
        setLoading(false);
      }
    }}>
      <div className="login-brand"><img src={LOGO} alt="" /><h1>SAKAN Lodge</h1></div>
      <p className="login-as">Signing in as <strong>{selectedUser}</strong></p>
      <input type="email" placeholder="Email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input type="password" placeholder="Password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      <button className="primary" disabled={loading}>{loading ? 'Signing in…' : `Sign in as ${selectedUser}`}</button>
      {err && <p className="err">{err}</p>}
      <button type="button" className="chooser-back" onClick={onBack}>Choose a different user</button>
    </form>
  );
}

function Main({ session, accountName, headerVisible, onSwitchLocal }) {
  const { db, error, reload } = useStore(session);
  const location = useLocation();
  const navigate = useNavigate();
  const { residentId } = useParams();
  const [payFor, setPayFor] = useState(null);
  const today = L.todayStr();
  const d = useMemo(() => db && L.derive(db, today), [db, today]);
  const tab = tabFromPath(location.pathname);
  if (error) return <div className="pad err" role="alert"><h2>Unable to load Sakan Lodge</h2><p>{errorMessage(error)}</p><button type="button" onClick={reload}>Try again</button></div>;
  if (!d) return <div className="pad">Loading…</div>;
  const ctx = { db, d, today, reload, session, go: (t, pid) => { setPayFor(pid ?? null); const route = t === 'today' ? '/home' : `/${t}`; navigate(route); window.scrollTo(0, 0); } };
  const tabs = [['today', 'Home'], ['rooms', 'Rooms'], ['rent', 'Rent'], ['expenses', 'Expenses'], ['reports', 'Reports'], ['communications', 'Emails'], ['activity', 'Activity']];
  return (
    <>
      <header className={`topbar ${headerVisible ? 'visible' : 'hidden'}`}>
        <div className="topbar-inner">
          <div className="topbar-brand"><img className="brand-logo" src={LOGO} alt="SAKAN Lodge" /><span>SAKAN Lodge</span></div>
          <nav className="top-nav">{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => ctx.go(k)}>{l}</button>)}</nav>
        </div>
      </header>
      <main className="pad" id="main-content" tabIndex="-1">
        <header className="app-header">
          <div className="app-brand"><div><strong>SAKAN Lodge</strong><small>Hospitality in its true sense</small><small className="brand-meta">Four houses · {db.people.filter((p) => L.isActive(p, today)).length} residents</small><div className="account-switch"><span>Signed in as {accountName}</span>{isLocalMode ? <button type="button" onClick={onSwitchLocal}>Switch user</button> : <button type="button" onClick={signOut}>Switch user</button>}</div></div></div>
          <time>{nice(today)}</time>
        </header>
        {isLocalMode && <div className="local-banner"><strong>Local preview</strong><span>Saved only in this browser · not synced or backed up</span></div>}
        {tab === 'today' && <Today {...ctx} />}
        {tab === 'rooms' && <Rooms {...ctx} residentId={residentId || null} />}
        {tab === 'rent' && <Rent key={payFor || 'none'} {...ctx} payFor={payFor} />}
        {tab === 'expenses' && <Expenses {...ctx} payFor={payFor} />}
        {tab === 'reports' && <Reports {...ctx} />}
        {tab === 'communications' && <TenantCommunications db={db} today={today} />}
        {tab === 'activity' && <Activity {...ctx} />}
      </main>
    </>
  );
}

/* ---------------- Today ---------------- */
function Today({ db, d, today, go }) {
  const behind = d.people.filter((p) => p.owed > 0.005).sort((a, b) => b.daysLate - a.daysLate || b.owed - a.owed);
  const bonds = sum(d.people, (p) => p.bond_held);
  const props = [...db.properties].sort((a, b) => a.name.localeCompare(b.name));

  const SECTION_DEFAULT_ORDER = ['balanceHero', 'attention', 'propertyPulse', 'shortcuts', 'repairFollowUps', 'leaseReviews', 'schedule', 'bonds'];
  const readStoredJson = (key, fallback) => {
    if (typeof window === 'undefined') return fallback;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed;
    } catch {
      return fallback;
    }
  };

  const [sectionOrder, setSectionOrder] = useState(() => {
    const saved = readStoredJson('sakan-today-section-order', null);
    return Array.isArray(saved) && saved.length === SECTION_DEFAULT_ORDER.length ? saved : SECTION_DEFAULT_ORDER;
  });

  const [propertyOrder, setPropertyOrder] = useState(() => readStoredJson('sakan-property-order', null));

  const orderedProps = useMemo(() => {
    const ids = props.map((property) => String(property.id));
    const savedOrder = Array.isArray(propertyOrder) && propertyOrder.length === ids.length ? propertyOrder : ids;
    const orderMap = new Map(savedOrder.map((id, index) => [String(id), index]));
    return [...props].sort((a, b) => (orderMap.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER) - (orderMap.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER));
  }, [props, propertyOrder]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ids = props.map((property) => String(property.id));
    const savedOrder = Array.isArray(propertyOrder) && propertyOrder.length === ids.length ? propertyOrder : ids;
    try {
      window.localStorage.setItem('sakan-property-order', JSON.stringify(savedOrder));
    } catch {
      // Ignore storage quota and browser privacy failures.
    }
  }, [props, propertyOrder]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('sakan-today-section-order', JSON.stringify(sectionOrder));
    } catch {
      // Ignore storage quota and browser privacy failures.
    }
  }, [sectionOrder]);

  const handleReorderProperty = (sourceId, targetId) => {
    if (!sourceId || !targetId) return;
    try {
      const ids = orderedProps.map((property) => String(property.id));
      const fromIndex = ids.indexOf(String(sourceId));
      const toIndex = ids.indexOf(String(targetId));
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;
      setPropertyOrder(reorderList(ids, fromIndex, toIndex));
    } catch {
      // Ignore invalid drag payloads.
    }
  };

  const handleReorderSection = (sourceId, targetId) => {
    if (!sourceId || !targetId) return;
    try {
      const fromIndex = sectionOrder.indexOf(sourceId);
      const toIndex = sectionOrder.indexOf(targetId);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;
      setSectionOrder(reorderList(sectionOrder, fromIndex, toIndex));
    } catch {
      // Ignore invalid drag payloads.
    }
  };

  const next14 = L.n2d(L.d2n(today) + 14);
  const arrivals = d.people.filter((p) => p.start_date >= today && p.start_date <= next14).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const departures = d.people.filter((p) => p.end_date && p.end_date >= today && p.end_date <= next14).sort((a, b) => a.end_date.localeCompare(b.end_date));
  const fortnightStart = L.n2d(L.d2n(today) - 13);
  const followups = (db.maintenance || []).filter((job) => job.status !== 'complete' && (job.priority === 'urgent' || (job.due_date && job.due_date < today))).sort((a, b) => (a.due_date || '9999-99-99').localeCompare(b.due_date || '9999-99-99'));
  const windowEnd = L.n2d(L.d2n(today) + 60);
  const leaseReviews = db.properties.filter((p) => p.lease_end && p.lease_end <= windowEnd).sort((a, b) => a.lease_end.localeCompare(b.lease_end));

  const renderSectionContent = (sectionId) => {
    switch (sectionId) {
      case 'propertyPulse':
        return (
          <>
            <h2>Property pulse</h2>
            <PropertyPulseList
              properties={orderedProps.map((property) => ({
                ...property,
                rooms: db.rooms.filter((room) => room.property_id === property.id),
              }))}
              people={d.people}
              payments={db.payments}
              today={today}
              fortnightStart={fortnightStart}
              onSelectTenant={(personId) => go('rent', personId)}
              onReorderProperty={handleReorderProperty}
            />
          </>
        );
      case 'balanceHero':
        return <div className="hero"><small>Resident balances outstanding</small><b>{fmt(sum(behind, (p) => p.owed))}</b><small>Includes rent and resident utility charges.</small></div>;
      case 'shortcuts':
        return <div className="today-shortcuts"><button onClick={() => go('rent')}>Record money</button><button onClick={() => go('rooms')}>Manage rooms & residents</button><button onClick={() => go('expenses')}>Open expenses</button></div>;
      case 'attention':
        return (
          <>
            <h2>Needs attention</h2>
            {behind.length ? behind.map((p) => (
              <button className="row" key={p.id} onClick={() => go('rent', p.id)}>
                <span>{p.name}<small>{d.props[p.property_id]?.name} · {p.daysLate ? `${p.daysLate} day${p.daysLate > 1 ? 's' : ''} late` : 'due today'}</small></span>
                <b className="err">{fmt(p.owed)}</b>
              </button>
            )) : <p className="muted">Everyone is square.</p>}
          </>
        );
      case 'repairFollowUps':
        return followups.length > 0 && <>
          <h2>Repair follow-ups</h2>
          {followups.slice(0, 4).map((job) => <button className="row" key={job.id} onClick={() => go('expenses', 'maintenance')}>
            <span>{job.title}<small>{d.props[job.property_id]?.name}{job.due_date ? ` · follow up ${nice(job.due_date)}` : ''}</small></span>
            <b className={job.due_date && job.due_date < today ? 'err' : 'priority-urgent'}>{job.due_date && job.due_date < today ? 'Overdue' : 'Urgent'}</b>
          </button>)}
        </>;
      case 'leaseReviews':
        return leaseReviews.length > 0 && <>
          <h2>Lease dates to review</h2>
          {leaseReviews.map((p) => {
            const days = L.d2n(p.lease_end) - L.d2n(today);
            return <div className="row" key={p.id}><span>{p.name}<small>{days < 0 ? `Lease end date passed ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago` : days === 0 ? 'Lease end date is today' : `Lease ends in ${days} day${days === 1 ? '' : 's'}`}</small></span><b className={days <= 14 ? 'err' : ''}>{nice(p.lease_end)}</b></div>;
          })}
        </>;
      case 'schedule':
        return (
          <div className="schedule-grid">
            <section className="schedule-card"><h2>Arrivals · next 14 days</h2>{arrivals.length ? arrivals.map((p) => <div className="row" key={p.id}><span>{p.name}<small>{d.props[p.property_id]?.name} · {nice(p.start_date)} · {db.rooms.find((r) => r.id === p.room_id)?.label}</small></span></div>) : <p className="muted">No arrivals booked.</p>}</section>
            <section className="schedule-card"><h2>Departures · next 14 days</h2>{departures.length ? departures.map((p) => <div className="row" key={p.id}><span>{p.name}<small>{d.props[p.property_id]?.name} · {nice(p.end_date)}</small></span></div>) : <p className="muted">No check-outs scheduled.</p>}</section>
          </div>
        );
      case 'bonds':
        return (
          <>
            <h2>Bonds held</h2>
            <div className="card between"><span>On residents’ behalf (not income)</span><b>{fmt(bonds)}</b></div>
          </>
        );
      default:
        return null;
    }
  };

  const visibleSections = visibleTodaySections(sectionOrder, { behind, followups, leaseReviews });
  const orderedSections = visibleSections.includes('balanceHero') ? ['balanceHero', ...visibleSections.filter((sectionId) => sectionId !== 'balanceHero')] : visibleSections;

  return (
    <>
      <h1 className="screen-title">Today</h1>
      {orderedSections.map((sectionId) => (
        <div
          key={sectionId}
          className="today-segment"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', sectionId);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const sourceId = event.dataTransfer.getData('text/plain') || sectionId;
            handleReorderSection(sourceId, sectionId);
          }}
        >
          <div className="section-drag-header">
            <span className="drag-indicator" aria-label="Drag to reorder section">⋮⋮</span>
          </div>
          {renderSectionContent(sectionId)}
        </div>
      ))}
    </>
  );
}

/* ---------------- Rooms ---------------- */
function Rooms({ db, d, today, reload, residentId }) {
  const [edit, setEdit] = useState(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!residentId) {
      setEdit(null);
      return;
    }
    const resident = db.people.find((x) => String(x.id) === String(residentId));
    if (resident) setEdit({ type: 'person', data: resident });
    else setEdit(null);
  }, [db.people, residentId]);
  const done = () => { setEdit(null); reload(); if (residentId) navigate('/rooms', { replace: true }); };
  if (edit?.type === 'house') return <HouseForm p={edit.data} done={done} />;
  if (edit?.type === 'room') return <RoomForm room={edit.data} d={d} done={done} />;
  if (edit?.type === 'person') return <PersonForm person={edit.data} db={db} done={done} />;
  if (edit?.type === 'checkout') return <CheckoutForm person={edit.data} today={today} done={done} />;
  const past = d.people.filter((p) => !L.isActive(p, today)).sort((a, b) => (b.end_date > a.end_date ? 1 : -1));
  return (
    <>
      <div className="between screen-heading"><h1>Rooms & residents</h1><div className="screen-actions"><button className="small" onClick={() => setEdit({ type: 'house', data: { name: '', lease_rent: '', lease_anchor: today, lease_start: today, lease_end: '', lease_first_amount: '', electricity_cap: 800 } })}>+ Property</button><button className="small" onClick={() => setEdit({ type: 'person', data: { property_id: db.properties[0]?.id, room_id: '', stay_type: 'long', start_date: today } })}>+ Check in</button></div></div>
      {[...db.properties].sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
        <section key={p.id} className="property-group">
          <h2><button className="link" onClick={() => setEdit({ type: 'house', data: p })}>{p.name} ⚙︎</button></h2>
          {sortRoomsByRentUrgency(
            db.rooms.filter((r) => r.property_id === p.id),
            d.people,
          ).map((r) => {
            const assigned = d.people.filter((x) => x.room_id === r.id && L.isActive(x, today));
            const occ = sortPeopleByRentUrgency(assigned.filter((x) => x.start_date <= today));
            const future = assigned.filter((x) => x.start_date > today);
            const owed = sum(assigned.filter((x) => x.start_date <= today), (x) => x.owed);
            return (
              <div className="card" key={r.id}>
                <div className="between">
                  <button className="link" onClick={() => setEdit({ type: 'room', data: r })}>{r.label} · {occ.length}/{r.capacity}{future.length ? ` · ${future.length} booked` : ''}</button>
                  <span>{fmt(sum(occ.filter((x) => x.stay_type === 'long'), (x) => x.weekly_rate))}/wk{owed > 0 && <span className="err"> · {fmt(owed)} owed</span>}</span>
                </div>
                {occ.map((x) => {
                  const bondStatus = normaliseBondStatus(x.bond_status || 'not_paid');
                  const bondToneClass = bondStatus === 'paid' ? 'bond-status-paid' : bondStatus === 'not_paid' ? 'bond-status-not-paid' : 'bond-status-other';
                  return (
                    <div className="row resident-row" key={x.id}>
                      <button className="resident-row-main" onClick={() => navigate(`/rooms/${x.id}`)}>
                        <span>{x.name}<small>{x.stay_type === 'short' ? `${fmt(x.nightly_rate)}/night` : `${fmt(x.weekly_rate)}/wk`} · checked in {nice(x.start_date)} · bond received {fmt(x.bond_paid)} / {fmt(x.bond)} expected · bond <span className={bondToneClass}>{bondStatusLabel(x.bond_status)}</span></small>{(x.phone || x.email) && <small>{[x.phone, x.email].filter(Boolean).join(' · ')}</small>}</span>
                        {x.owed > 0 ? <b className="err">{fmt(x.owed)} owed</b> : x.credit > 0 ? <small className="ok">{fmt(x.credit)} credit</small> : null}
                      </button>
                      <button className="small checkout-button" onClick={() => setEdit({ type: 'checkout', data: x })}>Check out</button>
                    </div>
                  );
                })}
                {future.map((x) => {
                  const bondStatus = normaliseBondStatus(x.bond_status || 'not_paid');
                  const bondToneClass = bondStatus === 'paid' ? 'bond-status-paid' : bondStatus === 'not_paid' ? 'bond-status-not-paid' : 'bond-status-other';
                  return (
                    <button className="row" key={x.id} onClick={() => navigate(`/rooms/${x.id}`)}>
                      <span>{x.name}<small>Arrives {nice(x.start_date)} · {x.stay_type === 'short' ? `${fmt(x.nightly_rate)}/night` : `${fmt(x.weekly_rate)}/wk`} · bond <span className={bondToneClass}>{bondStatusLabel(x.bond_status)}</span></small></span>
                      <small className="muted">Booked</small>
                    </button>
                  );
                })}
                {occ.length + future.length < r.capacity && <button className="small" onClick={() => setEdit({ type: 'person', data: { property_id: p.id, room_id: r.id, stay_type: 'long', start_date: today, bond_status: 'held' } })}>+ Check in</button>}
              </div>
            );
          })}
          <button className="small" onClick={() => setEdit({ type: 'room', data: { property_id: p.id, label: '', capacity: 1, sort: 99 } })}>+ Add room</button>
        </section>
      ))}
      {past.length > 0 && <><h2>Past residents</h2>{past.map((x) => (
        <button className="row" key={x.id} onClick={() => setEdit({ type: 'person', data: x })}>
          <span>{x.name}<small>{d.props[x.property_id]?.name} · checked in {nice(x.start_date)} · checked out {nice(x.end_date)} · bond received {fmt(x.bond_paid)}, held {fmt(x.bond_held)}</small>{(x.phone || x.email) && <small>{[x.phone, x.email].filter(Boolean).join(' · ')}</small>}</span>
          {x.owed > 0 && <b className="err">{fmt(x.owed)}</b>}
        </button>))}</>}
    </>
  );
}

const nn = (v) => (v === '' || v === undefined ? null : v);
const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : +v);

function HouseForm({ p, done }) {
  const [f, setF] = useState({ name: p.name ?? '', lease_rent: p.lease_rent ?? '', lease_anchor: p.lease_anchor ?? '', lease_start: p.lease_start ?? '', lease_end: p.lease_end ?? '', lease_first_amount: p.lease_first_amount ?? '', electricity_cap: p.electricity_cap ?? 800, bills_amount: p.bills_amount ?? 0, bills_frequency: p.bills_frequency ?? 'monthly' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const ok = await save('properties', { name: f.name.trim(), lease_rent: +f.lease_rent, lease_anchor: f.lease_anchor, lease_start: nn(f.lease_start), lease_end: nn(f.lease_end), lease_first_amount: numOrNull(f.lease_first_amount), electricity_cap: +f.electricity_cap, bills_amount: +f.bills_amount || 0, bills_frequency: f.bills_frequency || 'monthly' }, p.id);
      if (ok) done();
    }}>
      <h1>{p.id ? `${p.name} settings` : 'Add property'}</h1>
      <label>Name</label><input value={f.name} onChange={set('name')} required />
      <label>Landlord rent per fortnight</label><input type="number" min="0.01" step="0.01" inputMode="decimal" value={f.lease_rent} onChange={set('lease_rent')} required />
      <label>A date landlord rent falls due (cycle runs every 14 days from it)</label><input type="date" value={f.lease_anchor} onChange={set('lease_anchor')} required />
      <label>{p.id ? 'Lease start (blank = before 1 Jul 2026)' : 'Lease start'}</label><input type="date" value={f.lease_start} onChange={set('lease_start')} required={!p.id} />
      <label>Lease end date (optional, for renewal reminders)</label><input type="date" value={f.lease_end} onChange={set('lease_end')} />
      <label>First landlord payment override (blank = automatic)</label><input type="number" min="0" step="0.01" inputMode="decimal" value={f.lease_first_amount} onChange={set('lease_first_amount')} />
      <label>Quarterly electricity cap</label><input type="number" min="0" step="0.01" inputMode="decimal" value={f.electricity_cap} onChange={set('electricity_cap')} required />
      <label>Bills amount</label><input type="number" min="0" step="0.01" inputMode="decimal" value={f.bills_amount} onChange={set('bills_amount')} placeholder="0.00" />
      <label>Bills cycle</label>
      <select value={f.bills_frequency} onChange={set('bills_frequency')}>
        <option value="monthly">Monthly</option>
        <option value="yearly">Yearly</option>
      </select>
      <button className="primary">{p.id ? 'Save property settings' : 'Add property'}</button>
      {p.id && <button type="button" className="small err" onClick={async () => { if (window.prompt(`Permanently delete ${p.name} and all linked records? Type DELETE ${p.name} to confirm:`) === `DELETE ${p.name}`) { const ok = await deleteRow('properties', p.id); if (ok) done(); } }}>Delete property</button>}
      <button type="button" className="small" onClick={done}>Cancel</button>
    </form>
  );
}

function RoomForm({ room, d, done }) {
  const [label, setLabel] = useState(room.label);
  const [cap, setCap] = useState(room.capacity);
  const occupied = room.id && d.people.some((p) => p.room_id === room.id);
  const scheduled = room.id ? d.people.filter((p) => p.room_id === room.id && (!p.end_date || p.end_date > L.todayStr())) : [];
  const peak = Math.max(0, ...scheduled.map((p) => {
    const day = p.start_date < L.todayStr() ? L.todayStr() : p.start_date;
    return scheduled.filter((x) => x.start_date <= day && (!x.end_date || x.end_date > day)).length;
  }));
  const capacityError = +cap < peak ? `This room has ${peak} overlapping current or future resident(s). Capacity cannot be reduced below that.` : '';
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const ok = await save('rooms', { property_id: room.property_id, label, capacity: +cap, sort: room.sort ?? 99 }, room.id);
      if (ok) done();
    }}>
      <h1>{room.id ? room.label : 'New room'}</h1>
      <label>Label</label><input value={label} onChange={(e) => setLabel(e.target.value)} required />
      <label>Capacity (people)</label>
      <div className="seg">{[1, 2, 3].map((n) => <button type="button" key={n} className={+cap === n ? 'on' : ''} onClick={() => setCap(n)}>{n}</button>)}</div>
      {capacityError && <p className="err">{capacityError}</p>}
      <button className="primary" disabled={Boolean(capacityError)}>Save room</button>
      {room.id && !occupied && <button type="button" className="small err" onClick={async () => { if (confirm('Delete this room?')) { const ok = await deleteRow('rooms', room.id); if (ok) done(); } }}>Delete room</button>}
      <button type="button" className="small" onClick={done}>Cancel</button>
    </form>
  );
}

function CheckoutForm({ person, today, done }) {
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  return <form onSubmit={async (e) => {
    e.preventDefault();
    setBusy(true);
    const ok = await save('people', { end_date: date }, person.id, `checked out ${person.name} on ${date}`);
    setBusy(false);
    if (ok) done();
  }}>
    <h1>Check out {person.name}</h1>
    <p className="muted">Checked in {nice(person.start_date)}. The checkout date is stored on the resident record and rent is charged up to the day before checkout.</p>
    <label>Checkout date</label><input type="date" min={person.start_date} value={date} onChange={(e) => setDate(e.target.value)} required />
    <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Confirm checkout'}</button>
    <button type="button" className="small" onClick={done}>Cancel</button>
  </form>;
}

const PF = ['name', 'phone', 'email', 'property_id', 'room_id', 'stay_type', 'weekly_rate', 'nightly_rate', 'start_date', 'end_date', 'paid_up_to', 'opening_balance', 'first_charge_amount', 'bond', 'bond_status', 'document_url', 'document_notes'];
const NUM = ['weekly_rate', 'nightly_rate', 'opening_balance', 'first_charge_amount', 'bond'];

function normaliseBondStatus(value) {
  if (!value || value === 'held') return 'paid';
  if (value === 'not_paid') return 'not_paid';
  return value;
}

function PersonForm({ person, db, done }) {
  const [f, setF] = useState(() => {
    const initial = Object.fromEntries(PF.map((k) => [k, person[k] ?? '']));
    initial.bond_status = normaliseBondStatus(person.bond_status || initial.bond_status || 'not_paid');
    initial.document_url = person.document_url || '';
    initial.document_notes = person.document_notes || '';
    return initial;
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const prop = db.properties.find((p) => p.id === f.property_id);
  const rooms = db.rooms.map((r) => ({ ...r, house: db.properties.find((p) => p.id === r.property_id)?.name })).sort((a, b) => (a.house + a.sort).localeCompare(b.house + b.sort));
  const long = f.stay_type === 'long';
  const nightly = f.stay_type === 'short' || f.stay_type === 'per_night';
  const prop1 = long && prop && +f.weekly_rate > 0 && f.start_date >= L.LEDGER_START && !f.paid_up_to ? L.proposeFirstCharge(+f.weekly_rate, f.start_date, prop.lease_anchor) : null;
  const checkInError = (() => {
    if (!f.room_id || !f.start_date) return '';
    const room = db.rooms.find((r) => r.id === f.room_id);
    if (!room) return 'Choose a valid room.';
    const end = f.end_date || '9999-12-31';
    const residents = db.people.filter((p) => p.room_id === f.room_id && p.id !== person.id && p.start_date < end && (!p.end_date || p.end_date > f.start_date));
    const checkpoints = [f.start_date, ...residents.map((p) => p.start_date).filter((s) => s >= f.start_date && s < end)];
    return checkpoints.some((day) => residents.filter((p) => p.start_date <= day && (!p.end_date || p.end_date > day)).length >= room.capacity)
      ? `${room.label} is at capacity during these dates. Choose another room or date.` : '';
  })();

  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (checkInError) return;
      const row = {};
      for (const k of PF) row[k] = NUM.includes(k) ? numOrNull(f[k]) : nn(f[k]);
      row.opening_balance ??= 0;
      row.bond ??= 0;
      row.bond_status = normaliseBondStatus(row.bond_status || 'not_paid');
      row.document_url = row.document_url || null;
      row.document_notes = row.document_notes || null;
      const ok = await save('people', row, person.id);
      if (ok) done();
    }}>
      <h1>{person.id ? person.name : 'New resident'}</h1>
      <label>Name</label><input value={f.name} onChange={set('name')} required />
      <label>Phone</label><input type="tel" value={f.phone} onChange={set('phone')} />
      <label>Email</label><input type="email" value={f.email || ''} onChange={set('email')} placeholder="tenant@example.com" />
      <label>Room</label>
      <select value={f.room_id || ''} onChange={(e) => { const r = db.rooms.find((x) => x.id === e.target.value); setF({ ...f, room_id: e.target.value, property_id: r?.property_id ?? f.property_id }); }} required>
        <option value="">Choose a room</option>
        {rooms.map((r) => <option key={r.id} value={r.id}>{r.house} – {r.label}</option>)}
      </select>
      <label>Stay</label>
      <div className="seg">
        <button type="button" className={long ? 'on' : ''} onClick={() => setF({ ...f, stay_type: 'long' })}>Long term</button>
        <button type="button" className={f.stay_type === 'short' ? 'on' : ''} onClick={() => setF({ ...f, stay_type: 'short' })}>Short term</button>
        <button type="button" className={f.stay_type === 'per_night' ? 'on' : ''} onClick={() => setF({ ...f, stay_type: 'per_night' })}>Per night</button>
      </div>
      {long ? <><label>Weekly rent</label><input type="number" min="0.01" step="0.01" inputMode="decimal" value={f.weekly_rate} onChange={set('weekly_rate')} required /></>
        : <><label>Nightly rate</label><input type="number" min="0.01" step="0.01" inputMode="decimal" value={f.nightly_rate} onChange={set('nightly_rate')} required /></>}
      <label>Move-in date</label><input type="date" value={f.start_date} onChange={set('start_date')} required />
      <label>{long ? 'Move-out date (blank while resident)' : 'Check-out date'}</label><input type="date" min={dayAfter(f.start_date)} value={f.end_date} onChange={set('end_date')} required={!long} />
      {!long && f.start_date && f.end_date && f.end_date <= f.start_date && <p className="err">Check-out must be after check-in.</p>}
      <label>Paid up to (existing residents — charges start the day after)</label><input type="date" value={f.paid_up_to} onChange={set('paid_up_to')} />
      {prop1 && prop1.days > 0 && (
        <p className="muted">Part period: {prop1.days} day(s) to {nice(prop1.nextCycle)} = {fmt(prop1.exact)}, proposed <b>{fmt(prop1.proposed)}</b>.{' '}
          <button type="button" className="link" onClick={() => setF({ ...f, first_charge_amount: prop1.proposed })}>Use {fmt(prop1.proposed)}</button></p>
      )}
      <label>Bond expected</label><input type="number" min="0" step="0.01" inputMode="decimal" value={f.bond} onChange={set('bond')} placeholder={long && f.weekly_rate ? `usually ${fmt(f.weekly_rate * 2)}` : ''} />
      <label>Bond status</label>
      <select value={f.bond_status || 'not_paid'} onChange={set('bond_status')}>
        <option value="not_paid">Not paid</option>
        <option value="paid">Paid</option>
        <option value="refunded">Refunded</option>
        <option value="deducted">Deducted</option>
      </select>
      <label>Document URL</label>
      <input type="url" value={f.document_url || ''} onChange={(e) => setF({ ...f, document_url: e.target.value })} placeholder="https://... or document link" />
      <label>Document notes</label>
      <textarea rows="3" value={f.document_notes || ''} onChange={(e) => setF({ ...f, document_notes: e.target.value })} placeholder="Resident document notes or reference details" />
      <small className="muted">Record each bond receipt, refund or retained amount in Rent so the cash and bond liability reconcile.</small>
      {person.id && <p className="muted">Bond recorded: {fmt(person.bond_paid || 0)} received · {fmt(person.bond_held || 0)} still held. Record refunds or retained amounts in Rent.</p>}
      {checkInError && <p className="err">{checkInError}</p>}
      <button className="primary" disabled={Boolean(checkInError)}>{person.id ? 'Save resident details' : 'Confirm check in'}</button>
      <button type="button" className="small" onClick={done}>Cancel</button>
    </form>
  );
}

/* ---------------- Rent ---------------- */
function Rent({ db, d, today, payFor, reload }) {
  const people = [...d.people].sort((a, b) => a.name.localeCompare(b.name));
  const [pid, setPid] = useState(payFor || '');
  const person = d.people.find((p) => p.id === pid);
  const [amount, setAmount] = useState(person?.owed ? person.owed : '');
  const [kind, setKind] = useState('rent');
  const [method, setMethod] = useState('cash');
  const [by, setBy] = useState(getLocalActor() || localStorage.getItem('receivedBy') || TEAM[0]);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [paymentPage, setPaymentPage] = useState(0);
  const paymentPageSize = 25;
  const sortedPayments = [...db.payments].sort((a, b) => ((b.date || '') + (b.created_at || '')).localeCompare((a.date || '') + (a.created_at || '')));
  const paymentPages = Math.max(1, Math.ceil(sortedPayments.length / paymentPageSize));
  const currentPaymentPage = Math.min(paymentPage, paymentPages - 1);
  const recent = sortedPayments.slice(currentPaymentPage * paymentPageSize, (currentPaymentPage + 1) * paymentPageSize);
  const fortnightStart = L.n2d(L.d2n(today) - 13);
  const rentReceivedFortnight = sum(db.payments.filter((p) => (!p.kind || p.kind === 'rent') && p.date >= fortnightStart && p.date <= today), (p) => p.amount);
  const originalPayment = db.payments.find((p) => p.id === editingId);
  const availableBond = person ? person.bond_held + (['bond_refund','bond_deducted'].includes(originalPayment?.kind) && originalPayment.person_id === person.id ? +originalPayment.amount : 0) : 0;
  const paymentError = ['bond_refund','bond_deducted'].includes(kind) && +amount > availableBond ? `This exceeds the recorded bond balance (${fmt(availableBond)} available).` : '';
  const paymentPeople = people.filter((p) => p.id === pid || (kind === 'rent' ? L.isActive(p, today) || p.owed > 0 : kind === 'bond' ? L.isActive(p, today) || p.bond_due > 0 : p.bond_held > 0));

  return (
    <>
      <div className="hero rent-summary"><small>Rent collected in the last 14 days</small><b>{fmt(rentReceivedFortnight)}</b><small>Bonds are recorded separately and excluded.</small></div>
      <form onSubmit={async (e) => {
        e.preventDefault();
        if (!person || !(+amount > 0) || paymentError) return;
        setBusy(true);
        const row = { person_id: person.id, property_id: person.property_id, date, amount: L.money(amount), method, received_by: by, kind, note: nn(note) };
        const possibleDuplicate = !editingId && findPossibleDuplicatePayment(db.payments, row, editingId);
        if (possibleDuplicate && !window.confirm('A matching payment already exists for this resident, date, amount and method. Record another payment anyway?')) { setBusy(false); return; }
        const ok = await save('payments', row, editingId, `${editingId ? 'updated' : 'recorded'} ${kind.replace('_', ' ')} payment for ${person.name} (${fmt(amount)})`);
        setBusy(false);
        if (ok) {
          localStorage.setItem('receivedBy', by);
          if (!editingId) setReceipt({ ...row, name: person.name });
          setEditingId(null); setKind('rent'); setNote(''); setPid(''); setAmount('');
          reload();
        }
      }}>
        <h1>{editingId ? 'Edit payment' : 'Record payment'}</h1>
        <label>Transaction type</label><div className="seg payment-types">{[['rent','Rent'],['bond','Bond received'],['bond_refund','Bond refunded'],['bond_deducted','Bond retained']].map(([key, label]) => <button type="button" key={key} className={kind === key ? 'on' : ''} onClick={() => { setKind(key); if (key === 'bond_deducted') setMethod('adjustment'); else if (method === 'adjustment') setMethod('cash'); if (person) setAmount(String(key === 'rent' ? person.owed : key === 'bond' ? person.bond_due : person.bond_held)); }}>{label}</button>)}</div>
        <label>Resident</label>
        <select value={pid} onChange={(e) => { setPid(e.target.value); const p = d.people.find((x) => x.id === e.target.value); setAmount(p ? String(kind === 'rent' ? p.owed : kind === 'bond' ? p.bond_due : p.bond_held) : ''); setReceipt(null); }} required>
          <option value="">Choose…</option>
          {paymentPeople.map((p) => <option key={p.id} value={p.id}>{p.name} — {d.props[p.property_id]?.name}{kind === 'rent' && p.owed > 0 ? ` (owes ${fmt(p.owed)})` : kind === 'bond' ? ` (bond due ${fmt(p.bond_due)})` : ''}</option>)}
        </select>
        <label>Amount</label><input type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        {kind === 'bond_deducted' ? <p className="muted">This settles part of the bond liability; it is not a cash receipt or operating income.</p> : <><label>Method</label>
        <div className="seg">{['cash', 'transfer'].map((m) => <button type="button" key={m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>{m}</button>)}</div></>}
        <label>{kind === 'bond_deducted' ? 'Handled by' : 'Received by'}</label>
        <div className="seg">{TEAM.map((t) => <button type="button" key={t} className={by === t ? 'on' : ''} onClick={() => setBy(t)}>{t}</button>)}</div>
        <label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <label>Note</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional reference" />
        {paymentError && <p className="err">{paymentError}</p>}
        <button className="primary" disabled={busy || Boolean(paymentError)}>{busy ? 'Saving…' : editingId ? 'Save payment changes' : 'Record payment'}</button>
        {editingId && <button type="button" className="small" onClick={() => { setEditingId(null); setKind('rent'); setPid(''); setAmount(''); setNote(''); }}>Cancel edit</button>}
      </form>
      {receipt && <div className="receipt"><b>Receipt</b><br />{receipt.name}: {receipt.kind === 'bond' ? 'bond received' : receipt.kind === 'bond_refund' ? 'bond refunded' : receipt.kind === 'bond_deducted' ? 'bond retained' : 'rent received'} {fmt(receipt.amount)} on {nice(receipt.date)}{receipt.method !== 'adjustment' ? ` by ${receipt.method}` : ''}, handled by {receipt.received_by}.</div>}
      <h2>Payment history</h2>
      <p className="muted">Showing {recent.length} of {sortedPayments.length} transactions.</p>
      {recent.map((p) => {
        const who = d.people.find((x) => x.id === p.person_id);
        const label = { rent: 'Rent', bond: 'Bond received', bond_refund: 'Bond refunded', bond_deducted: 'Bond retained' }[p.kind || 'rent'];
        return <div className="row" key={p.id}><span>{who?.name}<small>{label} · {nice(p.date)} · {p.method} · {p.received_by}{p.note ? ` · ${p.note}` : ''}</small></span><span><b>{fmt(p.amount)}</b><button type="button" className="small" onClick={() => { setEditingId(p.id); setPid(p.person_id); setAmount(String(p.amount)); setKind(p.kind || 'rent'); setMethod(p.method || 'cash'); setBy(p.received_by || TEAM[0]); setDate(p.date); setNote(p.note || ''); setReceipt(null); window.scrollTo(0,0); }}>Edit</button><button type="button" className="small" onClick={async () => { if (window.prompt('Deleting a financial transaction changes resident balances. Type DELETE to confirm:') === 'DELETE') { const ok = await deleteRow('payments', p.id); if (ok) reload(); if (editingId === p.id) setEditingId(null); } }}>Delete</button></span></div>;
      })}

      <nav aria-label="Payment history pages" className="between"><button type="button" className="small" disabled={currentPaymentPage===0} onClick={()=>setPaymentPage(p=>Math.max(0,p-1))}>Previous</button><span>Page {currentPaymentPage+1} of {paymentPages}</span><button type="button" className="small" disabled={currentPaymentPage>=paymentPages-1} onClick={()=>setPaymentPage(p=>Math.min(paymentPages-1,p+1))}>Next</button></nav>    </>
  );
}

/* ---------------- Expenses ---------------- */
function Expenses({ db, d, today, reload, payFor }) {
  const [mode, setMode] = useState('list');
  useEffect(() => { if (payFor === 'maintenance') setMode('maintenance'); }, [payFor]);
  const blank = { date: today, category: 'Cleaning', amount: '', property_id: '', note: '', paid_from: 'business', reimbursed: false };
  const [f, setF] = useState(blank);
  const [editingId, setEditingId] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  if (mode === 'elec') return <ElecBill db={db} d={d} today={today} done={() => { setMode('list'); reload(); }} />;
  if (mode === 'maintenance') return <Maintenance db={db} today={today} reload={reload} onBack={() => setMode('list')} />;
  const personal = db.expenses.filter((e) => e.paid_from === 'personal' && !e.reimbursed);
  const recent = [...db.expenses].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  const house = (id) => db.properties.find((p) => p.id === id)?.name || 'Whole business';
  return (
    <>
      <div className="seg section-switch" aria-label="Expenses and repairs">
        <button type="button" className="on">Expenses</button>
        <button type="button" onClick={() => setMode('maintenance')}>Repairs{db.maintenance?.filter((job) => job.status !== 'complete').length ? ` · ${db.maintenance.filter((job) => job.status !== 'complete').length}` : ''}</button>
      </div>
      <button className="primary" onClick={() => setMode('elec')}>Enter quarterly electricity bill</button>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const row = { ...f, amount: +f.amount, property_id: nn(f.property_id), reimbursed: f.paid_from === 'personal' ? f.reimbursed : false };
        const ok = await save('expenses', row, editingId, `${editingId ? 'updated' : 'added'} ${f.category} expense ${fmt(f.amount)}`);
        if (ok) { setF({ ...blank, category: f.category, property_id: f.property_id }); setEditingId(null); reload(); }
      }}>
        <h1>{editingId ? 'Edit expense' : 'Add expense'}</h1>
        <label>Category</label>
        <select value={f.category} onChange={set('category')}>
          {Object.entries(CATS).map(([g, cs]) => <optgroup key={g} label={g}>{cs.filter((c) => c !== 'Landlord rent').map((c) => <option key={c}>{c}</option>)}</optgroup>)}
        </select>
        <label>Amount</label><input type="number" min="0.01" step="0.01" inputMode="decimal" value={f.amount} onChange={set('amount')} required />
        <label>House</label>
        <select value={f.property_id} onChange={set('property_id')}><option value="">Whole business</option>{db.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <label>Note</label><input value={f.note} onChange={set('note')} />
        <label>Date</label><input type="date" value={f.date} onChange={set('date')} required />
        <label>Paid from</label>
        <div className="seg">{['business', 'personal'].map((m) => <button type="button" key={m} className={f.paid_from === m ? 'on' : ''} onClick={() => setF({ ...f, paid_from: m })}>{m}</button>)}</div>
        {f.paid_from === 'personal' && <label><input type="checkbox" style={{ width: 'auto' }} checked={f.reimbursed} onChange={(e) => setF({ ...f, reimbursed: e.target.checked })} /> Already reimbursed</label>}
        <button className="primary">{editingId ? 'Save expense changes' : 'Add expense'}</button>
        {editingId && <button type="button" className="small" onClick={() => { setEditingId(null); setF(blank); }}>Cancel edit</button>}
      </form>
      <h2>Unreimbursed personal spending</h2>
      <div className="card between"><span>{personal.length} item(s)</span><b>{fmt(sum(personal, (e) => e.amount))}</b></div>
      {personal.map((e) => <div className="row" key={e.id}><span>{e.category} · {house(e.property_id)}<small>{nice(e.date)} {e.note}</small></span><button className="small" onClick={async () => { await save('expenses', { reimbursed: true }, e.id); reload(); }}>Mark reimbursed {fmt(e.amount)}</button></div>)}
      <h2>Recent expenses</h2>
      <p className="muted">Landlord rent is raised automatically and appears in Reports.</p>
      {recent.map((e) => <div className="row" key={e.id}><span>{e.category} · {house(e.property_id)}<small>{nice(e.date)} {e.note}{e.paid_from === 'personal' ? ' · personal' : ''}</small></span><span><b>{fmt(e.amount)}</b> {e.category !== 'Electricity' && <><button type="button" className="small" onClick={() => { setEditingId(e.id); setF({ date: e.date, category: e.category, amount: String(e.amount), property_id: e.property_id || '', note: e.note || '', paid_from: e.paid_from || 'business', reimbursed: Boolean(e.reimbursed) }); window.scrollTo(0,0); }}>Edit</button> <button type="button" className="small" onClick={async () => { if (window.prompt('Deleting an expense changes financial reports. Type DELETE to confirm:') === 'DELETE') { const ok = await deleteRow('expenses', e.id); if (ok) reload(); } }}>Delete</button></>}{e.category === 'Electricity' && <small className="muted">linked bill</small>}</span></div>)}
    </>
  );
}

function Maintenance({ db, today, reload, onBack }) {
  const empty = { property_id: db.properties[0]?.id || '', room_id: '', title: '', details: '', priority: 'routine', status: 'reported', reported_date: today, due_date: '', contractor: '', contact: '' };
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('open');
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const rooms = db.rooms.filter((room) => room.property_id === form.property_id).sort((a, b) => a.sort - b.sort);
  const jobs = [...(db.maintenance || [])].sort((a, b) => (a.status === 'complete') - (b.status === 'complete') || (a.due_date || '9999-99-99').localeCompare(b.due_date || '9999-99-99') || b.reported_date.localeCompare(a.reported_date));
  const visible = filter === 'open' ? jobs.filter((job) => job.status !== 'complete') : jobs;
  const reset = () => { setForm(empty); setEditing(null); };
  return <>
    <div className="between screen-heading"><h1>Repairs & maintenance</h1><button className="small" onClick={onBack}>Back to expenses</button></div>
    <p className="muted">Track a repair from report to completion. Record any paid work separately under Expenses so it appears in profit reports.</p>
    <form onSubmit={async (e) => {
      e.preventDefault();
      const row = { ...form, property_id: form.property_id, room_id: form.room_id || null, due_date: form.due_date || null, contractor: form.contractor.trim(), contact: form.contact.trim(), title: form.title.trim(), details: form.details.trim(), completed_at: form.status === 'complete' ? (editing?.completed_at || new Date().toISOString()) : null };
      const ok = await save('maintenance', row, editing?.id, `${editing ? 'updated' : 'logged'} repair: ${row.title}`);
      if (ok) { reset(); reload(); }
    }}>
      <h2>{editing ? 'Update repair' : 'Log a repair'}</h2>
      <label>Property</label><select value={form.property_id} onChange={(e) => setForm({ ...form, property_id: e.target.value, room_id: '' })} required>{db.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <label>Room or shared area</label><select value={form.room_id} onChange={set('room_id')}><option value="">Shared area / whole property</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
      <label>What needs fixing?</label><input value={form.title} onChange={set('title')} maxLength="100" placeholder="e.g. Leaking kitchen tap" required />
      <label>Details</label><textarea rows="3" value={form.details} onChange={set('details')} placeholder="What happened, access notes, or next step" />
      <div className="form-grid">
        <div><label>Urgency</label><select value={form.priority} onChange={set('priority')}><option value="routine">Routine</option><option value="soon">Needs attention</option><option value="urgent">Urgent</option></select></div>
        <div><label>Status</label><select value={form.status} onChange={set('status')}><option value="reported">Reported</option><option value="booked">Booked</option><option value="waiting">Waiting</option><option value="complete">Complete</option></select></div>
      </div>
      <div className="form-grid">
        <div><label>Reported</label><input type="date" value={form.reported_date} onChange={set('reported_date')} required /></div>
        <div><label>Follow up by</label><input type="date" value={form.due_date || ''} onChange={set('due_date')} /></div>
      </div>
      <div className="form-grid">
        <div><label>Contractor / contact</label><input value={form.contractor} onChange={set('contractor')} placeholder="Name or business" /></div>
        <div><label>Phone</label><input type="tel" value={form.contact} onChange={set('contact')} /></div>
      </div>
      <button className="primary">{editing ? 'Save repair' : 'Add repair'}</button>{editing && <button type="button" className="small" onClick={reset}>Cancel</button>}
    </form>
    <div className="seg section-switch"><button type="button" className={filter === 'open' ? 'on' : ''} onClick={() => setFilter('open')}>Needs follow-up ({jobs.filter((job) => job.status !== 'complete').length})</button><button type="button" className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All repairs ({jobs.length})</button></div>
    {visible.length ? visible.map((job) => {
      const property = db.properties.find((p) => p.id === job.property_id)?.name || 'Property';
      const room = db.rooms.find((r) => r.id === job.room_id)?.label;
      const overdue = job.status !== 'complete' && job.due_date && job.due_date < today;
      return <article className={`maintenance-card ${job.status === 'complete' ? 'is-complete' : ''}`} key={job.id}>
        <div className="between"><div><strong>{job.title}</strong><small>{property}{room ? ` · ${room}` : ' · shared area'}</small></div><span className={`priority priority-${job.priority}`}>{job.priority === 'urgent' ? 'Urgent' : job.priority === 'soon' ? 'Soon' : 'Routine'}</span></div>
        {job.details && <p>{job.details}</p>}
        <div className="maintenance-meta"><span>{job.status === 'complete' ? 'Completed' : job.status[0].toUpperCase() + job.status.slice(1)} · reported {nice(job.reported_date)}</span>{job.due_date && <span className={overdue ? 'err' : ''}>{overdue ? 'Follow up overdue · ' : 'Follow up · '}{nice(job.due_date)}</span>}</div>
        {(job.contractor || job.contact) && <small className="muted">{[job.contractor, job.contact].filter(Boolean).join(' · ')}</small>}
        <div className="maintenance-actions"><button className="small" onClick={() => { setEditing(job); setForm({ ...empty, ...job, room_id: job.room_id || '', due_date: job.due_date || '' }); window.scrollTo(0, 0); }}>Edit</button>{job.status !== 'complete' && <button className="small" onClick={async () => { const ok = await save('maintenance', { status: 'complete', completed_at: new Date().toISOString() }, job.id, `completed repair: ${job.title}`); if (ok) reload(); }}>Mark complete</button>}<button className="small danger-link" onClick={async () => { if (confirm(`Delete repair “${job.title}”?`)) { const ok = await deleteRow('maintenance', job.id); if (ok) reload(); } }}>Delete</button></div>
      </article>;
    }) : <div className="card empty-state">{filter === 'open' ? 'No repairs need follow-up.' : 'No repairs logged yet.'}</div>}
  </>;
}

function ElecBill({ db, d, today, done }) {
  const [f, setF] = useState({ property_id: db.properties[0]?.id, bill_date: today, q_start: '', q_end: '', amount: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const prop = db.properties.find((p) => p.id === f.property_id);
  const ready = prop && f.q_start && f.q_end && f.q_start <= f.q_end && f.bill_date && +f.amount > 0;
  const split = ready ? L.electricitySplit({ amount: +f.amount, cap: prop.electricity_cap, qStart: f.q_start, qEnd: f.q_end, billDate: f.bill_date, people: d.people.filter((p) => p.property_id === prop.id) }) : null;
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (!split || f.q_start > f.q_end) return;
      const posted = await postElectricityBill({
        propertyId: prop.id,
        billDate: f.bill_date,
        qStart: f.q_start,
        qEnd: f.q_end,
        amount: +f.amount,
        shares: split.shares.map((s) => ({ personId: s.person.id, amount: s.amount, nights: s.nights, totalNights: split.totalNights })),
      });
      if (posted) done();
    }}>
      <h1>Quarterly electricity bill</h1>
      <label>House</label><select value={f.property_id} onChange={set('property_id')}>{db.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <label>Quarter start</label><input type="date" value={f.q_start} onChange={set('q_start')} required />
      <label>Quarter end</label><input type="date" value={f.q_end} onChange={set('q_end')} required />
      {f.q_start && f.q_end && f.q_start > f.q_end && <p className="err">Quarter end must be on or after quarter start.</p>}
      <label>Bill date</label><input type="date" value={f.bill_date} onChange={set('bill_date')} required />
      <label>Bill total</label><input type="number" min="0.01" step="0.01" inputMode="decimal" value={f.amount} onChange={set('amount')} required />
      {split && (
        <div className="card">
          <p>Cap {fmt(prop.electricity_cap)} · excess <b>{fmt(split.excess)}</b>. Full bill is recorded as an expense.</p>
          {split.excess > 0 ? (
            <table><thead><tr><th>Resident</th><th>Nights</th><th>Share</th></tr></thead>
              <tbody>{split.shares.map((s) => <tr key={s.person.id}><td>{s.person.name}</td><td>{s.nights}</td><td>{fmt(s.amount)}</td></tr>)}</tbody></table>
          ) : <p className="muted">Under the cap — nothing charged to residents.</p>}
        </div>
      )}
      <button className="primary" disabled={!split}>Post bill{split?.shares.length ? ` and ${split.shares.length} charge(s)` : ''}</button>
      <button type="button" className="small" onClick={done}>Cancel</button>
    </form>
  );
}

/* ---------------- Reports ---------------- */
function Reports({ db, d, today }) {
  const cur = L.fyEndYear(today);
  const years = []; for (let y = cur; y >= 2027; y--) years.push(y);
  const [fy, setFy] = useState(cur);
  const [rangeMode, setRangeMode] = useState('upcomingFortnight');
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
  const [customStart, setCustomStart] = useState(() => L.lastFortnightRange(today).start);
  const [customEnd, setCustomEnd] = useState(() => L.lastFortnightRange(today).end);
  const fyRange = L.fyRange(fy);
  const thisFortnight = L.thisFortnightRange(today);
  const lastFortnight = L.lastFortnightRange(today);
  const monthOptions = (() => {
    const start = new Date(2026, 6, 1);
    const end = new Date(`${today.slice(0, 4)}-${today.slice(5, 7)}-01`);
    const options = [];
    for (let cursor = new Date(end); cursor >= start; cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1)) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      options.push({ key, label: new Date(cursor.getFullYear(), cursor.getMonth(), 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }) });
    }
    return options;
  })();
  const rangeForProperty = (property, mode) => {
    if (mode === 'thisFortnight') return L.thisFortnightRangeForProperty(property);
    if (mode === 'lastFortnight') return L.lastFortnightRangeForProperty(property);
    if (mode === 'upcomingFortnight') return L.upcomingFortnightRangeForProperty(property, today);
    return { start: fyRange.start, end: fyRange.end };
  };
  const propertyRangeSummary = (mode) => {
    if (!db.properties.length) return { start: mode === 'lastFortnight' ? lastFortnight.start : mode === 'upcomingFortnight' ? L.upcomingFortnightRangeForProperty({ lease_anchor: today }, today).start : fyRange.start, end: mode === 'lastFortnight' ? lastFortnight.end : mode === 'upcomingFortnight' ? L.upcomingFortnightRangeForProperty({ lease_anchor: today }, today).end : fyRange.end };
    const ranges = db.properties.map((property) => rangeForProperty(property, mode));
    const starts = ranges.map((range) => range.start).filter(Boolean); 
    const ends = ranges.map((range) => range.end).filter(Boolean);
    return {
      start: starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : fyRange.start,
      end: ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : fyRange.end,
    };
  };
  const summaryRange = propertyRangeSummary(rangeMode);
  const monthStart = `${selectedMonth}-01`;
  const monthEndRaw = new Date(`${selectedMonth}-01T00:00:00Z`);
  const monthEnd = new Date(Date.UTC(monthEndRaw.getUTCFullYear(), monthEndRaw.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const start = rangeMode === 'custom' ? customStart : rangeMode === 'month' ? monthStart : rangeMode === 'lastFortnight' || rangeMode === 'upcomingFortnight' ? summaryRange.start : fyRange.start;
  const end = rangeMode === 'custom' ? customEnd : rangeMode === 'month' ? monthEnd : rangeMode === 'lastFortnight' || rangeMode === 'upcomingFortnight' ? summaryRange.end : fyRange.end;
  const label = rangeMode === 'custom' ? `${nice(start)} – ${nice(end)}` : rangeMode === 'month' ? `Monthly · ${new Date(`${selectedMonth}-01T00:00:00`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}` : rangeMode === 'lastFortnight' ? `Last fortnight · ${nice(start)} – ${nice(end)}` : rangeMode === 'upcomingFortnight' ? `Upcoming fortnight · ${nice(start)} – ${nice(end)}` : fyRange.label;
  const rangeError = !start || !end || start > end;
  const inR = (s) => s >= start && s <= end;
  const allPays = db.payments.filter((p) => inR(p.date) && p.date <= today);
  const pays = allPays.filter((p) => !p.kind || p.kind === 'rent');
  const bondReceipts = sum(allPays.filter((p) => p.kind === 'bond'), (p) => p.amount);
  const bondRefunds = sum(allPays.filter((p) => p.kind === 'bond_refund'), (p) => p.amount);
  const bondRetained = sum(allPays.filter((p) => p.kind === 'bond_deducted'), (p) => p.amount);
  const bondsHeld = sum(d.people, (p) => p.bond_held);
  const exps = d.expenses.filter((e) => inR(e.date) && e.date <= today);
  const charges = d.people.flatMap((person) => person.charges.map((charge) => ({ ...charge, property_id: person.property_id, name: person.name })));
  const earnedC = charges.filter((charge) => inR(charge.due_date) && charge.due_date <= today);

  const reportRows = [...db.properties].sort((a, b) => a.name.localeCompare(b.name)).map((property) => {
    const cycleRange = rangeMode === 'lastFortnight' ? L.lastFortnightRangeForProperty(property) : rangeMode === 'upcomingFortnight' ? L.upcomingFortnightRangeForProperty(property, today) : { start, end };
    const propertyStart = cycleRange.start;
    const propertyEnd = cycleRange.end;
    const residents = d.people.filter((person) => person.property_id === property.id);
    const expectedRent = sum(residents, (person) => L.defaultRentForPeriod(person, property, propertyStart, propertyEnd));
    const propertyPayments = db.payments.filter((payment) => {
      const person = d.people.find((candidate) => candidate.id === payment.person_id);
      const propertyMatches = payment.property_id === property.id || (person && person.property_id === property.id);
      const isRent = !payment.kind || payment.kind === 'rent';
      return propertyMatches && isRent && payment.date >= propertyStart && payment.date <= propertyEnd;
    });
    const propertyPaymentTotal = L.propertyCycleRentCollected(property, d.people, db.payments, propertyStart, propertyEnd);
    const actualRentCollected = propertyPayments.length > 0 ? propertyPaymentTotal : expectedRent;
    const landlordExpensesForCycle = L.landlordExpenses(property, propertyEnd).filter((expense) => expense.date >= propertyStart && expense.date <= propertyEnd);
    const landlordRent = landlordExpensesForCycle.length ? sum(landlordExpensesForCycle, (expense) => expense.amount) : (+property.lease_rent || 0);
    const otherCosts = sum(exps.filter((expense) => expense.property_id === property.id && expense.category !== 'Landlord rent' && expense.date >= propertyStart && expense.date <= propertyEnd), (expense) => expense.amount);
    const bills = L.propertyBillsForPeriod(property, propertyStart, propertyEnd);
    const net = L.money(actualRentCollected - landlordRent - bills - otherCosts);
    return {
      property,
      cycleRange,
      residents,
      expectedRent,
      actualRentCollected,
      landlordRent,
      bills,
      otherCosts,
      net,
    };
  });

  const totals = reportRows.reduce((acc, row) => {
    acc.expectedRent += row.expectedRent;
    acc.actualRentCollected += row.actualRentCollected;
    acc.landlordRent += row.landlordRent;
    acc.bills += row.bills;
    acc.otherCosts += row.otherCosts;
    acc.net += row.net;
    return acc;
  }, { expectedRent: 0, actualRentCollected: 0, landlordRent: 0, bills: 0, otherCosts: 0, net: 0 });

  const overhead = sum(exps.filter((e) => !e.property_id), (e) => e.amount);
  const byCat = Object.values(CATS).flat().map((c) => [c, sum(exps.filter((e) => e.category === c), (e) => e.amount)]).filter(([, v]) => v);

  const exportCsv = () => {
    const name = (id) => d.people.find((p) => p.id === id)?.name || '';
    const house = (id) => db.properties.find((p) => p.id === id)?.name || 'Whole business';
    const rows = [['type', 'date', 'house', 'resident', 'category', 'amount', 'method', 'received_by', 'note'],
      ...earnedC.map((c) => ['charge', c.due_date, house(c.property_id), c.name, c.kind, c.amount, '', '', c.note || '']),
      ...allPays.map((p) => ['payment', p.date, house(p.property_id), name(p.person_id), p.kind || 'rent', p.amount, p.method, p.received_by, p.note || '']),
      ...exps.map((e) => ['expense', e.date, house(e.property_id), '', e.category, e.amount, e.paid_from, '', e.note || ''])]
      .sort((a, b) => (a[1] < b[1] ? -1 : 1));
    const csvCell = (value) => {
      let text = String(value ?? '');
      if (typeof value === 'string' && /^[\s]*[=+@\-\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\n');
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.href = url;
    a.download = `sakan-${label.replace(/[^A-Za-z0-9-]/g, '-').replace(/-+/g, '-')}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      <TenantStatements db={db} today={today} />
      <section className="card">
        <h2>Property cash flow · {nice(start)} – {nice(end)}</h2>
        <p className="muted">Rent received less recorded expenses and scheduled landlord rent. Bond transactions are excluded. This is cash-flow reporting, not tax accounting.</p>
        {!rangeError && <div style={{overflowX:'auto'}}><table><thead><tr><th>Property</th><th>Rent received</th><th>Expenses</th><th>Net</th></tr></thead><tbody>
          {propertyProfitability(db, start, end).map(x => <tr key={x.property.id}><td>{x.property.name}</td><td>{fmt(x.rent)}</td><td>{fmt(x.expenses)}</td><td className={x.net < 0 ? 'err' : 'ok'}>{fmt(x.net)}</td></tr>)}
        </tbody></table></div>}
      </section>
      <h1 className="screen-title">Property reports</h1>
      <div className="report-controls">
        <div className="seg">{[['fy', 'Financial year'], ['month', 'Monthly'], ['lastFortnight', 'Last fortnight'], ['upcomingFortnight', 'Upcoming fortnight'], ['custom', 'Date range']].map(([key, title]) => <button type="button" key={key} className={rangeMode === key ? 'on' : ''} onClick={() => setRangeMode(key)}>{title}</button>)}</div>
        {rangeMode === 'fy' && <label>Financial year<select value={fy} onChange={(e) => setFy(+e.target.value)}>{years.map((year) => <option key={year} value={year}>{L.fyRange(year).label}</option>)}</select></label>}
        {rangeMode === 'month' && <label>Month<select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>{monthOptions.map((month) => <option key={month.key} value={month.key}>{month.label}</option>)}</select></label>}
        {rangeMode === 'custom' && <div className="custom-range"><label>From<input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} /></label><label>To<input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} /></label></div>}
      </div>
      {rangeError && <p className="err">Choose a valid report range. The start date must be on or before the end date.</p>}

      <div className="hero" style={{ marginTop: 12 }}>
        <small>Actual rent collected {label}</small>
        <b>{fmt(totals.actualRentCollected)}</b>
        <small>Expected rent {fmt(totals.expectedRent)} · landlord rent {fmt(totals.landlordRent)} · bills {fmt(totals.bills)} · other costs {fmt(totals.otherCosts)} · net {fmt(totals.net)}</small>
      </div>

      <table>
        <thead>
          <tr>
            <th>Property</th>
            <th>Cycle</th>
            {rangeMode !== 'upcomingFortnight' && <th>Rent collected</th>}
            <th>Landlord rent</th>
            {rangeMode !== 'upcomingFortnight' && <th>Profit / loss</th>}
          </tr>
        </thead>
        <tbody>
          {reportRows.map(({ property, cycleRange, actualRentCollected, landlordRent, net }) => (
            <tr key={property.id}>
              <td>{property.name}</td>
              <td>{nice(cycleRange.start)} – {nice(cycleRange.end)}</td>
              {rangeMode !== 'upcomingFortnight' && <td>{fmt(actualRentCollected)}</td>}
              <td>{fmt(landlordRent)}</td>
              {rangeMode !== 'upcomingFortnight' && <td className={net < 0 ? 'err' : 'ok'}><b>{fmt(net)}</b></td>}
            </tr>
          ))}
        </tbody>
      </table>

      <button className="primary" disabled={rangeError} onClick={exportCsv}>Export {label} transactions (CSV)</button>
    </>
  );
}

/* ---------------- Activity ---------------- */
function Activity({ db, session, reload }) {
  const backup = () => {
    try {
      const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sakan-ledger-backup-${L.todayStr()}.json`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      console.error('Backup export failed:', error);
      alert(error?.message || 'Could not export the backup.');
    }
  };
  const restore = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!confirm('Restore this backup? It will replace all data currently stored in this browser.')) { event.target.value = ''; return; }
    try {
      restoreLocalBackup(JSON.parse(await file.text()));
      await reload();
      alert('Backup restored.');
    } catch (error) {
      alert(error.message || 'Could not restore this backup.');
    }
    event.target.value = '';
  };
  return (
    <>
      <div className="between"><h1>Activity</h1>{!isLocalMode && <button className="small" onClick={() => signOut()}>Sign out {session.user.email}</button>}</div>
      {isLocalMode && <div className="card"><h2>Local data backup</h2><p className="muted">Keep a copy of this browser ledger somewhere safe. A backup contains resident contact details and financial records. Restoring replaces the current browser data.</p><div className="backup-actions"><button type="button" className="small" onClick={backup}>Download backup</button><label className="small">Restore backup<input type="file" accept="application/json,.json" onChange={restore} /></label></div></div>}
      {db.audit.map((a) => (
        <div className="card" key={a.id}><small className="muted">{new Date(a.at).toLocaleString('en-AU')} · {a.by}</small><div style={{ fontSize: 13, wordBreak: 'break-word' }}>{a.action}</div></div>
      ))}
    </>
  );
}
