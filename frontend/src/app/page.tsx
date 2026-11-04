import { Suspense } from 'react';
import ExplorePage from '../components/ExplorePage';
export default function Page() {
  return (
    <Suspense fallback={<div className="empty-state">Loading workspace…</div>}>
      <ExplorePage />
    </Suspense>
  );
}
