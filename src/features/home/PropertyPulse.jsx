import { useState } from 'react';
import * as L from '../../ledger.js';
import { fmt, nice, sum } from '../../lib/formatters.js';

export default function PropertyPulseList({ properties, people, payments, today, fortnightStart, onSelectTenant, onReorderProperty }) {
  const [draggedId, setDraggedId] = useState(null);
  const pulses = properties.map((property) => {
    const residents = people.filter((person) => person.property_id === property.id && person.start_date <= today && L.isActive(person, today));
    const tenantRows = residents
      .map((person) => ({
        ...person,
        dueText: person.daysLate > 0 ? `${person.daysLate} day${person.daysLate === 1 ? '' : 's'} late` : person.owed > 0 ? 'Due today' : 'Up to date',
      }))
      .sort((a, b) => {
        const unpaidDiff = Number(Boolean(b.owed > 0)) - Number(Boolean(a.owed > 0));
        if (unpaidDiff !== 0) return unpaidDiff;
        return (b.owed || 0) - (a.owed || 0) || (b.daysLate || 0) - (a.daysLate || 0);
      });
    const tenantArrears = tenantRows.filter((person) => person.owed > 0);
    const tenantDue = tenantArrears[0];
    const residentOwed = sum(tenantArrears, (person) => person.owed);
    const landlordPayment = L.landlordPaymentStatus(property, today, payments.filter((payment) => payment.property_id === property.id && payment.category === 'Landlord rent'));
    const landlordNext = landlordPayment.next || L.nextLandlordPayment(property, today);
    const dueSoon = (days) => Number.isFinite(days) && days >= 0 && days <= 3;
    const tenantDueSoon = Boolean(tenantDue && tenantDue.owed > 0 && dueSoon(tenantDue.daysLate >= 0 ? tenantDue.daysLate : 0));
    const landlordDueSoon = !landlordPayment.paid && landlordNext && dueSoon(landlordNext.days);
    const isUrgent = tenantDueSoon || landlordDueSoon;
    const beds = sum(property.rooms || [], (room) => room.capacity || 0);
    const rentIn = sum(payments.filter((payment) => payment.property_id === property.id && (!payment.kind || payment.kind === 'rent') && payment.date >= fortnightStart && payment.date <= today), (payment) => payment.amount);

    return {
      id: property.id,
      name: property.name,
      residentCount: residents.length,
      beds,
      residentOwed,
      tenantDue,
      landlordNext,
      landlordPayment,
      isUrgent,
      rentIn,
      tenantRows,
    };
  });

  pulses.sort((a, b) => {
    const aHasTenantDue = Boolean(a.tenantDue && a.tenantDue.owed > 0);
    const bHasTenantDue = Boolean(b.tenantDue && b.tenantDue.owed > 0);
    const tenantDiff = Number(bHasTenantDue) - Number(aHasTenantDue);
    if (tenantDiff !== 0) return tenantDiff;

    const aTenantUrgency = a.tenantDue ? (a.tenantDue.owed || 0) + (a.tenantDue.daysLate || 0) * 10 : 0;
    const bTenantUrgency = b.tenantDue ? (b.tenantDue.owed || 0) + (b.tenantDue.daysLate || 0) * 10 : 0;
    if (aTenantUrgency !== bTenantUrgency) return bTenantUrgency - aTenantUrgency;

    const aLandlordUrgency = a.landlordPayment.paid ? 0 : Math.max(0, 30 - (a.landlordNext.days || 30));
    const bLandlordUrgency = b.landlordPayment.paid ? 0 : Math.max(0, 30 - (b.landlordNext.days || 30));
    if (aLandlordUrgency !== bLandlordUrgency) return bLandlordUrgency - aLandlordUrgency;

    return b.residentOwed - a.residentOwed || Number(b.isUrgent) - Number(a.isUrgent);
  });

  return pulses.map(({ id, name, residentCount, beds, residentOwed, tenantDue, landlordNext, landlordPayment, isUrgent, rentIn, tenantRows }) => {
    const tenantLabel = tenantDue ? `${tenantDue.name}${tenantDue.daysLate > 0 ? ` · ${tenantDue.daysLate}d late` : ' · due today'}` : 'No tenant arrears';
    const landlordStatusText = landlordPayment.paid ? 'Paid' : landlordNext.days <= 0 ? 'Unpaid' : `${landlordNext.days} day${landlordNext.days === 1 ? '' : 's'} away`;
    const landlordUrgent = !landlordPayment.paid && landlordNext.days >= 0 && landlordNext.days <= 3;
    return (
      <article
        className={`property-pulse${isUrgent ? ' priority-urgent' : ''}${draggedId === id ? ' dragging' : ''}`}
        key={id}
        draggable
        onDragStart={(event) => {
          try {
            setDraggedId(id);
            if (!event.dataTransfer) return;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', String(id));
          } catch {
            setDraggedId(null);
          }
        }}
        onDragOver={(event) => {
          try {
            event.preventDefault();
          } catch {
            // No-op if the browser refuses the drag event.
          }
        }}
        onDrop={(event) => {
          try {
            event.preventDefault();
            const sourceId = draggedId ?? (event.dataTransfer ? event.dataTransfer.getData('text/plain') : '');
            if (sourceId && onReorderProperty) onReorderProperty(sourceId, id);
          } catch {
            // Ignore invalid drag payloads.
          } finally {
            setDraggedId(null);
          }
        }}
      >
        <div className="between property-pulse-header">
          <strong>{name}</strong>
          <span>{residentCount} residents · {beds} beds</span>
        </div>
        <div className="pulse-metrics">
          <span>
            <small>Tenant rent to collect</small>
            <b className={residentOwed > 0 ? 'err' : ''}>{fmt(residentOwed)}</b>
            <small>{tenantLabel}</small>
          </span>
          <span>
            <small>Next landlord payment</small>
            <b className={landlordUrgent ? 'err' : 'ok'}>{nice(landlordNext.date)} · {fmt(landlordNext.amount)}</b>
            <small>{landlordStatusText}</small>
          </span>
        </div>
        <div className="property-tenant-list">
          {tenantRows.map((person) => (
            <button type="button" key={person.id} className="tenant-row" onClick={() => onSelectTenant?.(person.id)}>
              <span>{person.name}</span>
              <div>
                <b className={person.owed > 0 && person.daysLate <= 3 ? 'err' : 'ok'}>{person.owed > 0 ? fmt(person.owed) : 'Paid'}</b>
                <small>{person.owed > 0 ? person.dueText : 'Current tenant'} · {person.stay_type === 'short' ? `${fmt(person.nightly_rate)}/night` : `${fmt(person.weekly_rate)}/wk`}</small>
              </div>
            </button>
          ))}
        </div>
        <div className="between property-pulse-footer">
          <small>Rent collected · 14d</small>
          <b>{fmt(rentIn)}</b>
        </div>
      </article>
    );
  });
}
