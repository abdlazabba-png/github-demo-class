import React from 'react';
import ReactDOM from 'react-dom/client';
import { Amplify } from 'aws-amplify';
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import outputs from '../amplify_outputs.json';
import DashboardApp from './DashboardApp.jsx';
import './styles.css';

// Mirrors agent-main.jsx's own bootstrap exactly — see its comment for
// why amplify_outputs.json is gitignored/environment-specific. Each
// bundle configures Amplify independently since they're genuinely
// separate page loads with no shared JS runtime between them, not two
// views of one already-configured app the way the old combined App.jsx's
// single main.jsx was.
Amplify.configure(outputs);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Authenticator>
      {({ signOut, user }) => <DashboardApp signOut={signOut} user={user} />}
    </Authenticator>
  </React.StrictMode>
);
