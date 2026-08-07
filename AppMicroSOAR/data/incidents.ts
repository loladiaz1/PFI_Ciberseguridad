import type { Incident } from '../types';

export const incidentsSeed: Incident[] = [
  {
    id: 'INC-1001',
    title: 'Phishing alert detected',
    severity: 'high',
    status: 'in-progress',
    owner: 'Alicia',
    updatedAt: '10 min ago',
    description: 'Suspicious emails detected in the mail gateway.',
    location: 'London HQ',
  },
  {
    id: 'INC-1002',
    title: 'Unauthorized remote access attempt',
    severity: 'critical',
    status: 'open',
    owner: 'Daniel',
    updatedAt: '25 min ago',
    description: 'Repeated sign-in attempts from an unknown IP range.',
    location: 'Remote',
  },
];
