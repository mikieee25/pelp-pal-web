'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Camera, Search } from 'lucide-react';
import { EmptyState, InlineNotice, ListRow, PageHeader, PageShell, Section, Stat, StatusBadge, Surface } from '@/components/ui';
import { CurrentStorePanel } from '@/features/store/current-store-panel';
import type { ActivityRecord } from '@/lib/db/records';
import { getBrowserRepository } from '@/lib/db/browser';
import { useRepositoryRevision } from '@/lib/db/use-repository-revision';

type Counts = {
  completedInspections: number;
  drafts: number;
  pendingSync: number;
};

type SyncCounts = {
  failedCount: number;
  conflictCount: number;
  evidencePendingCount: number;
};

const emptySyncCounts: SyncCounts = { failedCount: 0, conflictCount: 0, evidencePendingCount: 0 };

export function DashboardView() {
  const repository = useMemo(() => getBrowserRepository(), []);
  const repositoryRevision = useRepositoryRevision(repository);
  const [counts, setCounts] = useState<Counts>();
  const [syncCounts, setSyncCounts] = useState<SyncCounts>(emptySyncCounts);
  const [recent, setRecent] = useState<ActivityRecord[]>([]);
  const [failed, setFailed] = useState<ActivityRecord[]>([]);
  const [conflicts, setConflicts] = useState<ActivityRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      repository.getDashboardCounts(),
      repository.listActivity({ limit: 5 }),
      repository.listActivity({ syncStatus: 'failed', limit: 5 }),
      repository.listActivity({ syncStatus: 'conflict', limit: 5 }),
      repository.getSyncStatusCounts(),
    ]).then(([nextCounts, nextRecent, nextFailed, nextConflicts, nextSyncCounts]) => {
      if (!active) return;
      setCounts(nextCounts);
      setRecent(nextRecent);
      setFailed(nextFailed);
      setConflicts(nextConflicts);
      setSyncCounts(nextSyncCounts);
      setLoaded(true);
      setLoadError(false);
    }).catch(() => {
      if (!active) return;
      setLoadError(true);
      setLoaded(true);
    });
    return () => { active = false; };
  }, [repository, repositoryRevision]);

  const hasAttention = loaded && (
    syncCounts.failedCount > 0 || syncCounts.conflictCount > 0 || syncCounts.evidencePendingCount > 0
  );

  return (
    <PageShell>
      <div className="space-y-8">
        <PageHeader title="Dashboard" subtitle="Start an inspection or continue recent work." />

        <Surface className="space-y-4 p-4 sm:p-6">
            <div><h2 className="text-xl font-semibold text-ink">Start work</h2><p className="mt-1 text-sm text-muted">Scan a label or find a product in the authorized catalog.</p></div>
            <div className="flex w-full flex-col gap-3 sm:flex-row"><Link href="/lookup?scan=1" className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-control bg-primary px-4 font-semibold text-white hover:bg-primary-hover"><Camera aria-hidden="true" className="size-4" />Scan label</Link><Link href="/lookup" className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-control border border-border-strong px-4 font-semibold text-primary hover:bg-primary-soft"><Search aria-hidden="true" className="size-4" />Search catalog</Link></div>
        </Surface>

        <CurrentStorePanel returnTo="/dashboard" />

        {loadError && <InlineNotice severity="error">Local dashboard information could not be loaded. Refresh to try again.</InlineNotice>}

        {hasAttention && (
          <Section title="Needs attention">
            <div className="divide-y divide-border">
              {failed.map((activity) => (
                <Link key={`failed-${activity.id}`} href={activity.inspectionId ? `/inspect/${activity.inspectionId}` : '/sync'} style={{ color: 'inherit', textDecoration: 'none' }}>
                  <ListRow
                    primary={controlNumber(activity) || 'Inspection upload failed'}
                    secondary={activitySummary(activity) || activity.syncError || 'Review this upload in Activity.'}
                    trailing={<StatusBadge variant="attention" label="Upload failed" />}
                    chevron
                  />
                </Link>
              ))}
              {syncCounts.failedCount > failed.length && (
                <Link href="/sync" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <ListRow primary={`${syncCounts.failedCount - failed.length} more uploads need attention`} secondary="Review failed uploads in Sync." trailing={<StatusBadge variant="attention" label="Failed" />} chevron />
                </Link>
              )}
              {conflicts.map((activity) => (
                <Link key={`conflict-${activity.id}`} href="/sync" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <ListRow
                    primary={controlNumber(activity) || 'Inspection conflict'}
                    secondary={activitySummary(activity) || 'Review the conflicting changes.'}
                    trailing={<StatusBadge variant="attention" label="Needs review" />}
                    chevron
                  />
                </Link>
              ))}
              {syncCounts.conflictCount > conflicts.length && (
                <Link href="/sync" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <ListRow primary={`${syncCounts.conflictCount - conflicts.length} more conflicts need review`} secondary="Review conflicting changes in Sync." trailing={<StatusBadge variant="attention" label="Needs review" />} chevron />
                </Link>
              )}
              {syncCounts.evidencePendingCount > 0 && (
                <Link href="/sync" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <ListRow
                    leading={<AlertCircle aria-hidden="true" className="text-warning" />}
                    primary={`Photos waiting to upload (${syncCounts.evidencePendingCount})`}
                    secondary="Review photo upload status in Sync."
                    trailing={<StatusBadge variant="waiting" />}
                    chevron
                  />
                </Link>
              )}
            </div>
          </Section>
        )}

        <Section title="Work at a glance">
          <Surface className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 sm:p-6">
              <Stat value={counts?.completedInspections ?? '—'} label="Completed" />
              <Stat value={counts?.drafts ?? '—'} label="Drafts" />
              <Stat value={counts ? counts.pendingSync + syncCounts.evidencePendingCount : '—'} label="Waiting to upload" />
          </Surface>
        </Section>

        <Section title="Recent inspections">
          {recent.length > 0 ? (
            <div className="divide-y divide-border">
              {recent.slice(0, 5).map((activity) => (
                <Link key={activity.id} href={activity.inspectionId ? `/inspect/${activity.inspectionId}` : '/activity'} style={{ color: 'inherit', textDecoration: 'none' }}>
                  <ListRow
                    primary={<span className="font-mono text-[13px] font-semibold">{controlNumber(activity) || 'Inspection'}</span>}
                    secondary={activitySummary(activity)}
                    trailing={<span className="text-sm text-muted">{activity.productType || 'Product details'}</span>}
                    chevron
                  />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState icon={<Search aria-hidden="true" className="size-8" />} message="Completed inspections will appear here." />
          )}
        </Section>
      </div>
    </PageShell>
  );
}

function controlNumber(activity: ActivityRecord): string {
  return activity.controlNumber?.trim() ?? '';
}

function activitySummary(activity: ActivityRecord): string {
  return [activity.brand, activity.model, activity.storeName].filter((part) => part?.trim()).join(' · ');
}
