"use client";

import { useEffect, useState } from "react";
import type { StoreRecord } from "@/lib/db/records";
import type { LocalRepository } from "@/lib/db/repository";
import { useRepositoryRevision } from "@/lib/db/use-repository-revision";

export function useCurrentStore(repository: LocalRepository) {
  const revision = useRepositoryRevision(repository);
  const [result, setResult] = useState<{
    revision: number;
    store?: StoreRecord;
    status: "ready" | "error";
  }>();

  useEffect(() => {
    let active = true;
    void repository
      .getCurrentStore()
      .then((current) => {
        if (!active) return;
        setResult({ revision, store: current, status: "ready" });
      })
      .catch(() => {
        if (!active) return;
        setResult({ revision, status: "error" });
      });
    return () => {
      active = false;
    };
  }, [repository, revision]);

  return result?.revision === revision
    ? { store: result.store, status: result.status }
    : { store: undefined, status: "loading" as const };
}
