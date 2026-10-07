"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Container,
  FormControl,
  IconButton,
  InputLabel,
  InputAdornment,
  List,
  ListItem,
  Paper,
  Skeleton,
  Stack,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import {
  CloseRounded,
  Inventory2Outlined,
  QrCodeScannerRounded,
  SearchRounded,
} from "@mui/icons-material";
import type { CatalogRecord } from "@/lib/db/records";
import { getBrowserRepository } from "@/lib/db/browser";
import { extractLookupQuery } from "@/features/lookup/qr-value";
import { QrScannerDialog } from "@/features/lookup/qr-scanner-dialog";
import { getEcpType } from "@/features/lookup/catalog-filter";
import { syncMasterlistCatalog } from "@/features/catalog/catalog-sync";
import { CatalogDetails } from "@/features/catalog/catalog-details";
import Link from "next/link";
import { ActiveStoreBanner } from "@/features/store/current-store-panel";

const CATALOG_RESULT_LIMIT = 10;

export function LookupView() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<CatalogRecord[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [ecpTypeFilter, setEcpTypeFilter] = useState("");
  const [ecpTypes, setEcpTypes] = useState<string[]>([]);
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [catalogSyncStatus, setCatalogSyncStatus] = useState<
    "checking" | "ready" | "error"
  >("checking");
  const visibleRows = ecpTypeFilter
    ? rows.filter((row) => getEcpType(row) === ecpTypeFilter)
    : rows;

  useEffect(() => {
    let active = true;
    void getBrowserRepository()
      .searchCatalog(query, CATALOG_RESULT_LIMIT, ecpTypeFilter)
      .then((nextRows) => {
        if (active) {
          setRows(nextRows);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (active) {
          setRows([]);
          setStatus("error");
        }
      });
    return () => {
      active = false;
    };
  }, [catalogRefresh, ecpTypeFilter, query]);

  useEffect(() => {
    let active = true;
    void getBrowserRepository()
      .getCatalogEcpTypes()
      .then((types) => {
        if (active) setEcpTypes(types);
      })
      .catch(() => {
        if (active) setEcpTypes([]);
      });
    return () => {
      active = false;
    };
  }, [catalogRefresh]);

  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(() => syncMasterlistCatalog())
      .then((result) => {
        if (!active) return;
        setCatalogSyncStatus("ready");
        if (result.status === "updated")
          setCatalogRefresh((current) => current + 1);
      })
      .catch(() => {
        if (active) setCatalogSyncStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    setStatus("loading");
  }, []);

  useEffect(() => {
    const queryFromUrl = new URLSearchParams(window.location.search).get("query");
    if (!queryFromUrl || queryFromUrl === query) return;
    const timer = window.setTimeout(() => handleQueryChange(queryFromUrl), 0);
    return () => window.clearTimeout(timer);
  }, [handleQueryChange, query]);

  const handleQrDetected = useCallback(
    (payload: string) => {
      const extractedQuery = extractLookupQuery(payload);
      setIsScannerOpen(false);
      if (extractedQuery) handleQueryChange(extractedQuery);
    },
    [handleQueryChange]
  );

  return (
    <Container
      maxWidth="lg"
      sx={{ minWidth: 0, px: { xs: 2, sm: 3, md: 4 }, py: { xs: 3, md: 5 } }}
    >
      <Stack spacing={0.75} sx={{ mb: { xs: 3, md: 4 } }}>
        <Typography
          variant="overline"
          color="primary.main"
          sx={{ fontWeight: 800, letterSpacing: "0.1em" }}
        >
          Catalog lookup
        </Typography>
        <Typography
          component="h1"
          variant="h4"
          sx={{ fontSize: { xs: "1.8rem", sm: "2.125rem" } }}
        >
          Find a product
        </Typography>
        <Typography color="text.secondary" sx={{ maxWidth: 650 }}>
          Search the catalog stored on this device before starting an
          inspection.
        </Typography>
      </Stack>

      <Box sx={{ mb: { xs: 2, md: 3 } }}><ActiveStoreBanner returnTo="/lookup" /></Box>

      <Paper
        component="form"
        elevation={0}
        onSubmit={(event) => event.preventDefault()}
        sx={{
          p: { xs: 2, sm: 3 },
          mb: { xs: 3, md: 4 },
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
        }}
      >
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Avatar sx={{ bgcolor: "action.hover", color: "primary.main" }}>
              <SearchRounded />
            </Avatar>
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>
                Search your authorized catalog
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Control number, model, brand, or product type.
              </Typography>
            </Box>
          </Stack>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            alignItems="stretch"
          >
            <TextField
              fullWidth
              label="Search local catalog"
              placeholder="Try a control number, model, or brand"
              value={query}
              onChange={(event) => handleQueryChange(event.target.value)}
              autoComplete="off"
              inputProps={{ "aria-label": "Search local catalog" }}
              sx={{ flex: 1 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRounded color="action" />
                  </InputAdornment>
                ),
                endAdornment: query ? (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label="Clear catalog search"
                      onClick={() => handleQueryChange("")}
                      edge="end"
                    >
                      <CloseRounded />
                    </IconButton>
                  </InputAdornment>
                ) : undefined,
              }}
            />
            <Button
              type="button"
              variant="outlined"
              startIcon={<QrCodeScannerRounded />}
              onClick={() => setIsScannerOpen(true)}
              sx={{ minHeight: 56, whiteSpace: "nowrap" }}
            >
              Scan QR code
            </Button>
          </Stack>
          <FormControl fullWidth size="small" sx={{ maxWidth: { sm: 320 } }}>
            <InputLabel id="product-type-filter-label">Product Type</InputLabel>
            <Select
              labelId="product-type-filter-label"
              id="product-type-filter"
              value={ecpTypeFilter}
              label="Product Type"
              onChange={(event) => setEcpTypeFilter(event.target.value)}
            >
              <MenuItem value="">All Product Types</MenuItem>
              {ecpTypes.map((type) => (
                <MenuItem key={type} value={type}>
                  {type}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </Paper>

      <Stack spacing={2} sx={{ minWidth: 0 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          alignItems={{ xs: "flex-start", sm: "center" }}
          justifyContent="space-between"
        >
          <Box>
            <Typography component="h2" variant="h6">
              Catalog results
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {status === "loading"
                ? "Searching locally…"
                : `${visibleRows.length} ${visibleRows.length === 1 ? "product" : "products"} found on this device`}
            </Typography>
          </Box>
          <Chip
            label={
              catalogSyncStatus === "checking"
                ? "Updating catalog…"
                : catalogSyncStatus === "error"
                  ? "Catalog update unavailable"
                  : "Stored locally"
            }
            color={catalogSyncStatus === "error" ? "warning" : "default"}
            size="small"
            variant="outlined"
          />
        </Stack>

        {status === "loading" ? (
          <Stack spacing={1.5} aria-label="Loading catalog results">
            {[1, 2, 3].map((item) => (
              <Skeleton key={item} variant="rounded" height={150} />
            ))}
          </Stack>
        ) : status === "error" ? (
          <Alert severity="error">
            The local catalog could not be read. Refresh to try again.
          </Alert>
        ) : visibleRows.length > 0 ? (
          <List
            aria-label="Local catalog results"
            disablePadding
            sx={{ display: "grid", gap: 1.5, minWidth: 0, width: "100%" }}
          >
            {visibleRows.map((row) => (
              <CatalogResult key={row.id} row={row} />
            ))}
          </List>
        ) : (
          <Alert severity="info">
            {query
              ? `No products match “${query}”. Try a control number, model, or brand.`
              : ecpTypeFilter
                ? `No ${ecpTypeFilter} products are stored on this browser.`
                : "No catalog products are stored on this browser yet."}
          </Alert>
        )}
      </Stack>

      <QrScannerDialog
        open={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onDetected={handleQrDetected}
      />
    </Container>
  );
}

function CatalogResult({ row }: { row: CatalogRecord }) {
  const brand = firstText(row, ["brand"]);
  const model = firstText(row, ["model_number", "modelNumber", "model"]);
  const controlNumber = firstText(row, [
    "control_number",
    "product_control_number",
    "controlNumber",
  ]);
  const productType = getEcpType(row);
  const title =
    [brand, model].filter(Boolean).join(" ") ||
    firstText(row, ["product_name", "name"]) ||
    "Catalog item";
  const catalogLabel =
    row.catalogScope === "guestlist" ? "Guest catalog" : "Master catalog";

  return (
    <ListItem disableGutters sx={{ display: "block", minWidth: 0, p: 0, width: "100%" }}>
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2, sm: 2.5 },
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          minWidth: 0,
          overflow: "hidden",
          width: "100%",
        }}
      >
        <Stack spacing={1.25} sx={{ minWidth: 0 }}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            justifyContent="space-between"
            alignItems={{ xs: "stretch", sm: "flex-start" }}
          >
            <Stack direction="row" spacing={1.25} alignItems="flex-start" sx={{ minWidth: 0, flex: 1 }}>
              <Avatar sx={{ bgcolor: "action.hover", color: "primary.main" }}>
                <Inventory2Outlined />
              </Avatar>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle1" fontWeight={700} noWrap>
                  {title}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
                  {[productType || "Product catalog item", controlNumber ? `Control number: ${controlNumber}` : undefined].filter(Boolean).join(" · ")}
                </Typography>
              </Box>
            </Stack>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{
                alignSelf: { xs: "flex-end", sm: "auto" },
                flexShrink: 0,
                flexWrap: { xs: "wrap", sm: "nowrap" },
                justifyContent: "flex-end",
                maxWidth: "100%",
              }}
            >
              <Chip label={catalogLabel} size="small" variant="outlined" sx={{ maxWidth: "100%" }} />
              <Button
                component={Link}
                href={`/inspect/new?catalogId=${encodeURIComponent(row.id)}`}
                size="small"
                variant="outlined"
              >
                Inspect
              </Button>
            </Stack>
          </Stack>
          <Box sx={{ minWidth: 0, width: "100%" }}><CatalogDetails row={row} /></Box>
        </Stack>
      </Paper>
    </ListItem>
  );
}

function firstText(row: CatalogRecord, keys: string[]): string | undefined {
  const value = keys
    .map((key) => row[key])
    .find((candidate) => typeof candidate === "string" && candidate.trim());
  return typeof value === "string" ? value.trim() : undefined;
}
