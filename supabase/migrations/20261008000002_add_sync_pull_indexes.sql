create index if not exists inspection_revisions_change_cursor_idx
  on public.inspection_revisions (change_cursor);

create index if not exists activity_events_change_cursor_idx
  on public.activity_events (change_cursor);

create index if not exists inspection_conflicts_change_cursor_idx
  on public.inspection_conflicts (change_cursor);

create index if not exists inspection_deletion_tombstones_change_cursor_idx
  on public.inspection_deletion_tombstones (change_cursor);

create index if not exists inspections_organization_owner_idx
  on public.inspections (organization_id, owner_username);
