'use client';

import { useEffect, useState } from 'react';

export function useRepositoryRevision(repository: { subscribeChanges?: (listener: () => void) => () => void }): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => repository.subscribeChanges?.(() => setRevision((current) => current + 1)), [repository]);
  return revision;
}
