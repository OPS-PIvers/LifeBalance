import React from 'react';
import { Navigate } from 'react-router-dom';

// Redirects a legacy standalone route (/todos, /meals, /shopping) into the
// corresponding /lists tab by seeding ListsPage's localStorage preference
// ('lists-active-tab') before navigating. ListsPage's module-visibility
// fallback handles a disabled tab gracefully.
const PlanTabRedirect: React.FC<{ tab: 'todos' | 'meals' | 'shopping' }> = ({ tab }) => {
  try {
    window.localStorage.setItem('lists-active-tab', tab);
  } catch {
    /* best-effort */
  }
  return <Navigate to="/lists" replace />;
};

export default PlanTabRedirect;
