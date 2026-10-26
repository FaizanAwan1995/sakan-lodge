import RoomPhotos from './features/rooms/RoomPhotos.jsx';
import {tenantDateError} from './tenant-dates.js';
import { RoomHistory } from './features/tenants/StayHistory.jsx';
import { historyMatches, roomResidents } from './stay-history.js';
import AccountPayment from './features/tenants/AccountPayment.jsx';
import AccountTransactions from './features/tenants/AccountTransactions.jsx';
import { residentStayOption, residentBillingRow } from './resident-billing.js';
import Reviews from './features/reviews/Reviews.jsx';
import TenantAccount from './features/tenants/TenantAccount.jsx';
import { tenantMatches, tenantReference, roomAtCapacity } from './tenant-model.js';
import ReservationActivity from './features/reservations/ReservationActivity.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { errorMessage } from './error-handling.js';
import FinancialReports from './features/reports/FinancialReports.jsx';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase, useStore, save, deleteRow, signOut, isLocalMode, postElectricityBill, getLocalActor, setLocalActor, restoreLocalBackup, updateTenantDetails } from './store.js';
import * as L from './ledger.js';
import { accountChoices, bondStatusLabel, reorderList, sortPeopleByRentUrgency, sortRoomsByRentUrgency, tabFromPath, visibleTodaySections } from './app-helpers.js';
import PropertyPulseList from './features/home/PropertyPulse.jsx';
import TenantCommunications from './features/communications/TenantCommunications.jsx';
import Reservations from './features/reservations/Reservations.jsx';

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
        <Route path="/reservations" element={<Main session={session} accountName={isLocalMode ? selectedUser : accountName} headerVisible={headerVisible} onSwitchLocal={() => { setLocalActor(null); setSelectedUser(null); navigate('/signin', { replace: true }); }} />} />
        <Route path="/communications" element={<Main session={session} accountName={isLocalMode ? selectedUser : accountName} headerVisible={headerVisible} onSwitchLocal={() => { setLocalActor(null); setSelectedUser(null); navigate("/signin", { replace: true }); }} />} />
        <Route path="/reviews" element={<Main session={session} accountName={isLocalMode ? selectedUser : accountName} headerVisible={headerVisible} onSwitchLocal={() => { setLocalActor(null); setSelectedUser(null); navigate("/signin", { replace: true }); }} />} />
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
  const [googleLoading, setGoogleLoading] = useState(false);

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
      <div className="login-divider" role="separator" aria-label="Alternative sign-in"><span>or continue with</span></div>
      <button className="google-signin" type="button" disabled={loading || googleLoading || isLocalMode} onClick={async () => {
        setErr('');
        setGoogleLoading(true);
        try {
          if (!supabase) throw new Error('Supabase is not configured.');
          const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: window.location.origin + '/ledger/home' },
          });
          if (error) throw error;
        } catch (error) {
          setErr(errorMessage(error));
          setGoogleLoading(false);
        }
      }}><svg className="google-g" aria-hidden="true" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.28 5.48-4.81 7.18l7.73 6C44.37 38.03 46.98 31.88 46.98 24.55z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.86 23.86 0 0 0 0 24c0 3.87.93 7.52 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.92-2.13 15.89-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg><span>{googleLoading ? 'Connecting to Google…' : 'Continue with Google'}</span></button>
      <p className="muted">Google sign-in must first be linked to your existing Sakan Lodge account. Sign in with your current password before connecting Google in account settings.</p>
      {err && <p className="err">{err}</p>}
      <button type="button" className="chooser-back" onClick={onBack}>Choose a different user</button>
    </form>
  );
}

function Main({ session, accountName, headerVisible, onSwitchLocal }) {
  const { db, error, reload, lastRefreshed, refreshing } = useStore(session);
  const location = useLocation();
  const navigate = useNavigate();
  const { residentId } = useParams();
  const [payFor, setPayFor] = useState(null);
  const [paymentTenant, setPaymentTenant] = useState(null);
  const [linkingGoogle, setLinkingGoogle] = useState(false);
  const [linkMessage, setLinkMessage] = useState('');
  const [today, setToday] = useState(L.todayStr);
  useEffect(() => {
    const refreshDay = () => setToday(L.todayStr());
    const timer = setInterval(refreshDay, 60000);
    window.addEventListener('focus', refreshDay);
    return () => { clearInterval(timer); window.removeEventListener('focus', refreshDay); };
  }, []);
  const d = useMemo(() => db && L.derive(db, today), [db, today]);
  useEffect(() => { if (d && location.state?.restoreScroll != null) requestAnimationFrame(() => window.scrollTo(0, location.state.restoreScroll)); }, [location.key, Boolean(d)]);
  const tab = tabFromPath(location.pathname);
  if (error) return <div className="pad err" role="alert"><h2>Unable to load Sakan Lodge</h2><p>{errorMessage(error)}</p><button type="button" onClick={reload}>Try again</button></div>;
  if (!d) return <div className="pad">Loading…</div>;
  const openTenant = (id) => { navigate(`/rooms/${id}`, {state:{from:location.pathname+location.search,scroll:window.scrollY}}); window.scrollTo(0,0); };
  const ctx = { db, d, today, reload, session, openTenant, quickPayment:setPaymentTenant, go: (t, pid) => {
    if(t==='rent' && pid) {setPaymentTenant(pid);return;}
    setPayFor(pid ?? null); const route = t === 'today' ? '/home' : t==='rent' ? '/reports?view=transactions' : `/${t}`;
    navigate(route); window.scrollTo(0, 0);
  } };
  const tabs = [['today', 'Home'], ['rooms', 'Rooms'], ['expenses', 'Expenses'], ['reports', 'Reports'], ['communications', 'Emails'], ['reservations', 'Reservations'], ['reviews', 'Reviews'], ['activity', 'Activity']];
  return (
    <>
      <a className="ledger-skip-link" href="#main-content">Skip to content</a>
      <header className={`topbar ${headerVisible ? 'visible' : 'hidden'}`}>
        <div className="topbar-inner">
          <div className="topbar-brand"><img className="brand-logo" src={LOGO} alt="SAKAN Lodge" /><span>SAKAN Lodge</span></div>
          <nav className="top-nav" aria-label="Ledger navigation">{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} aria-current={tab === k ? 'page' : undefined} onClick={() => ctx.go(k)}>{l}</button>)}</nav>
        </div>
      </header>
      <main className="pad" id="main-content" tabIndex="-1">
        <header className="app-header">
          <div className="app-brand"><div><strong>SAKAN Lodge</strong><small>Hospitality in its true sense</small><small className="brand-meta">{db.properties.length} properties · {db.people.filter((p) => p.start_date <= today && L.isActive(p, today)).length} residents</small><div className="account-switch"><span>Signed in as {accountName}</span>{isLocalMode ? <button type="button" onClick={onSwitchLocal}>Switch user</button> : <button type="button" onClick={signOut}>Switch user</button>}</div></div></div>
          <time>{nice(today)}</time>
        </header>
        {!isLocalMode && !session.user.identities?.some(identity => identity.provider === 'google') && <section aria-label="Google account connection" className="card google-link-card">
          <div className="google-link-info"><strong>Connect your Google account</strong><p className="muted">Link Google once to sign in faster next time. Your existing Sakan Lodge account and records stay the same.</p></div>
          <button className="google-link-action" type="button" disabled={linkingGoogle} onClick={async () => {
            setLinkingGoogle(true); setLinkMessage('');
            try {
              const { error } = await supabase.auth.linkIdentity({provider:'google',options:{redirectTo:window.location.origin+'/ledger/home'}});
              if (error) throw error;
            } catch(error) { setLinkMessage(errorMessage(error)); setLinkingGoogle(false); }
          }}>{linkingGoogle ? 'Connecting…' : 'Link Google account'}</button>
          {linkMessage && <p role="alert" className="err">{linkMessage}</p>}
        </section>}
        {isLocalMode && <div className="local-banner"><strong>Local preview</strong><span>Saved only in this browser · not synced or backed up</span></div>}
        {!isLocalMode && <div className="sync-status"><span>{refreshing ? 'Refreshing shared ledger…' : lastRefreshed ? `Shared data refreshed ${new Date(lastRefreshed).toLocaleTimeString('en-AU', {hour:'2-digit', minute:'2-digit'})}` : 'Loading shared ledger…'}</span><button type="button" className="small" disabled={refreshing} onClick={reload}>Refresh</button></div>}
        {tab === 'today' && <Today {...ctx} />}
        {tab === 'rooms' && <Rooms {...ctx} residentId={residentId || null} />}
        {tab === 'rent' && <Navigate to="/reports?view=transactions" replace />}
        {paymentTenant && d.people.some(p=>p.id===paymentTenant) && <AccountPayment key={paymentTenant} person={d.people.find(p=>p.id===paymentTenant)} db={db} today={today} reload={reload} onClose={()=>setPaymentTenant(null)} />}
        {tab === 'expenses' && <Expenses {...ctx} payFor={payFor} />}
        {tab === 'reports' && <Reports {...ctx} />}
        {tab === 'communications' && <TenantCommunications db={db} today={today} />}
        {tab === 'reservations' && <Reservations db={db} reload={reload} />}
        {tab === 'reviews' && <Reviews />}
        {tab === 'activity' && <Activity {...ctx} />}
      </main>
    </>
  );
}

/* ---------------- Today ---------------- */
function Today({ db, d, today, go, openTenant, quickPayment }) {
  const [tenantSearch,setTenantSearch]=useState(()=>sessionStorage.getItem('homeTenantSearch') || '');
  useEffect(()=>{sessionStorage.setItem('homeTenantSearch',tenantSearch);},[tenantSearch]);
  const behind = d.people.filter((p) => p.owed > 0.005).sort((a, b) => b.daysLate - a.daysLate || b.owed - a.owed);
  const bonds = sum(d.people, (p) => p.bond_held);
  const legacyBonds = sum(d.people, (p) => p.legacy_bond_declared);
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
  const arrivals = d.people.filter((p) => L.isActive(p, today) && p.start_date >= today && p.start_date <= next14).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const departures = d.people.filter((p) => !p.checked_out_at && p.end_date && p.end_date >= today && p.end_date <= next14).sort((a, b) => a.end_date.localeCompare(b.end_date));
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
              onSelectTenant={openTenant}
              onRecordPayment={quickPayment}
              onReorderProperty={handleReorderProperty}
            />
          </>
        );
      case 'balanceHero':
        return <div className="hero"><small>Resident balances outstanding</small><b>{fmt(sum(behind, (p) => p.owed))}</b><small>Includes rent and resident utility charges.</small></div>;
      case 'shortcuts':
        return <div className="today-shortcuts"><button onClick={() => document.getElementById('home-tenant-search')?.focus()}>Find tenant / record payment</button><button onClick={() => go('rooms')}>Manage rooms & residents</button><button onClick={() => go('expenses')}>Open expenses</button></div>;
      case 'attention':
        return (
          <>
            <h2>Needs attention</h2>
            {behind.length ? behind.map((p) => (
              <div className="tenant-action-row" key={p.id}>
                <button className="tenant-account-link" onClick={() => openTenant(p.id)}><span>{p.name}<small>{d.props[p.property_id]?.name} · {p.daysLate ? `${p.daysLate} day${p.daysLate > 1 ? 's' : ''} late` : 'due today'}</small></span><b className="err">{fmt(p.owed)}</b></button>
                <button className="small" onClick={() => quickPayment(p.id)}>Record payment</button>
              </div>
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
            <section className="schedule-card"><h2>Arrivals · next 14 days</h2>{arrivals.length ? arrivals.map((p) => <button className="row" key={p.id} onClick={()=>openTenant(p.id)}><span>{p.name}<small>{d.props[p.property_id]?.name} · {nice(p.start_date)} · {db.rooms.find((r) => r.id === p.room_id)?.label}</small></span></button>) : <p className="muted">No arrivals booked.</p>}</section>
            <section className="schedule-card"><h2>Departures · next 14 days</h2>{departures.length ? departures.map((p) => <button className="row" key={p.id} onClick={()=>openTenant(p.id)}><span>{p.name}<small>{d.props[p.property_id]?.name} · {nice(p.end_date)}</small></span></button>) : <p className="muted">No check-outs scheduled.</p>}</section>
          </div>
        );
      case 'bonds':
        return (
          <>
            <h2>Bonds held</h2>
            <div className="card between"><span>Bond balance from recorded transactions (not income)</span><b>{fmt(bonds)}</b></div>
            {legacyBonds > 0 && <p role="status">Legacy resident records also mark {fmt(legacyBonds)} of bonds as paid without matching receipt history. Reconcile that opening liability before treating the recorded balance as complete.</p>}
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
      <section className="card home-tenant-search"><label htmlFor="home-tenant-search">Find any tenant</label><input id="home-tenant-search" type="search" value={tenantSearch} onChange={e=>setTenantSearch(e.target.value)} placeholder="Name, phone, email or tenant ID" />
      <small>Includes current, upcoming and past tenants.</small>
      {tenantSearch.trim() && d.people.filter(p=>historyMatches(p,tenantSearch,db.audit)).map(p=><div className="tenant-action-row" key={p.id}><button className="tenant-account-link" onClick={()=>openTenant(p.id)}><span>{p.name}<small>{d.props[p.property_id]?.name} · {L.isActive(p,today)?p.start_date>today?'Upcoming':'Current':'Past tenant'} · In {p.start_date}{p.end_date ? ` · Out ${p.end_date}` : ''}</small></span><b>{fmt(p.owed || p.credit)} {p.credit?'credit':'due'}</b></button><button className="small" onClick={()=>quickPayment(p.id)}>Record payment</button></div>)}
      {tenantSearch.trim() && !d.people.some(p=>historyMatches(p,tenantSearch,db.audit)) && <p>No tenants found.</p>}
      </section>
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
function Rooms({ db, d, today, reload, residentId, go, openTenant }) {
  const location=useLocation();
  const [edit, setEdit] = useState(null);
  const navigate = useNavigate();
  useEffect(() => { setEdit(null); }, [residentId]);
  const [query, setQuery] = useState(()=>sessionStorage.getItem('roomTenantSearch') || '');
  const [status, setStatus] = useState(()=>sessionStorage.getItem('roomTenantStatus') || 'Active');
  useEffect(()=>{sessionStorage.setItem('roomTenantSearch',query);sessionStorage.setItem('roomTenantStatus',status);},[query,status]);
  const selected = residentId ? d.people.find(person => person.id === residentId) : null;
  const done = () => { setEdit(null); reload(); };
  const back = () => { setEdit(null); navigate(location.state?.from || '/rooms',{state:{restoreScroll:location.state?.scroll || 0}}); };
  if (residentId && !selected) return <section className="card"><h1>Tenant unavailable</h1><p>This record was removed or is no longer accessible. The activity history is retained.</p><button onClick={back}>Back to rooms</button></section>;
  if (residentId && selected && !edit) return <TenantAccount key={selected.id} person={selected} db={db} today={today} reload={reload} onEdit={() => setEdit({type:'person', data:db.people.find(p => p.id === selected.id)})} onSchedule={() => setEdit({type:'checkout',data:db.people.find(p => p.id === selected.id)})} onPayment={() => go('rent',selected.id)} onRemoved={back} backLabel={location.state?.from?.startsWith('/home') ? 'Home' : location.state?.from?.startsWith('/reports') ? 'Reports' : 'Rooms & residents'} />;
  if (edit?.type === 'house') return <HouseForm p={edit.data} done={done} />;
  if (edit?.type === 'room') return <RoomForm room={edit.data} d={d} done={done} />;
  if (edit?.type === 'person') return <PersonForm person={edit.data} db={db} done={done} />;
  if (edit?.type === 'checkout') return <CheckoutForm person={edit.data} today={today} done={done} />;
  const effectiveStatus = query.trim() ? 'all' : status;
  const matches = p => historyMatches(p,query,db.audit) && (effectiveStatus==='all' || tenantMatches(p,'',effectiveStatus,today));
  const past = d.people.filter((p) => !L.isActive(p, today) && matches(p)).sort((a, b) => (b.end_date > a.end_date ? 1 : -1));
  return (
    <>
      <div className="between screen-heading"><h1>Rooms & residents</h1><div className="screen-actions"><button className="small" onClick={() => setEdit({ type: 'house', data: { name: '', lease_rent: '', lease_anchor: today, lease_start: today, lease_end: '', lease_first_amount: '', electricity_cap: 800 } })}>+ Property</button><button className="small" onClick={() => setEdit({ type: 'person', data: { property_id: db.properties[0]?.id, room_id: '', stay_type: 'long', start_date: today } })}>+ Check in</button></div></div>
      <div className="tenant-filters card"><label>Find tenant<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, tenant ID, email or phone" /></label>{query.trim() && <p>Search includes current, upcoming and past residents.</p>}<label>Show<select value={status} onChange={e => setStatus(e.target.value)}><option value="Active">Active residents</option><option value="Upcoming">Upcoming arrivals</option><option value="Checked out">Past residents</option><option value="all">All tenants</option></select></label></div>
      {[...db.properties].filter(p => effectiveStatus === 'Active' && !query || db.rooms.some(r=>r.property_id===p.id && roomResidents(d.people,r.id,db.audit).some(matches))).sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
        <section key={p.id} className="property-group">
          <h2><button className="link" onClick={() => setEdit({ type: 'house', data: p })}>{p.name} ⚙︎</button></h2>
          {sortRoomsByRentUrgency(
            db.rooms.filter((r) => r.property_id === p.id && (query || status !== 'Active' ? roomResidents(d.people,r.id,db.audit).some(matches) : true)),
            d.people,
          ).map((r) => {
            const assigned = d.people.filter((x) => x.room_id === r.id && L.isActive(x, today));
            const occ = sortPeopleByRentUrgency(assigned.filter((x) => x.start_date <= today && matches(x)));
            const future = assigned.filter((x) => x.start_date > today && matches(x));
            const owed = sum(assigned.filter((x) => x.start_date <= today), (x) => x.owed);
            return (
              <div className="card" key={r.id}>
                <div className="between room-summary">
                  <button className="link" onClick={() => setEdit({ type: 'room', data: r })}>{r.label} · {assigned.filter(x => x.start_date <= today).length}/{r.capacity}{assigned.some(x => x.start_date > today) ? ` · ${assigned.filter(x => x.start_date > today).length} booked` : ''}</button>
                  <span>{fmt(sum(assigned.filter((x) => x.start_date <= today && x.stay_type === 'long'), (x) => L.billingTermsAt(x,today).weekly_rate))}/wk{owed > 0 && <span className="err"> · {fmt(owed)} owed</span>}</span>
                </div>
                {occ.map((x) => {
                  const bondStatus = normaliseBondStatus(x.bond_status || 'not_paid');
                  const bondToneClass = bondStatus === 'paid' ? 'bond-status-paid' : bondStatus === 'not_paid' ? 'bond-status-not-paid' : 'bond-status-other';
                  return (
                    <div className="row resident-row" key={x.id}>
                      <button className="resident-row-main" onClick={() => openTenant(x.id)}>
                        <span className="resident-details"><strong className="resident-name">{x.name}</strong><small className="resident-profile-link">View profile & receipts →</small>
                          {x.end_date > today && <small>Checkout scheduled: {nice(x.end_date)}</small>}
                          <small>{['short', 'per_night'].includes(x.stay_type) ? `${fmt(x.nightly_rate)}/night` : `${fmt(L.billingTermsAt(x,today).weekly_rate)}/wk`} · Checked in {nice(x.start_date)}</small>
                          <small>{x.legacy_bond_declared ? `Bond ${fmt(x.bond)} marked paid in previous records ·` : `Bond received ${fmt(x.bond_paid)} / ${fmt(x.bond)} expected ·`} <span className={x.legacy_bond_declared ? 'muted' : bondToneClass}>{x.legacy_bond_declared ? 'Bond marked paid — original receipt not recorded' : bondStatusLabel(x.bond_status)}</span></small>

                        </span>
                        {x.owed > 0 ? <b className="err">{fmt(x.owed)} owed</b> : x.credit > 0 ? <small className="ok">{fmt(x.credit)} credit</small> : null}
                      </button>

                    </div>
                  );
                })}
                {future.map((x) => {
                  const bondStatus = normaliseBondStatus(x.bond_status || 'not_paid');
                  const bondToneClass = bondStatus === 'paid' ? 'bond-status-paid' : bondStatus === 'not_paid' ? 'bond-status-not-paid' : 'bond-status-other';
                  return (
                    <button className="row" key={x.id} onClick={() => openTenant(x.id)}>
                      <span>{x.name}<small>Arrives {nice(x.start_date)} · {['short', 'per_night'].includes(x.stay_type) ? `${fmt(x.nightly_rate)}/night` : `${fmt(L.billingTermsAt(x,today).weekly_rate)}/wk`} · bond <span className={x.legacy_bond_declared ? 'muted' : bondToneClass}>{x.legacy_bond_declared ? 'Bond marked paid — original receipt not recorded' : bondStatusLabel(x.bond_status)}</span></small></span>
                      <small className="muted">Booked</small>
                    </button>
                  );
                })}
                {assigned.length < r.capacity && <button className="small" onClick={() => setEdit({ type: 'person', data: { property_id: p.id, room_id: r.id, stay_type: 'long', start_date: today, bond_status: 'held' } })}>+ Check in</button>}
                <RoomHistory room={r} people={d.people} db={db} today={today} openTenant={openTenant} query={query}/>
              </div>
            );
          })}
          <button className="small" onClick={() => setEdit({ type: 'room', data: { property_id: p.id, label: '', capacity: 1, sort: 99 } })}>+ Add room</button>
        </section>
      ))}
      {d.people.filter(x => !x.room_id && L.isActive(x, today) && matches(x)).map(x => <button type="button" className="row" key={x.id} onClick={() => openTenant(x.id)}><span>{x.name}<small>No room assigned</small></span></button>)}
      {past.length > 0 && <><h2>Past residents</h2>{past.map((x) => (
        <div className="card" key={x.id}><button className="row" onClick={() => openTenant(x.id)}>
          <span>{x.name}<small>{d.props[x.property_id]?.name} · checked in {nice(x.start_date)} · {x.checked_out_at ? 'confirmed checkout' : 'scheduled checkout elapsed'} {nice(x.checked_out_at ? new Intl.DateTimeFormat("en-CA",{timeZone:"Australia/Adelaide"}).format(new Date(x.checked_out_at)) : x.end_date)} · bond received {fmt(x.bond_paid)}, held {fmt(x.bond_held)}</small>{(x.phone || x.email) && <small>{[x.phone, x.email].filter(Boolean).join(' · ')}</small>}</span>
          {x.owed > 0 && <b className="err">{fmt(x.owed)}</b>}
        </button></div>))}</>}
    </>
  );
}

const nn = (v) => (v === '' || v === undefined ? null : v);
const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : +v);

function HouseForm({ p, done }) {
  const [f, setF] = useState({ name: p.name ?? '', lease_rent: p.lease_rent ?? '', lease_anchor: p.lease_anchor ?? '', lease_start: p.lease_start ?? '', lease_end: p.lease_end ?? '', lease_first_amount: p.lease_first_amount ?? '', electricity_cap: p.electricity_cap ?? 800, bills_amount: p.bills_amount ?? 0, bills_frequency: p.bills_frequency ?? 'monthly', invoice_address: p.invoice_address ?? '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const ok = await save('properties', { name: f.name.trim(), lease_rent: +f.lease_rent, lease_anchor: f.lease_anchor, lease_start: nn(f.lease_start), lease_end: nn(f.lease_end), lease_first_amount: numOrNull(f.lease_first_amount), electricity_cap: +f.electricity_cap, bills_amount: +f.bills_amount || 0, bills_frequency: f.bills_frequency || 'monthly', invoice_address: f.invoice_address.trim() || null }, p.id);
      if (ok) done();
    }}>
      <h1>{p.id ? `${p.name} settings` : 'Add property'}</h1>
      <label>Name</label><input value={f.name} onChange={set('name')} required />
      <label>Private address for tenant invoices (optional override)</label><input maxLength={200} value={f.invoice_address} onChange={set('invoice_address')} placeholder="Uses verified contract address when blank"/><small className="muted">Used on private tenant invoices only. This does not publish the street address on room listings.</small>
      <label>Landlord rent per fortnight</label><input type="number" min="0.01" step="0.01" inputMode="decimal" value={f.lease_rent} onChange={set('lease_rent')} required />
      <label>A date landlord rent falls due (cycle runs every 14 days from it)</label><input type="date" value={f.lease_anchor} onChange={set('lease_anchor')} required />
      <label>{p.id ? 'Lease start (blank = before 1 Jul 2026)' : 'Lease start'}</label><input type="date" value={f.lease_start} onChange={set('lease_start')} required={!p.id} />
      <label>Lease end date (optional, for renewal reminders)</label><input type="date" value={f.lease_end} onChange={set('lease_end')} />
      <label>First landlord payment override (blank = automatic)</label><input type="number" min="0" step="0.01" inputMode="decimal" value={f.lease_first_amount} onChange={set('lease_first_amount')} />
      <p className="muted">Utilities are included. Electricity caps are retained for historical records only.</p>
      <label>Utilities budget (forecast only)</label><input type="number" min="0" step="0.01" inputMode="decimal" value={f.bills_amount} onChange={set('bills_amount')} placeholder="0.00" />
      <label>Budget cycle</label>
      <select value={f.bills_frequency} onChange={set('bills_frequency')}>
        <option value="monthly">Monthly</option>
        <option value="yearly">Yearly</option>
      </select>
      <button className="primary">{p.id ? 'Save property settings' : 'Add property'}</button>
      {p.id && <button type="button" className="small err" onClick={async () => { if (window.prompt(`Permanently delete ${p.name} and all linked records? Type DELETE ${p.name} to confirm:`) === `DELETE ${p.name}`) { const ok = await deleteRow('properties', p.id); if (ok) done(); } }}>Delete property</button>}
      <button type="button" className="small" disabled={photoBusy} onClick={done}>Cancel</button>
    </form>
  );
}

function RoomForm({ room, d, done }) {
  const [photoBusy,setPhotoBusy]=useState(false);
  const [label, setLabel] = useState(room.label);
  const [cap, setCap] = useState(room.capacity);
  const occupied = room.id && d.people.some((p) => p.room_id === room.id);
  const scheduled = room.id ? d.people.filter((p) => p.room_id === room.id && L.isActive(p, L.todayStr())) : [];
  const peak = Math.max(0, ...scheduled.map((p) => {
    const day = p.start_date < L.todayStr() ? L.todayStr() : p.start_date;
    return scheduled.filter((x) => x.start_date <= day && (!x.end_date || x.end_date > day)).length;
  }));
  const capacityError = +cap < peak ? `This room has ${peak} overlapping current or future resident(s). Capacity cannot be reduced below that.` : '';
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if(photoBusy)return;
      const ok = await save('rooms', { property_id: room.property_id, label, capacity: +cap, sort: room.sort ?? 99 }, room.id);
      if (ok) done();
    }}>
      <h1>{room.id ? room.label : 'New room'}</h1>
      <label>Label</label><input value={label} onChange={(e) => setLabel(e.target.value)} required />
      <label>Capacity (people)</label>
      <div className="seg">{[1, 2, 3].map((n) => <button type="button" key={n} className={+cap === n ? 'on' : ''} onClick={() => setCap(n)}>{n}</button>)}</div>
      {capacityError && <p className="err">{capacityError}</p>}
      <RoomPhotos room={room} onBusy={setPhotoBusy}/>
      <button className="primary" disabled={photoBusy||Boolean(capacityError)}>Save room</button>
      {room.id && !occupied && <button type="button" className="small err" onClick={async () => { if (confirm('Delete this room?')) { const ok = await deleteRow('rooms', room.id); if (ok) done(); } }}>Delete room</button>}
      <button type="button" className="small" disabled={photoBusy} onClick={done}>Cancel</button>
    </form>
  );
}

function CheckoutForm({ person, today, done }) {
  const earliest = dayAfter(person.start_date);
  const [date, setDate] = useState(person.end_date || (today < earliest ? earliest : today));
  const [busy, setBusy] = useState(false);
  const scheduled = date > today;
  return <form onSubmit={async (e) => {
    e.preventDefault();
    setBusy(true);
    const ok = await updateTenantDetails(person, { end_date: date });
    setBusy(false);
    if (ok) { alert(scheduled ? `Checkout scheduled for ${nice(date)}. ${person.name} remains active until that date. An unpaid balance does not block checkout.` : `${person.name} has checked out and moved to Past residents. The financial history is retained.`); done(); }
  }}>
    <h1>Check out {person.name}</h1>
    <p className="muted">Checked in {nice(person.start_date)}. The checkout date is stored on the resident record and rent is charged up to the day before checkout.</p>
    <p className="muted">Checkout does not delete the resident or their financial history. Once the checkout date arrives, the room becomes vacant automatically if its public listing is approved and ready.</p>
    {scheduled && <p role="status">This schedules checkout for {nice(date)}. The tenant will remain in the room until that date; any balance remains in their account.</p>}
    {today < earliest && <p className="muted">This resident checked in today. A one-night stay ends {nice(earliest)}. The checkout date is the day they leave, not their last night.</p>}
    <label>Checkout date</label><input type="date" min={earliest} value={date} onChange={(e) => setDate(e.target.value)} required />
    <button className="primary" disabled={busy}>{busy ? 'Saving…' : scheduled ? 'Schedule checkout' : 'Confirm checkout'}</button>
    <button type="button" className="small" disabled={photoBusy} onClick={done}>Cancel</button>
  </form>;
}

const PF = ['name', 'phone', 'email', 'property_id', 'room_id', 'stay_type', 'weekly_rate', 'nightly_rate', 'start_date', 'end_date', 'paid_up_to', 'opening_balance', 'first_charge_amount', 'rent_cycle_anchor', 'bond', 'bond_status', 'document_url', 'document_notes'];
const NUM = ['weekly_rate', 'nightly_rate', 'opening_balance', 'first_charge_amount', 'bond'];

function normaliseBondStatus(value) {
  if (!value || value === 'held') return 'paid';
  if (value === 'not_paid') return 'not_paid';
  return value;
}

function PersonForm({ person, db, done }) {
  const [reason,setReason]=useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState(() => {
    const initial = Object.fromEntries(PF.map((k) => [k, person[k] ?? '']));
    initial.stay_type = residentStayOption(person);
    initial.bond_status = normaliseBondStatus(person.bond_status || initial.bond_status || 'not_paid');
    initial.document_url = person.document_url || '';
    initial.document_notes = person.document_notes || '';
    return initial;
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const prop = db.properties.find((p) => p.id === f.property_id);
  const rooms = db.rooms.map((r) => ({ ...r, house: db.properties.find((p) => p.id === r.property_id)?.name })).sort((a, b) => (a.house + a.sort).localeCompare(b.house + b.sort));
  const long = f.stay_type === 'long';
  const nightly = f.stay_type === 'per_night';
  const weekly = !nightly;
  const chooseStay = (stay_type) => setF({ ...f, stay_type, first_charge_amount: '', rent_cycle_anchor: stay_type === 'short_weekly' ? f.start_date : '' });
  const prop1 = weekly && prop && +f.weekly_rate > 0 && f.start_date >= L.LEDGER_START && !f.paid_up_to ? L.proposeFirstCharge(+f.weekly_rate, f.start_date, f.rent_cycle_anchor || prop.lease_anchor) : null;
  const checkInError = (() => {
    const dateError=tenantDateError(f);if(dateError)return dateError;
    if (!f.room_id || !f.start_date) return '';
    const room = db.rooms.find((r) => r.id === f.room_id);
    if (!room) return 'Choose a valid room.';
    return roomAtCapacity(db.people, room, { ...person, ...f }) ? `${room.label} is at capacity during these dates. Choose another room or date.` : '';
  })();

  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (checkInError || busy) return;
      setBusy(true);
      const row = {};
      for (const k of PF) row[k] = NUM.includes(k) ? numOrNull(f[k]) : nn(f[k]);
      row.opening_balance ??= 0;
      row.bond ??= 0;
      row.bond_status = normaliseBondStatus(row.bond_status || 'not_paid');
      row.document_url = row.document_url || null;
      row.document_notes = row.document_notes || null;
      if (person.id) {
        const before=L.derive(db,L.todayStr()).people.find(p=>p.id===person.id);
        const after=L.derive({...db,people:db.people.map(p=>p.id===person.id?{...p,...residentBillingRow(row)}:p)},L.todayStr()).people.find(p=>p.id===person.id);
        if (before.owed!==after.owed || before.credit!==after.credit) {
          if (!confirm(`This correction changes today's balance from ${fmt(before.owed-before.credit)} to ${fmt(after.owed-after.credit)}. Earlier rent may change. For a future rate change, cancel and use Schedule a future rent change in the account. Save this correction?`)) {setBusy(false);return;}
        }
      }
      const ok = person.id ? await updateTenantDetails(person, residentBillingRow(row), reason) : await save('people', residentBillingRow(row));
      setBusy(false);
      if (ok) done();
    }}>
      <h1>{person.id ? person.name : 'New resident'}</h1>{person.id && <p className="tenant-reference">Tenant ID <code>{tenantReference(person)}</code></p>}
      {person.id && <><p className="muted">These are corrections to stored details. For a new rate or billing cycle, use Schedule a future rent change in the account. Corrections retain before-and-after values.</p><label>Reason for correction<input required minLength={5} value={reason} onChange={e=>setReason(e.target.value)} /></label></>}
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
        <button type="button" className={long ? 'on' : ''} onClick={() => chooseStay('long')}>Long term</button>
        <button type="button" className={f.stay_type === 'short_weekly' ? 'on' : ''} onClick={() => chooseStay('short_weekly')}>Short term</button>
        <button type="button" className={f.stay_type === 'per_night' ? 'on' : ''} onClick={() => chooseStay('per_night')}>Per night</button>
      </div>
      {weekly ? <><label>Weekly rent</label><input type="number" min="0.01" step="0.01" inputMode="decimal" value={f.weekly_rate} onChange={set('weekly_rate')} required /></>
        : <><label>Nightly rate</label><input type="number" min="0.01" step="0.01" inputMode="decimal" value={f.nightly_rate} onChange={set('nightly_rate')} required /></>}
      <label>Move-in date</label><input type="date" min="2000-01-01" max="2100-12-31" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value, rent_cycle_anchor: f.rent_cycle_anchor ? e.target.value : '' })} required />
      <label>{long ? 'Move-out date (blank while resident)' : 'Check-out date'}</label><input type="date" min={dayAfter(f.start_date)} value={f.end_date} onChange={set('end_date')} required={!long} />
      {!long && f.start_date && f.end_date && f.end_date <= f.start_date && <p className="err">Check-out must be after check-in.</p>}
      <label>Paid up to (existing residents — charges start the day after)</label><input type="date" value={f.paid_up_to} onChange={set('paid_up_to')} />
      {weekly && <>
        <label>Rent cycle</label>
        <select value={f.rent_cycle_anchor ? 'checkin' : 'house'} onChange={(e) => setF({ ...f, rent_cycle_anchor: e.target.value === 'checkin' ? f.start_date : '', first_charge_amount: '' })}>
          <option value="house">Property cycle — first part period</option>
          <option value="checkin">Fortnight from check-in date</option>
        </select>
        {f.rent_cycle_anchor && f.start_date && <p className="muted">First fortnight: {nice(f.start_date)} to {nice(L.n2d(L.d2n(f.start_date) + 13))}. Regular rent: {fmt(+f.weekly_rate * 2)} per fortnight. A shorter stay ends at checkout.</p>}
        <label>First rent charge (optional override)</label>
        <input type="number" min="0" step="0.01" inputMode="decimal" value={f.first_charge_amount} onChange={set('first_charge_amount')} placeholder="Leave blank to calculate from weekly rent" />
        <small className="muted">Overrides the first charge only. Later rent follows the selected cycle. Record money received in the tenant account.</small>
      </>}
      {prop1 && prop1.days > 0 && (
        <p className="muted">Part period: {prop1.days} day(s) to {nice(prop1.nextCycle)} = {fmt(prop1.exact)}, proposed <b>{fmt(prop1.proposed)}</b>.{' '}
          <button type="button" className="link" onClick={() => setF({ ...f, first_charge_amount: prop1.proposed })}>Use {fmt(prop1.proposed)}</button></p>
      )}
      <label>Bond expected</label><input type="number" min="0" step="0.01" inputMode="decimal" value={f.bond} onChange={set('bond')} placeholder={weekly && f.weekly_rate ? `usually ${fmt(f.weekly_rate * 2)}` : ''} />
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
      <small className="muted">Record each bond receipt, refund or retained amount in the tenant account so the cash and bond liability reconcile.</small>
      {person.id && <p className="muted">Bond recorded: {fmt(person.bond_paid || 0)} received · {fmt(person.bond_held || 0)} still held. Record refunds or retained amounts in the tenant account.</p>}
      {checkInError && <p className="err">{checkInError}</p>}
      <button className="primary" disabled={busy || Boolean(checkInError)}>{busy ? 'Saving…' : person.id ? 'Save resident details' : 'Confirm check in'}</button>
      <button type="button" className="small" disabled={photoBusy} onClick={done}>Cancel</button>
    </form>
  );
}

/* ---------------- Rent ---------------- */
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
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (!ready || f.q_start > f.q_end) return;
      const posted = await postElectricityBill({
        propertyId: prop.id,
        billDate: f.bill_date,
        qStart: f.q_start,
        qEnd: f.q_end,
        amount: +f.amount,
        shares: [],
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
      <p>Full bill is recorded as a business expense. Utilities are included; no resident surcharges are created.</p>
      <button className="primary" disabled={!ready}>Record bill expense</button>
      <button type="button" className="small" disabled={photoBusy} onClick={done}>Cancel</button>
    </form>
  );
}

/* ---------------- Reports ---------------- */
function Reports(props) {
  const location=useLocation();const navigate=useNavigate();
  const transactions=new URLSearchParams(location.search).get('view')==='transactions';
  return <><div className="seg" aria-label="Report view"><button className={!transactions?'on':''} onClick={()=>navigate('/reports')}>Financial reports</button><button className={transactions?'on':''} onClick={()=>navigate('/reports?view=transactions')}>Transactions</button></div>{transactions?<AccountTransactions {...props}/>:<FinancialReports db={props.db} today={props.today}/>}</>;
}

/* ---------------- Activity ---------------- */
function Activity({ db, session, reload }) {
  const [historyQuery,setHistoryQuery]=useState('');
  const activity=db.audit.filter(a=>JSON.stringify([a.action,a.tenant_name,a.tenant_id,a.at,a.reason,a.before_values,a.after_values]).toLowerCase().includes(historyQuery.trim().toLowerCase()));
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
      <ReservationActivity />
      <label>Search all activity<input type="search" value={historyQuery} onChange={e=>setHistoryQuery(e.target.value)} placeholder="Tenant, date, room ID or transaction reference"/></label>
      <p className="muted">{activity.length} matching records. Automatic checkout logs show the scheduled end of occupancy, with the actual recording time retained.</p>
      {activity.map((a) => (
        <div className="card" key={a.id}><small className="muted">{new Date(a.at).toLocaleString('en-AU')} · {a.by}</small><div style={{ fontSize: 13, wordBreak: 'break-word' }}>{a.action==='scheduled_checkout_elapsed' ? `${a.tenant_name || 'Tenant'} · Automatic scheduled checkout · ${a.after_values?.end_date || ''}` : a.action}</div>{a.reason && <p>Reason: {a.reason}</p>}{(a.before_values || a.after_values) && <details><summary>Before & after</summary><div className="audit-values"><pre>{JSON.stringify(a.before_values,null,2)}</pre><pre>{JSON.stringify(a.after_values,null,2)}</pre></div></details>}</div>
      ))}
    </>
  );
}
