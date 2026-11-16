import { createStore } from '../lib/api';

export const DEMO_STUDENT = { id: '07A', email: 'ada.park@example.com' };
export const DEMO_STAFF = [
  { email: 'director@sfmo.demo', name: 'Jordan Lee', role: 'admin', id: '00000000-0000-4000-8000-00000000000a' },
  { email: 'proctor@sfmo.demo', name: 'Priya Nand', role: 'proctor', id: '00000000-0000-4000-8000-00000000000b' },
];
export const DEMO_PASSWORD = 'demo';

/** Demo only: pretend the network is down. */
export const outage = createStore(false);
