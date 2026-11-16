import { call, createStore, signedOut, useStore } from './api';
import { storageGet, storageSet } from './hooks';

export type Student = { id: string; name: string; team_id: string; team_name: string };
export type StudentSession = { token: string; student: Student };

const KEY = 'sfmo27-student';
export const studentSession = createStore<StudentSession | null>(storageGet<StudentSession | null>(KEY, null));
studentSession.subscribe(() => storageSet(KEY, studentSession.get()));

export const useStudent = () => useStore(studentSession);
export const token = () => studentSession.get()?.token ?? '';

export async function studentSignIn(id: string, email: string) {
  const r = await call<{ token: string; student: Student }>('s_sign_in', { id, email, agent: navigator.userAgent.slice(0, 200) });
  studentSession.set({ token: r.token, student: r.student });
  return r.student;
}

export async function studentSignOut() {
  const t = token();
  studentSession.set(null);
  if (t) call('s_sign_out', { token: t }).catch(() => {});
}

// A session the server no longer recognises (expired, signed out by a proctor)
// drops the student back to the sign-in screen.
signedOut.subscribe(() => {
  if (studentSession.get()) studentSession.set(null);
});
