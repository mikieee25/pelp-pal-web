"use client";

import {
  useCallback,
  useState,
  useSyncExternalStore,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import SyncRounded from "@mui/icons-material/SyncRounded";
import WifiOffRounded from "@mui/icons-material/WifiOffRounded";
import { DeviceEnrollmentStatus } from "@/components/device/device-enrollment-status";
import { getSyncRuntime } from "@/lib/sync/runtime";
import { getBrowserRepository } from "@/lib/db/browser";
import type { SyncRow } from "@/lib/db/records";
import { syncCatalog } from "@/features/catalog/catalog-sync";
import type { SyncOperation } from "@/lib/sync/coordinator";
import type { SyncStatusSnapshot } from "./sync-status-store";
import type { SyncStatusStore } from "./sync-status-store";

const emptySnapshot: SyncStatusSnapshot = {
  status: "offline",
  pendingCount: 0,
  conflictCount: 0,
  failedCount: 0,
};

const labels: Record<SyncStatusSnapshot["status"], string> = {
  live: "Live",
  syncing: "Syncing",
  pending: "Pending",
  reconnecting: "Reconnecting",
  offline: "Offline",
  error: "Error",
};
type CatalogFeedback = { severity: "success" | "error"; message: string };

type SyncStoreLike = Pick<SyncStatusStore, "subscribe" | "getSnapshot"> & {
  syncNow: (
    reason: "manual" | "retry",
    operation?: SyncOperation
  ) => Promise<void>;
};

export function SyncView({ statusStore }: { statusStore?: SyncStoreLike }) {
  const activeStore = statusStore ?? getSyncRuntime()?.statusStore;
  const subscribe = useCallback(
    (listener: () => void) =>
      activeStore?.subscribe(listener) ?? noopSubscribe(),
    [activeStore]
  );
  const getSnapshot = useCallback(
    () => activeStore?.getSnapshot() ?? emptySnapshot,
    [activeStore]
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getEmptySnapshot
  );
  const [catalogSyncing, setCatalogSyncing] = useState(false);
  const [catalogFeedback, setCatalogFeedback] = useState<CatalogFeedback>();
  const repository = useMemo(() => getBrowserRepository(), []);
  const [openConflicts, setOpenConflicts] = useState<SyncRow[]>([]);

  useEffect(() => {
    if (snapshot.conflictCount === 0 || !repository.listOpenConflicts) return;
    let active = true;
    void repository
      .listOpenConflicts()
      .then((conflicts) => {
        if (active) setOpenConflicts(conflicts);
      })
      .catch(() => {
        if (active) setOpenConflicts([]);
      });
    return () => {
      active = false;
    };
  }, [repository, snapshot.conflictCount]);
  const visibleConflicts = snapshot.conflictCount > 0 ? openConflicts : [];

  const sync = (reason: "manual" | "retry", operation: SyncOperation) => {
    void activeStore?.syncNow(reason, operation).catch(() => undefined);
  };

  const syncMasterlist = () => {
    setCatalogSyncing(true);
    setCatalogFeedback(undefined);
    void syncCatalog()
      .then((result) => {
        const catalogName =
          result.catalogRole === "guestlist" ? "Guest catalog" : "Masterlist";
        if (result.status === "updated")
          setCatalogFeedback({
            severity: "success",
            message: `${catalogName} updated to version ${result.version} (${result.rowCount.toLocaleString()} products).`,
          });
        else if (result.status === "unchanged")
          setCatalogFeedback({
            severity: "success",
            message: `${catalogName} is already current at version ${result.version} (${result.rowCount.toLocaleString()} products).`,
          });
        else
          setCatalogFeedback({
            severity: "error",
            message:
              "Masterlist sync is available after this browser is enrolled.",
          });
      })
      .catch((error) => {
        setCatalogFeedback({
          severity: "error",
          message:
            error instanceof Error
              ? error.message
              : "The masterlist could not be synchronized.",
        });
      })
      .finally(() => setCatalogSyncing(false));
  };

  return (
    <Container maxWidth="md" sx={{ py: { xs: 3, md: 5 } }}>
      <Stack spacing={{ xs: 2.5, md: 3 }}>
        <Box>
          <Typography component="h1" variant="h3">
            Sync
          </Typography>
          <Typography color="text.secondary">
            Keep completed inspections available to the consolidated report.
          </Typography>
        </Box>
        <DeviceEnrollmentStatus />
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack spacing={2}>
            <Box>
              <Typography variant="h6">Sync actions</Typography>
              <Typography variant="body2" color="text.secondary">
                Run each operation separately, or retry the complete sync after
                an error.
              </Typography>
            </Box>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <SyncAction
                title="Upload inspections"
                detail="Send completed inspections waiting on this device to the shared mirror."
                action={
                  <Button
                    variant="contained"
                    fullWidth
                    onClick={() => sync("manual", "upload")}
                    disabled={!activeStore || snapshot.status === "syncing"}
                  >
                    Upload inspections
                  </Button>
                }
              />
              <SyncAction
                title="Download inspections"
                detail="Pull completed inspections and updates from other devices to this browser."
                action={
                  <Button
                    variant="contained"
                    fullWidth
                    onClick={() => sync("manual", "download")}
                    disabled={!activeStore || snapshot.status === "syncing"}
                  >
                    Download inspections
                  </Button>
                }
              />
              <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2" fontWeight={700}>
                  Sync catalog
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Download the latest product catalog for this account.
                </Typography>
                <Button
                  variant="contained"
                  fullWidth
                  onClick={syncMasterlist}
                  disabled={!activeStore || catalogSyncing}
                  sx={{ mt: 0.5 }}
                >
                  {catalogSyncing ? "Syncing catalog…" : "Sync catalog"}
                </Button>
              </Stack>
            </Stack>
            {catalogFeedback && (
              <Alert severity={catalogFeedback.severity}>
                {catalogFeedback.message}
              </Alert>
            )}
          </Stack>
        </Paper>
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack spacing={2}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1.5}
              justifyContent="space-between"
              alignItems={{ xs: "flex-start", sm: "center" }}
            >
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Box
                  aria-hidden
                  sx={{
                    display: "grid",
                    placeItems: "center",
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    bgcolor: "action.hover",
                    color:
                      snapshot.status === "offline"
                        ? "text.secondary"
                        : "primary.main",
                  }}
                >
                  {snapshot.status === "offline" ? (
                    <WifiOffRounded />
                  ) : (
                    <SyncRounded />
                  )}
                </Box>
                <Box>
                  <Typography variant="h6">Synchronization status</Typography>
                  <Typography variant="body2" color="text.secondary">
                    The coordinator pulls remote changes and sends completed
                    local inspections.
                  </Typography>
                </Box>
              </Stack>
              <Chip
                label={labels[snapshot.status]}
                color={
                  snapshot.status === "error"
                    ? "error"
                    : snapshot.status === "live"
                      ? "success"
                      : "default"
                }
              />
            </Stack>
            {snapshot.lastError && (
              <Alert severity="error" role="alert">
                {snapshot.lastError}
              </Alert>
            )}
            {snapshot.conflictCount > 0 && (
              <Alert severity="warning">
                <Stack spacing={1}>
                  <Typography variant="body2" fontWeight={700}>
                    Sync conflicts need review
                  </Typography>
                  <Typography variant="body2">
                    A newer version exists on another device. Review the
                    affected inspection before retrying its upload.
                  </Typography>
                  {visibleConflicts.map((conflict) => {
                    const inspectionId = textField(conflict, [
                      "inspection_id",
                      "inspectionId",
                    ]);
                    const controlNumber = textField(conflict, [
                      "product_control_number",
                      "controlNumber",
                      "control_number",
                    ]);
                    return inspectionId ? (
                      <Button
                        key={conflict.id}
                        component="a"
                        href={`/inspect/${encodeURIComponent(inspectionId)}`}
                        size="small"
                        variant="outlined"
                        sx={{ alignSelf: "flex-start" }}
                      >
                        Review {controlNumber || "inspection"}
                      </Button>
                    ) : null;
                  })}
                </Stack>
              </Alert>
            )}
            {snapshot.status === "offline" && (
              <Alert severity="info">
                Local data remains available while this browser is offline or
                not enrolled.
              </Alert>
            )}
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              flexWrap="wrap"
              useFlexGap
            >
              <Chip
                label={`${snapshot.pendingCount} pending`}
                variant="outlined"
              />
              <Chip
                label={`${snapshot.conflictCount} ${snapshot.conflictCount === 1 ? "conflict" : "conflicts"}`}
                variant="outlined"
                color={snapshot.conflictCount > 0 ? "warning" : "default"}
              />
              {(snapshot.failedCount ?? 0) > 0 && (
                <Chip
                  label={`${snapshot.failedCount} failed`}
                  variant="outlined"
                  color="error"
                />
              )}
              {snapshot.catalogVersion !== undefined && (
                <Chip
                  label={`Catalog v${snapshot.catalogVersion}`}
                  variant="outlined"
                />
              )}
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ alignSelf: "center" }}
              >
                {snapshot.lastSyncedAt
                  ? `Last synced ${formatTime(snapshot.lastSyncedAt)}`
                  : "Not synced in this session"}
              </Typography>
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              {snapshot.status === "error" && (
                <Button
                  variant="outlined"
                  startIcon={<SyncRounded />}
                  onClick={() => sync("retry", "full")}
                  disabled={!activeStore}
                >
                  Retry full sync
                </Button>
              )}
            </Stack>
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
}

function SyncAction({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action: ReactNode;
}) {
  return (
    <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="subtitle2" fontWeight={700}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {detail}
      </Typography>
      {action}
    </Stack>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function noopSubscribe(): () => void {
  return () => undefined;
}
function getEmptySnapshot(): SyncStatusSnapshot {
  return emptySnapshot;
}

function textField(row: SyncRow, keys: string[]): string {
  const value = keys
    .map((key) => row[key])
    .find((candidate) => typeof candidate === "string" && candidate.trim());
  return typeof value === "string" ? value.trim() : "";
}
