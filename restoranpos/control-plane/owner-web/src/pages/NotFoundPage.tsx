import { LinkButton } from '../ui/primitives';
import { Icon } from '../ui/Icon';

export default function NotFoundPage() {
  return (
    <main className="not-found">
      <span><Icon name="search" size={34} /></span>
      <p className="mono">404</p>
      <h1>Səhifə tapılmadı</h1>
      <p>Açmağa çalışdığınız müştəri portalı səhifəsi mövcud deyil və ya ünvan dəyişib.</p>
      <LinkButton to="/" variant="primary" icon="home">Ana səhifəyə qayıdın</LinkButton>
    </main>
  );
}
