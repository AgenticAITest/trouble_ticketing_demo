import React from 'react';

/**
 * Status badge component for ticket statuses
 */
const STATUS_LABELS = {
  open: 'Open',
  waiting_clarification: 'Waiting for User',
  waiting_confirmation: 'Pending Confirm',
  closed: 'Closed'
};

const StatusBadge = ({ status }) => {
  const label = STATUS_LABELS[status] || status;

  return (
    <span className={`status-badge ${status}`}>
      {label}
    </span>
  );
};

export default StatusBadge;
