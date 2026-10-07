'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Box, Button, ButtonBase, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormLabel, MenuItem, Paper, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { getBrowserRepository } from '@/lib/db/browser';
import type { CatalogRecord, LocalEvidenceRecord } from '@/lib/db/records';
import { getLocalSession } from '@/lib/auth/local-session-store';
import { CatalogDetails } from '@/features/catalog/catalog-details';
import { optimizeEvidenceImage } from '@/lib/evidence/image-optimization';
import { validateInspectionDraft, type InspectionDraft } from '@/features/inspection/validator';

type InspectionStep = 'product' | 'energyLabel' | 'checklist';

type Draft = {
  storeName: string;
  controlNumber: string;
  remarks: string;
  labeling: string;
  placement: string;
  visualQuality: string;
  productDetails: string;
  currentStep: InspectionStep;
};

const emptyDraft: Draft = {
  storeName: '',
  controlNumber: '',
  remarks: '',
  labeling: '',
  placement: '',
  visualQuality: '',
  productDetails: '',
  currentStep: 'product',
};

const steps: Array<{ key: InspectionStep; label: string }> = [
  { key: 'product', label: 'Product' },
  { key: 'energyLabel', label: 'Energy Label' },
  { key: 'checklist', label: 'Checklist' },
];

const MAX_EVIDENCE_IMAGES = 3;

type EvidenceImage = LocalEvidenceRecord & { previewUrl: string };

export function InspectionEditor({ inspectionId, catalogId, readOnly = false }: { inspectionId: string; catalogId?: string; readOnly?: boolean }) {
  const repository = useMemo(() => getBrowserRepository(), []);
  const router = useRouter();
  const [resolvedInspectionId] = useState(() => inspectionId === 'new' ? crypto.randomUUID() : inspectionId);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [catalogProduct, setCatalogProduct] = useState<CatalogRecord>();
  const [evidence, setEvidence] = useState<EvidenceImage[]>([]);
  const [step, setStep] = useState<InspectionStep>('product');
  const [loaded, setLoaded] = useState(false);
  const [stepError, setStepError] = useState<string>();
  const [evidenceError, setEvidenceError] = useState<string>();
  const [completionError, setCompletionError] = useState<string>();
  const [duplicateInspection, setDuplicateInspection] = useState<Record<string, unknown>>();
  const [updatedBy, setUpdatedBy] = useState<string>();
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [viewingEvidence, setViewingEvidence] = useState<EvidenceImage>();
  const [evidenceZoom, setEvidenceZoom] = useState(1);
  const previewUrls = useRef(new Set<string>());

  useEffect(() => {
    if (inspectionId !== 'new') return;
    const suffix = catalogId ? `?catalogId=${encodeURIComponent(catalogId)}` : '';
    router.replace(`/inspect/${resolvedInspectionId}${suffix}`, { scroll: false });
  }, [catalogId, inspectionId, resolvedInspectionId, router]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      repository.getInspectionDraft(resolvedInspectionId),
      repository.getInspection(resolvedInspectionId),
      repository.getCatalogById(catalogId ?? (inspectionId === 'new' ? '' : resolvedInspectionId)),
      repository.listEvidenceImages(resolvedInspectionId),
      repository.getCurrentStore(),
    ]).then(([savedDraft, completedInspection, product, savedEvidence, currentStore]) => {
      if (!active) return;
      setCatalogProduct(product);
      setEvidence(savedEvidence.map((image) => toEvidenceImage(image, previewUrls.current)));
      const productControlNumber = product ? firstText(product, ['control_number', 'product_control_number', 'controlNumber']) ?? '' : '';
      const saved = readOnly ? completedInspection ?? savedDraft : savedDraft ?? completedInspection;
      if (saved) {
        if (completedInspection) setUpdatedBy(textValue(completedInspection.username) || textValue(completedInspection.updatedBy));
        const restoredStep = inspectionStep(saved.currentStep);
        setDraft({
          storeName: textValue(saved.storeName) || currentStore?.name || '',
          controlNumber: textValue(saved.controlNumber) || productControlNumber,
          remarks: textValue(saved.remarks),
          labeling: textValue(saved.labeling),
          placement: textValue(saved.placement),
          visualQuality: textValue(saved.visualQuality),
          productDetails: textValue(saved.productDetails),
          currentStep: restoredStep,
        });
        setStep(readOnly ? 'product' : restoredStep);
      } else {
        setDraft({ ...emptyDraft, controlNumber: productControlNumber, storeName: currentStore?.name || '' });
      }
      setLoaded(true);
    }).catch(() => {
      if (active) {
        setSaveState('error');
        setLoaded(true);
      }
    });
    return () => { active = false; };
  }, [catalogId, inspectionId, readOnly, repository, resolvedInspectionId]);

  useEffect(() => () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (!loaded || readOnly) return;
    const timer = window.setTimeout(() => {
      setSaveState('saving');
      void repository.saveInspectionDraft(resolvedInspectionId, { ...draft, currentStep: step })
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [draft, loaded, readOnly, repository, resolvedInspectionId, step]);

  const updateDraft = (changes: Partial<Draft>) => {
    setDraft((value) => ({ ...value, ...changes }));
    setStepError(undefined);
  };

  const addEvidenceImages = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    setEvidenceError(undefined);
    const remaining = MAX_EVIDENCE_IMAGES - evidence.length;
    if (remaining <= 0) {
      setEvidenceError(`A maximum of ${MAX_EVIDENCE_IMAGES} evidence images is allowed.`);
      return;
    }

    const selectedFiles = files.slice(0, remaining);
    if (files.length > remaining) {
      setEvidenceError(`A maximum of ${MAX_EVIDENCE_IMAGES} evidence images is allowed.`);
    }

    try {
      const savedImages: EvidenceImage[] = [];
      for (const file of selectedFiles) {
        if (!file.type.startsWith('image/')) {
          throw new Error('Only image files can be added as evidence.');
        }
        const optimized = await optimizeEvidenceImage(file);
        const saved = await repository.saveEvidenceImage(resolvedInspectionId, optimized, {
          fileName: file.name,
          capturedAt: new Date().toISOString(),
        });
        savedImages.push({ ...saved, blob: optimized, previewUrl: createPreviewUrl(optimized, previewUrls.current) });
      }
      setEvidence((current) => [...current, ...savedImages]);
    } catch (error) {
      setEvidenceError(error instanceof Error ? error.message : 'Evidence image could not be saved locally.');
    }
  };

  const removeEvidenceImage = async (id: string) => {
    const image = evidence.find((item) => item.id === id);
    if (!image) return;
    try {
      await repository.deleteEvidenceImage(id);
      URL.revokeObjectURL(image.previewUrl);
      previewUrls.current.delete(image.previewUrl);
      setEvidence((current) => current.filter((item) => item.id !== id));
      if (viewingEvidence?.id === id) setViewingEvidence(undefined);
      setEvidenceError(undefined);
    } catch {
      setEvidenceError('Evidence image could not be removed from this device.');
    }
  };

  const replaceEvidenceImage = async (id: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setEvidenceError('Only image files can be added as evidence.');
      return;
    }
    const existing = evidence.find((item) => item.id === id);
    if (!existing) return;
    try {
      const optimized = await optimizeEvidenceImage(file);
      const saved = await repository.replaceEvidenceImage(id, optimized, {
        fileName: file.name,
        capturedAt: new Date().toISOString(),
      });
      URL.revokeObjectURL(existing.previewUrl);
      previewUrls.current.delete(existing.previewUrl);
      const next = { ...saved, blob: optimized, previewUrl: createPreviewUrl(optimized, previewUrls.current) };
      setEvidence((current) => current.map((item) => item.id === id ? next : item));
      if (viewingEvidence?.id === id) setViewingEvidence(next);
      setEvidenceError(undefined);
    } catch (error) {
      setEvidenceError(error instanceof Error ? error.message : 'Evidence image could not be replaced locally.');
    }
  };

  const finishInspection = async (allowDuplicate = false) => {
    const validation = validateInspectionDraft(toValidationDraft(draft, catalogProduct, resolvedInspectionId, evidence.length));
    const { evidence: evidenceValidation, ...checklistValidation } = validation;
    if (Object.keys(checklistValidation).length > 0) {
      setEvidenceError(`Complete the required checklist answers: ${Object.values(checklistValidation).join(' ')}`);
      return;
    }
    if (evidenceValidation || (hasNonCompliance(draft) && evidence.length === 0)) {
      setEvidenceError('At least one evidence image is required when an inspection has an NC finding.');
      return;
    }

    setCompletionError(undefined);
    setSaveState('saving');
    try {
      const currentStore = await repository.getCurrentStore();
      const username = getLocalSession()?.username ?? 'unknown';
      const model = firstText(catalogProduct, ['model_number', 'modelNumber', 'model']);
      if (!allowDuplicate) {
      const duplicate = await repository.findDuplicateCompletedInspection?.({
          inspectionId: resolvedInspectionId,
          storeId: currentStore?.storeId,
          controlNumber: draft.controlNumber,
          model,
          username,
        });
        if (duplicate) {
          setDuplicateInspection(duplicate);
          setSaveState('idle');
          return;
        }
      }
      await repository.completeInspection(resolvedInspectionId, {
        ...draft,
        storeName: currentStore?.name || draft.storeName,
        currentStep: 'checklist',
        evidenceCount: evidence.length,
        outcome: inspectionOutcome(draft),
        username,
        updatedBy: username,
        inspectionId: resolvedInspectionId,
        catalogId: catalogProduct?.id,
        product_snapshot: catalogProduct,
        storeId: currentStore?.storeId,
        location: currentStore?.location,
        productType: firstText(catalogProduct, ['product_type', 'productType', 'ecp_type', 'ecpType']),
        brand: firstText(catalogProduct, ['brand']),
        model,
        companyName: catalogFieldText(catalogProduct, ['companyName', 'company_name', 'company', 'Company Name', 'Company']),
        retailPrice: catalogFieldText(catalogProduct, ['retailPrice', 'retail_price', 'Retail Price', 'Latest Average Price', 'latestAveragePrice']),
      });
      router.push('/activity');
    } catch {
      setSaveState('error');
      setCompletionError('Inspection could not be finished locally. Your draft is still available.');
    }
  };

  const handleContinue = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly) {
      if (step === 'product') setStep('energyLabel');
      else if (step === 'energyLabel') setStep('checklist');
      return;
    }
    if (step === 'checklist') {
      finishInspection();
      return;
    }
    if (step === 'product' && !draft.controlNumber.trim()) {
      setStepError('Product control number is required before continuing.');
      return;
    }
    const nextStep = step === 'product' ? 'energyLabel' : step === 'energyLabel' ? 'checklist' : 'checklist';
    setStep(nextStep);
    setDraft((value) => ({ ...value, currentStep: nextStep }));
  };

  const goBack = () => {
    if (step === 'energyLabel') setStep('product');
    if (step === 'checklist') setStep('energyLabel');
  };

  const openEvidenceViewer = (image: EvidenceImage) => {
    setViewingEvidence(image);
    setEvidenceZoom(1);
  };

  const closeEvidenceViewer = () => {
    setViewingEvidence(undefined);
    setEvidenceZoom(1);
  };

  return <>
      <Paper component="form" sx={{ p: { xs: 2, md: 4 } }} onSubmit={handleContinue}>
      <Stack spacing={2.5}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} gap={2}>
          <Stack spacing={0.25}>
            <Typography component="h1" variant="h4">Inspection</Typography>
            {updatedBy && <Typography variant="caption" color="text.secondary">Updated by: <strong>{updatedBy}</strong></Typography>}
          </Stack>
            <Chip label={readOnly ? 'View only' : saveState === 'saving' ? 'Saving' : saveState === 'saved' ? 'Saved locally' : saveState === 'error' ? 'Save failed' : 'Draft'} color={saveState === 'error' ? 'error' : 'default'} />
        </Stack>
        <StepProgress currentStep={step} />
        {saveState === 'error' && <Alert severity="error">{completionError ?? 'The inspection draft could not be saved locally. Keep this page open and retry.'}</Alert>}
        {step === 'product' && <ProductStep draft={draft} catalogProduct={catalogProduct} stepError={stepError} readOnly={readOnly} onChange={updateDraft} />}
        {step === 'energyLabel' && <EnergyLabelStep draft={draft} catalogProduct={catalogProduct} />}
        {step === 'checklist' && <ChecklistStep draft={draft} evidence={evidence} evidenceError={evidenceError} readOnly={readOnly} onChange={updateDraft} onAddEvidence={addEvidenceImages} onRemoveEvidence={(id) => void removeEvidenceImage(id)} onReplaceEvidence={replaceEvidenceImage} onOpenEvidence={openEvidenceViewer} />}
        <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1.5} justifyContent="space-between" sx={{ position: 'sticky', bottom: 0, zIndex: 2, mx: { xs: -2, md: -4 }, px: { xs: 2, md: 4 }, py: 1.5, pb: 'calc(12px + env(safe-area-inset-bottom))', bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider' }}>
          <Stack direction="row" spacing={1}>
            <Button type="button" onClick={() => router.push('/activity')}>Back to Activity</Button>
            <Button type="button" onClick={goBack} disabled={step === 'product'}>Back</Button>
          </Stack>
          {readOnly
            ? step === 'checklist'
              ? <Button type="button" variant="contained" onClick={() => router.push('/activity')}>Done</Button>
              : <Button type="submit" variant="contained">{step === 'product' ? 'Continue' : 'Continue to checklist'}</Button>
            : <Button type="submit" variant="contained">{step === 'product' ? 'Continue' : step === 'energyLabel' ? 'Continue to checklist' : 'Save Inspection'}</Button>}
        </Stack>
      </Stack>
    </Paper>
    <Dialog open={Boolean(duplicateInspection)} onClose={() => setDuplicateInspection(undefined)} aria-labelledby="duplicate-inspection-title">
      <DialogTitle id="duplicate-inspection-title">Product already inspected</DialogTitle>
      <DialogContent>
        This product was already inspected at this store by {textValue(duplicateInspection?.username) || 'the same inspector'}. Do you want to save another inspection anyway?
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setDuplicateInspection(undefined)}>Cancel</Button>
        <Button variant="contained" onClick={() => { setDuplicateInspection(undefined); void finishInspection(true); }}>Continue anyway</Button>
      </DialogActions>
    </Dialog>
    <Dialog open={Boolean(viewingEvidence)} onClose={closeEvidenceViewer} fullWidth maxWidth="lg" aria-labelledby="evidence-viewer-title">
      {viewingEvidence && <>
        <DialogTitle id="evidence-viewer-title" sx={{ pr: 2 }}>{viewingEvidence.fileName}</DialogTitle>
        <DialogContent sx={{ p: { xs: 1, sm: 2 }, bgcolor: 'grey.100' }}>
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: { xs: 280, sm: 420 }, maxHeight: 'calc(100vh - 230px)', overflow: 'auto', bgcolor: 'grey.900', borderRadius: 1 }}>
            <Box component="img" src={viewingEvidence.previewUrl} alt={`Evidence image ${viewingEvidence.displayOrder + 1}`} sx={{ display: 'block', maxWidth: '100%', maxHeight: 'calc(100vh - 260px)', objectFit: 'contain', transform: `scale(${evidenceZoom})`, transformOrigin: 'center', transition: 'transform 160ms ease' }} />
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1, px: { xs: 1.5, sm: 2 }, pb: { xs: 1.5, sm: 2 } }}>
          <Button type="button" size="small" onClick={() => setEvidenceZoom((value) => Math.max(0.5, value - 0.25))} disabled={evidenceZoom <= 0.5}>Zoom out</Button>
          <Typography variant="body2" color="text.secondary" sx={{ minWidth: 48, textAlign: 'center' }}>{Math.round(evidenceZoom * 100)}%</Typography>
          <Button type="button" size="small" onClick={() => setEvidenceZoom((value) => Math.min(3, value + 0.25))} disabled={evidenceZoom >= 3}>Zoom in</Button>
          <Button type="button" size="small" onClick={() => setEvidenceZoom(1)} disabled={evidenceZoom === 1}>Reset</Button>
          <Button component="a" href={viewingEvidence.previewUrl} download={viewingEvidence.fileName} size="small" variant="contained">Download</Button>
          <Button type="button" size="small" onClick={closeEvidenceViewer}>Close</Button>
        </DialogActions>
      </>}
    </Dialog>
  </>;
}

function ProductStep({ draft, catalogProduct, stepError, readOnly, onChange }: { draft: Draft; catalogProduct?: CatalogRecord; stepError?: string; readOnly: boolean; onChange: (changes: Partial<Draft>) => void }) {
  return <Stack spacing={2}>
    <Box>
      <Typography component="h2" variant="h6">Confirm the product</Typography>
      <Typography variant="body2" color="text.secondary">These details come from the catalog stored on this device.</Typography>
    </Box>
    {catalogProduct && <ProductSummary product={catalogProduct} />}
    <TextField label="Store name" value={draft.storeName} onChange={(event) => onChange({ storeName: event.target.value })} disabled={readOnly} />
    <TextField label="Product control number" value={draft.controlNumber} onChange={(event) => onChange({ controlNumber: event.target.value })} disabled={readOnly} error={Boolean(stepError)} helperText={stepError} />
    <TextField label="Remarks" value={draft.remarks} onChange={(event) => onChange({ remarks: event.target.value })} disabled={readOnly} multiline minRows={4} />
  </Stack>;
}

function EnergyLabelStep({ draft, catalogProduct }: { draft: Draft; catalogProduct?: CatalogRecord }) {
  return <Stack spacing={2}>
    <Box>
      <Typography component="h2" variant="h6">Review the Energy Label</Typography>
      <Typography variant="body2" color="text.secondary">Review the registered product values before completing the compliance checklist.</Typography>
    </Box>
    <Alert severity="info">The QR code and catalog identity are linked to this inspection.</Alert>
    {catalogProduct ? <ProductSummary product={catalogProduct} /> : <Alert severity="warning">No catalog snapshot was found. Confirm the control number manually.</Alert>}
    <Typography variant="body2" color="text.secondary">Control number: <strong>{draft.controlNumber}</strong></Typography>
  </Stack>;
}

function ChecklistStep({ draft, evidence, evidenceError, readOnly, onChange, onAddEvidence, onRemoveEvidence, onReplaceEvidence, onOpenEvidence }: { draft: Draft; evidence: EvidenceImage[]; evidenceError?: string; readOnly: boolean; onChange: (changes: Partial<Draft>) => void; onAddEvidence: (event: React.ChangeEvent<HTMLInputElement>) => void; onRemoveEvidence: (id: string) => void; onReplaceEvidence: (id: string, event: React.ChangeEvent<HTMLInputElement>) => void; onOpenEvidence: (image: EvidenceImage) => void }) {
  return <Stack spacing={2}>
    <Box>
      <Typography component="h2" variant="h6">Compliance checklist</Typography>
      <Typography variant="body2" color="text.secondary">Record the inspector’s assessment for this product.</Typography>
    </Box>
    <TextField select label="Labeling requirements" value={draft.labeling} onChange={(event) => onChange({ labeling: event.target.value })} disabled={readOnly}>
      <MenuItem value="">Select an answer</MenuItem>
      <MenuItem value="with_label">With Label</MenuItem>
      <MenuItem value="with_coe">With COE</MenuItem>
      <MenuItem value="registered_only">Registered Only (NC)</MenuItem>
      <MenuItem value="not_registered">Not Registered (NC)</MenuItem>
    </TextField>
    <ComplianceToggle label="Energy label placement" value={draft.placement} readOnly={readOnly} onChange={(placement) => onChange({ placement })} />
    <ComplianceToggle label="Visual quality" value={draft.visualQuality} readOnly={readOnly} onChange={(visualQuality) => onChange({ visualQuality })} />
    <ComplianceToggle label="Product details" value={draft.productDetails} readOnly={readOnly} onChange={(productDetails) => onChange({ productDetails })} />
    <EvidenceSection evidence={evidence} error={evidenceError} readOnly={readOnly} onAdd={onAddEvidence} onRemove={onRemoveEvidence} onReplace={onReplaceEvidence} onOpen={onOpenEvidence} />
    <TextField label="Remarks / description of non-compliance" value={draft.remarks} onChange={(event) => onChange({ remarks: event.target.value })} disabled={readOnly} multiline minRows={4} />
  </Stack>;
}

function EvidenceSection({ evidence, error, readOnly, onAdd, onRemove, onReplace, onOpen }: { evidence: EvidenceImage[]; error?: string; readOnly: boolean; onAdd: (event: React.ChangeEvent<HTMLInputElement>) => void; onRemove: (id: string) => void; onReplace: (id: string, event: React.ChangeEvent<HTMLInputElement>) => void; onOpen: (image: EvidenceImage) => void }) {
  return <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }}>
    <Stack spacing={1.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={700}>Evidence Image</Typography>
          <Typography variant="body2" color="text.secondary">Optional when all findings are Complied. Required when any finding is NC.</Typography>
        </Box>
        {!readOnly && <Button component="label" variant="outlined" size="small" disabled={evidence.length >= MAX_EVIDENCE_IMAGES}>
          Add evidence image
          <input hidden type="file" accept="image/*" multiple capture="environment" onChange={onAdd} />
        </Button>}
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {evidence.length > 0 && <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
        {evidence.map((image, index) => <Paper key={image.id} variant="outlined" sx={{ overflow: 'hidden' }}>
          <ButtonBase type="button" onClick={() => onOpen(image)} aria-label={`View evidence image ${index + 1}`} sx={{ display: 'block', width: '100%', textAlign: 'left' }}>
            <Box component="img" src={image.previewUrl} alt={`Evidence image ${index + 1}`} sx={{ display: 'block', width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', bgcolor: 'action.hover' }} />
          </ButtonBase>
          <Stack spacing={0.75} sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary">Captured {formatEvidenceTimestamp(image.capturedAt)} · {evidenceStatusLabel(image.syncStatus)}</Typography>
            {!readOnly && <Stack direction="row" spacing={1}>
              <Button component="label" size="small">Replace<input hidden type="file" accept="image/*" capture="environment" onChange={(event) => onReplace(image.id, event)} /></Button>
              <Button type="button" size="small" color="error" onClick={() => onRemove(image.id)}>Remove</Button>
            </Stack>}
          </Stack>
        </Paper>)}
      </Box>}
    </Stack>
  </Paper>;
}

function evidenceStatusLabel(status: EvidenceImage['syncStatus']): string {
  if (status === 'synced') return 'Synced to shared mirror';
  if (status === 'pending') return 'Waiting for upload';
  return 'Saved on this device';
}

function ComplianceToggle({ label, value, readOnly, onChange }: { label: string; value: string; readOnly: boolean; onChange: (value: string) => void }) {
  const id = label.toLowerCase().replaceAll(' ', '-');
  return <FormControl component="fieldset" fullWidth>
    <FormLabel component="legend" id={`${id}-label`}>{label}</FormLabel>
    <ToggleButtonGroup
      exclusive
      fullWidth
      value={value || null}
      disabled={readOnly}
      onChange={(_, nextValue: string | null) => onChange(nextValue ?? '')}
      aria-labelledby={`${id}-label`}
      sx={{
        mt: 1,
        '& .MuiToggleButton-root': {
          flex: 1,
          minHeight: 48,
          textTransform: 'none',
          fontWeight: 700,
        },
      }}
    >
      <ToggleButton
        value="passing"
        sx={{
          '&.Mui-selected': {
            color: 'success.contrastText',
            bgcolor: 'success.main',
            '&:hover': { bgcolor: 'success.dark' },
          },
        }}
      >
        Complied
      </ToggleButton>
      <ToggleButton
        value="failing"
        sx={{
          '&.Mui-selected': {
            color: 'error.contrastText',
            bgcolor: 'error.main',
            '&:hover': { bgcolor: 'error.dark' },
          },
        }}
      >
        NC
      </ToggleButton>
    </ToggleButtonGroup>
  </FormControl>;
}

function ProductSummary({ product }: { product: CatalogRecord }) {
  return <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={1.5}><Typography variant="subtitle1" fontWeight={700}>Registered product</Typography><CatalogDetails row={product} defaultExpanded /></Stack></Paper>;
}

function StepProgress({ currentStep }: { currentStep: InspectionStep }) {
  const activeIndex = Math.max(0, steps.findIndex((item) => item.key === currentStep));

  return <Box
    component="ol"
    aria-label="Inspection progress"
    sx={{
      display: 'flex',
      alignItems: 'center',
      width: '100%',
      m: 0,
      p: 0,
      listStyle: 'none',
      overflowX: 'auto',
      pb: 0.5,
    }}
  >
    {steps.map((item, index) => {
      const isActive = index === activeIndex;
      const isComplete = index < activeIndex;
      return <Box
        key={item.key}
        component="li"
        sx={{
          display: 'flex',
          alignItems: 'center',
          flex: index < steps.length - 1 ? '1 1 0' : '0 0 auto',
          minWidth: 0,
        }}
      >
        <Box
          component="span"
          aria-label={`${index + 1}. ${item.label}`}
          aria-current={isActive ? 'step' : undefined}
          sx={(theme) => ({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            height: 40,
            px: { xs: 1.25, sm: 2 },
            border: 1,
            borderColor: isActive ? 'primary.main' : isComplete ? 'primary.light' : 'divider',
            borderRadius: '999px',
            bgcolor: isActive ? 'primary.main' : isComplete ? theme.palette.action.hover : 'background.paper',
            color: isActive ? 'primary.contrastText' : 'text.primary',
            fontSize: { xs: '0.75rem', sm: '0.875rem' },
            fontWeight: isActive || isComplete ? 700 : 500,
            whiteSpace: 'nowrap',
          })}
        >
          {index + 1}. {item.label}
        </Box>
        {index < steps.length - 1 && <Box
          component="span"
          aria-hidden="true"
          sx={{
            flex: 1,
            minWidth: { xs: 12, sm: 28 },
            height: 2,
            mx: { xs: 0.5, sm: 1 },
            bgcolor: isComplete ? 'primary.main' : 'divider',
          }}
        />}
      </Box>;
    })}
  </Box>;
}

function firstText(row: CatalogRecord | undefined, keys: string[]): string | undefined {
  if (!row) return undefined;
  const value = keys.map((key) => row[key]).find((candidate) => typeof candidate === 'string' && candidate.trim());
  return typeof value === 'string' ? value.trim() : undefined;
}

function catalogFieldText(row: CatalogRecord | undefined, keys: string[]): string | undefined {
  const direct = firstText(row, keys);
  if (direct) return direct;
  if (!row) return undefined;
  const dynamic = parseDynamicFields(row.dynamic_fields);
  const wanted = keys.map(normalizeFieldKey);
  const match = Object.entries(dynamic).find(([key, value]) => wanted.includes(normalizeFieldKey(key)) && value !== null && value !== undefined && String(value).trim());
  return match ? String(match[1]).trim() : undefined;
}

function parseDynamicFields(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeFieldKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function createPreviewUrl(blob: Blob, previewUrls: Set<string>): string {
  const url = URL.createObjectURL(blob);
  previewUrls.add(url);
  return url;
}

function toEvidenceImage(image: LocalEvidenceRecord, previewUrls: Set<string>): EvidenceImage {
  return { ...image, previewUrl: createPreviewUrl(image.blob, previewUrls) };
}

function hasNonCompliance(draft: Pick<Draft, 'labeling' | 'placement' | 'visualQuality' | 'productDetails'>): boolean {
  return draft.labeling === 'registered_only'
    || draft.labeling === 'not_registered'
    || [draft.placement, draft.visualQuality, draft.productDetails].includes('failing');
}

function toValidationDraft(draft: Draft, product: CatalogRecord | undefined, activityLogId: string, evidenceCount: number): InspectionDraft {
  const productType = firstText(product, ['product_type', 'productType', 'ecp_type', 'ecpType']) ?? '';
  const brand = firstText(product, ['brand']) ?? '';
  const modelNumber = firstText(product, ['model_number', 'modelNumber', 'model']) ?? '';
  const registrationStatus = draft.labeling === 'not_registered' ? 'notRegistered' : 'registered';
  const labeling = draft.labeling === 'registered_only' ? 'with_label' : draft.labeling;
  return {
    storeName: draft.storeName,
    product: {
      id: product?.id ?? draft.controlNumber,
      registrationStatus,
      controlNumber: draft.controlNumber,
      productType,
      brand,
      modelNumber,
      dynamicFields: product ?? {},
    },
    activityLogId,
    labeling: (labeling || null) as InspectionDraft['labeling'],
    placement: (draft.placement || null) as InspectionDraft['placement'],
    visualQuality: (draft.visualQuality || null) as InspectionDraft['visualQuality'],
    productDetails: (draft.productDetails || null) as InspectionDraft['productDetails'],
    comparisons: [],
    evidenceCount,
    remarks: draft.remarks,
  };
}

function inspectionOutcome(draft: Draft): 'compliant' | 'non_compliant' | 'unavailable' {
  if (hasNonCompliance(draft)) return 'non_compliant';
  return [draft.labeling, draft.placement, draft.visualQuality, draft.productDetails].every(Boolean)
    ? 'compliant'
    : 'unavailable';
}

function formatEvidenceTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? 'Time unavailable'
    : new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function inspectionStep(value: unknown): InspectionStep {
  return value === 'energyLabel' || value === 'energy_label' ? 'energyLabel' : value === 'checklist' ? 'checklist' : 'product';
}
