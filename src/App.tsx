import { lazy, Suspense, useEffect } from 'react';
import { IS_DEMO, backend } from './lib/api';
import { useRoute } from './lib/hooks';
import { useStudent } from './lib/session';
import { Toasts, PageLoading } from './ui/kit';
import { SignIn } from './pages/student/SignIn';
import { StudentApp } from './pages/student/StudentApp';
import { DemoBar } from './demo/DemoBar';

const StaffApp = lazy(() => import('./pages/staff/StaffApp'));
const Projector = lazy(() => import('./pages/Projector'));

export function App() {
  const route = useRoute();
  const student = useStudent();

  // Warm the backend up straight away (the demo builds its database here).
  useEffect(() => {
    backend().catch(() => {});
  }, []);

  let page;
  if (route.startsWith('board-')) page = <Projector round={route.slice(6)} />;
  else if (route === 'staff' || route.startsWith('staff-')) page = <StaffApp route={route} />;
  else if (!student) page = <SignIn />;
  else page = <StudentApp route={route} />;

  return (
    <>
      <Suspense fallback={<div className="wrap"><PageLoading /></div>}>{page}</Suspense>
      <Toasts />
      {IS_DEMO && <DemoBar />}
    </>
  );
}
