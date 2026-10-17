'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, X } from 'lucide-react';
import { getBrowserRepository } from '@/lib/db/browser';
import type { CatalogRecord, EvidenceRecord } from '@/lib/db/records';
import { getLocalSession } from '@/lib/auth/local-session-store';
import { CatalogDetails } from '@/features/catalog/catalog-details';
import { optimizeEvidenceImage } from '@/lib/evidence/image-optimization';
import { MAX_EVIDENCE_IMAGES, MAX_EVIDENCE_IMAGES_MESSAGE } from '@/lib/evidence/validation';
import { validateInspectionDraft, type InspectionDraft } from '@/features/inspection/validator';
import { resolveInspectionProduct, type InspectionProductSource } from '@/lib/db/inspection-enrichment';
import { startSyncRuntime } from '@/lib/sync/runtime';
import { ActionBar, InlineNotice, PageHeader, PageShell, Section, Surface } from '@/components/ui';
import { AccessibleModal } from '@/components/ui/accessible-overlay';
import { AccessibleSelect } from '@/components/ui/accessible-overlay';
import { normalizeInspectionAnswers } from '@/lib/inspection-outcome';

type InspectionStep = 'product' | 'energyLabel' | 'checklist';

type Draft = {
  storeName: string;
  controlNumber: string;
  price: string;
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
  price: '',
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

const inputClass = 'min-h-12 w-full rounded-[10px] border border-border-strong bg-white px-3 text-base text-ink outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-surface-alt disabled:text-muted';
const secondaryButton = 'inline-flex min-h-11 items-center justify-center rounded-[10px] border border-border-strong bg-white px-4 text-sm font-semibold text-primary hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50';
const primaryButton = 'inline-flex min-h-11 items-center justify-center rounded-[10px] bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50';

type EvidenceImage = EvidenceRecord & { blob?: Blob; previewUrl?: string };

export function InspectionEditor({ inspectionId, catalogId, readOnly = false }: { inspectionId: string; catalogId?: string; readOnly?: boolean }) {
  const repository = useMemo(() => getBrowserRepository(), []);
  const router = useRouter();
  const [resolvedInspectionId] = useState(() => inspectionId === 'new' ? crypto.randomUUID() : inspectionId);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [catalogProduct, setCatalogProduct] = useState<CatalogRecord>();
  const [productSource, setProductSource] = useState<InspectionProductSource>('unavailable');
  const [inspectionStore, setInspectionStore] = useState<{ name: string; storeId?: string; location?: string }>();
  const [evidence, setEvidence] = useState<EvidenceImage[]>([]);
  const [step, setStep] = useState<InspectionStep>('product');
  const [loaded, setLoaded] = useState(false);
  const [stepError, setStepError] = useState<string>();
  const [evidenceError, setEvidenceError] = useState<string>();
  const [evidenceNotice, setEvidenceNotice] = useState<string>();
  const [remotePhotoStates, setRemotePhotoStates] = useState<Record<string, { state: 'loading' | 'unavailable' | 'offline' | 'error'; message?: string }>>({});
  const [completionError, setCompletionError] = useState<string>();
  const [duplicateInspection, setDuplicateInspection] = useState<Record<string, unknown>>();
  const [updatedBy, setUpdatedBy] = useState<string>();
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [viewingEvidence, setViewingEvidence] = useState<EvidenceImage>();
  const [evidenceZoom, setEvidenceZoom] = useState(1);
  const previewUrls = useRef(new Set<string>());
  const completionLock = useRef(false);

  useEffect(() => {
    if (inspectionId !== 'new') return;
    const suffix = catalogId ? `?catalogId=${encodeURIComponent(catalogId)}` : '';
    router.replace(`/inspect/${resolvedInspectionId}${suffix}`, { scroll: false });
  }, [catalogId, inspectionId, resolvedInspectionId, router]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [savedDraft, completedInspection, savedEvidence, currentStore] = await Promise.all([
          repository.getInspectionDraft(resolvedInspectionId),
          repository.getInspection(resolvedInspectionId),
          repository.listEvidenceImages(resolvedInspectionId),
          repository.getCurrentStore(),
        ]);
        const storedCatalogId = textValue(completedInspection?.catalogId) || textValue(completedInspection?.catalog_id);
        const product = await repository.getCatalogById(catalogId || storedCatalogId);
        const resolved = resolveInspectionProduct(completedInspection, product);
        const resolvedProduct = resolved.product;

        if (!active) return;
        setCatalogProduct(resolvedProduct);
        setProductSource(resolved.source);
        if (completedInspection) {
          setInspectionStore({
            name: textValue(completedInspection.storeName) || textValue(completedInspection.store_name),
            storeId: textValue(completedInspection.storeId) || textValue(completedInspection.store_id) || undefined,
            location: textValue(completedInspection.location) || textValue(completedInspection.storeLocation) || textValue(completedInspection.store_location) || undefined,
          });
        }
        setEvidence(savedEvidence.map((image) => toEvidenceImage(image, previewUrls.current)));
        const productControlNumber = resolvedProduct ? firstText(resolvedProduct, ['control_number', 'product_control_number', 'controlNumber']) ?? '' : '';
        const saved = readOnly ? completedInspection ?? savedDraft : savedDraft ?? completedInspection;
        if (saved) {
          const answers = normalizeInspectionAnswers(saved, completedInspection ?? undefined);
          if (completedInspection) setUpdatedBy(textValue(completedInspection.username) || textValue(completedInspection.updatedBy));
          const restoredStep = inspectionStep(saved.currentStep);
          setDraft({
            storeName: textValue(saved.storeName) || currentStore?.name || '',
            controlNumber: textValue(saved.controlNumber) || productControlNumber,
            price: textValue(saved.price) || textValue(saved.retailPrice) || textValue(saved.retail_price),
            remarks: textValue(saved.remarks),
            labeling: answers.labeling,
            placement: answers.placement,
            visualQuality: answers.visualQuality,
            productDetails: answers.productDetails,
            currentStep: restoredStep,
          });
          setStep(readOnly ? 'product' : restoredStep);
        } else {
          setDraft({ ...emptyDraft, controlNumber: productControlNumber, storeName: currentStore?.name || '' });
        }
        setLoaded(true);
      } catch {
        if (active) {
          setSaveState('error');
          setLoaded(true);
        }
      }
    };
    void load();
    return () => { active = false; };
  }, [catalogId, inspectionId, readOnly, repository, resolvedInspectionId]);

  useEffect(() => {
    const missing = evidence.filter((image) => !image.previewUrl && image.remotePath && !remotePhotoStates[image.id]);
    if (!loaded || inspectionId === 'new' || !missing.length || !repository.ensureRemoteEvidence) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      queueMicrotask(() => setRemotePhotoStates((current) => ({
        ...current,
        ...Object.fromEntries(missing.map((image) => [image.id, { state: 'offline' as const }])),
      })));
      return;
    }
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) setRemotePhotoStates((current) => Object.fromEntries([...Object.entries(current), ...missing.map((image) => [image.id, { state: 'loading' as const }])]));
    });
    void startSyncRuntime().then(() => repository.ensureRemoteEvidence!(resolvedInspectionId, { signal: controller.signal })).then(async (results) => {
      const updated = await repository.listEvidenceImages(resolvedInspectionId);
      setEvidence((current) => {
        const currentById = new Map(current.map((image) => [image.id, image]));
        return updated.map((image) => ({ ...image, previewUrl: image.blob ? currentById.get(image.id)?.previewUrl ?? createPreviewUrl(image.blob, previewUrls.current) : undefined }));
      });
      setRemotePhotoStates((current) => {
        const next = { ...current };
        for (const result of results) {
          if (result.status === 'unavailable') next[result.evidenceId] = { state: 'unavailable' };
          else if (result.status === 'failed') next[result.evidenceId] = { state: 'error', message: result.message };
          else if (result.status === 'offline') next[result.evidenceId] = { state: 'offline' };
          else delete next[result.evidenceId];
        }
        for (const image of missing) if (!results.some((result) => result.evidenceId === image.id)) next[image.id] = { state: 'error', message: 'Photo download did not return a result.' };
        return next;
      });
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setRemotePhotoStates((current) => Object.fromEntries([...Object.entries(current), ...missing.map((image) => [image.id, { state: 'error' as const, message: error instanceof Error ? error.message : 'Photo could not be downloaded.' }])]));
    });
    return () => controller.abort();
  }, [evidence, inspectionId, loaded, remotePhotoStates, repository, resolvedInspectionId]);

  useEffect(() => () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    const retryOfflinePhotos = () => setRemotePhotoStates((current) => Object.fromEntries(Object.entries(current).filter(([, value]) => value.state !== 'offline')));
    window.addEventListener('online', retryOfflinePhotos);
    return () => window.removeEventListener('online', retryOfflinePhotos);
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
    setEvidenceNotice(undefined);
    const remaining = MAX_EVIDENCE_IMAGES - evidence.length;
    if (remaining <= 0) {
      setEvidenceError(MAX_EVIDENCE_IMAGES_MESSAGE);
      return;
    }

    const savedImages: EvidenceImage[] = [];
    let duplicateSkipped = false;
    let limitReached = false;
    for (const file of files) {
      if (evidence.length + savedImages.length >= MAX_EVIDENCE_IMAGES) {
        limitReached = true;
        break;
      }
      try {
        if (!file.type.startsWith('image/')) {
          throw new Error('Only image files can be added as evidence.');
        }
        const optimized = await optimizeEvidenceImage(file);
        const saved = await repository.saveEvidenceImage(resolvedInspectionId, optimized, {
          fileName: file.name,
          capturedAt: new Date().toISOString(),
        });
        savedImages.push({ ...saved, blob: optimized, previewUrl: createPreviewUrl(optimized, previewUrls.current) });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Evidence image could not be saved locally.';
        if (/already attached/i.test(message)) duplicateSkipped = true;
        else setEvidenceError(message);
      }
    }
    if (savedImages.length) setEvidence((current) => [...current, ...savedImages]);
    if (duplicateSkipped) setEvidenceNotice('That photo is already attached to this inspection.');
    if (limitReached) setEvidenceError(MAX_EVIDENCE_IMAGES_MESSAGE);
  };

  const removeEvidenceImage = async (id: string) => {
    const image = evidence.find((item) => item.id === id);
    if (!image) return;
    try {
      await repository.deleteEvidenceImage(id);
      if (image.previewUrl) {
        URL.revokeObjectURL(image.previewUrl);
        previewUrls.current.delete(image.previewUrl);
      }
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
      if (existing.previewUrl) {
        URL.revokeObjectURL(existing.previewUrl);
        previewUrls.current.delete(existing.previewUrl);
      }
      const next = { ...saved, blob: optimized, previewUrl: createPreviewUrl(optimized, previewUrls.current) };
      setEvidence((current) => current.map((item) => item.id === id ? next : item));
      if (viewingEvidence?.id === id) setViewingEvidence(next);
      setEvidenceError(undefined);
    } catch (error) {
      setEvidenceError(error instanceof Error ? error.message : 'Evidence image could not be replaced locally.');
    }
  };

  const finishInspection = async (allowDuplicate = false) => {
    if (completionLock.current) return;
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

    completionLock.current = true;
    setCompletionError(undefined);
    setSaveState('saving');
    try {
      const currentStore = inspectionStore ?? await repository.getCurrentStore();
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
        price: draft.price.trim(),
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
        retailPrice: draft.price.trim() || catalogFieldText(catalogProduct, ['retailPrice', 'retail_price', 'Retail Price', 'Latest Average Price', 'latestAveragePrice']),
      });
      void startSyncRuntime()
        .then((runtime) => runtime?.coordinator.syncNow('manual', 'upload'))
        .catch(() => undefined);
      router.push('/activity');
    } catch {
      setSaveState('error');
      setCompletionError('Inspection could not be finished locally. Your draft is still available.');
    } finally {
      completionLock.current = false;
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

  const saveDraftNow = async () => {
    setSaveState('saving');
    try {
      await repository.saveInspectionDraft(resolvedInspectionId, { ...draft, currentStep: step });
      setSaveState('saved');
    } catch {
      setSaveState('error');
      setCompletionError('The inspection draft could not be saved locally. Keep this page open and retry.');
    }
  };

  const openEvidenceViewer = (image: EvidenceImage) => {
    if (!image.previewUrl) return;
    setViewingEvidence(image);
    setEvidenceZoom(1);
  };

  const retryRemoteEvidence = (image: EvidenceImage) => {
    setRemotePhotoStates((current) => ({ ...current, [image.id]: { state: 'loading' } }));
    void startSyncRuntime().then(() => repository.ensureRemoteEvidence?.(resolvedInspectionId)).then(async (downloadResults = []) => {
      const result = downloadResults.find((item) => item.evidenceId === image.id);
      const updated = await repository.listEvidenceImages(resolvedInspectionId);
      const replacement = updated.find((item) => item.id === image.id);
      if (replacement?.blob) {
        const previewUrl = createPreviewUrl(replacement.blob, previewUrls.current);
        setEvidence((current) => current.map((item) => item.id === image.id ? { ...replacement, previewUrl } : item));
        setRemotePhotoStates((current) => { const next = { ...current }; delete next[image.id]; return next; });
      } else if (result?.status === 'unavailable') setRemotePhotoStates((current) => ({ ...current, [image.id]: { state: 'unavailable' } }));
      else setRemotePhotoStates((current) => ({ ...current, [image.id]: { state: 'error', message: result?.message } }));
    }).catch((error) => setRemotePhotoStates((current) => ({ ...current, [image.id]: { state: 'error', message: error instanceof Error ? error.message : 'Photo could not be downloaded.' } })));
  };

  const closeEvidenceViewer = () => {
    setViewingEvidence(undefined);
    setEvidenceZoom(1);
  };

  return <PageShell>
    <div className="space-y-6">
      <PageHeader title="Inspection" subtitle={updatedBy ? <>Updated by: <strong>{updatedBy}</strong></> : undefined} actions={<span role="status" className={`rounded-lg px-2.5 py-1 text-sm font-semibold ${saveState === 'error' ? 'bg-danger-soft text-danger' : 'bg-surface-alt text-muted'}`}>{readOnly ? 'View only' : saveState === 'saving' ? 'Saving' : saveState === 'saved' ? 'Saved locally' : saveState === 'error' ? 'Save failed' : 'Draft'}</span>} />
      <form onSubmit={handleContinue} className="space-y-6">
          <StepProgress currentStep={step} />
          {saveState === 'error' && <InlineNotice severity="error">{completionError ?? 'The inspection draft could not be saved locally. Keep this page open and retry.'}</InlineNotice>}
          {step === 'product' && <ProductStep draft={draft} stepError={stepError} readOnly={readOnly} onChange={updateDraft} />}
          {step === 'energyLabel' && <EnergyLabelStep draft={draft} catalogProduct={catalogProduct} productSource={productSource} />}
          {step === 'checklist' && <ChecklistStep draft={draft} evidence={evidence} evidenceError={evidenceError} evidenceNotice={evidenceNotice} remotePhotoStates={remotePhotoStates} readOnly={readOnly} onChange={updateDraft} onAddEvidence={addEvidenceImages} onRemoveEvidence={(id) => void removeEvidenceImage(id)} onReplaceEvidence={replaceEvidenceImage} onOpenEvidence={openEvidenceViewer} onRetryRemoteEvidence={retryRemoteEvidence} />}
          <ActionBar className="sm:justify-between">
            <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" onClick={() => router.push('/activity')} className={secondaryButton}>Back to Activity</button>
                <button type="button" onClick={goBack} disabled={step === 'product'} className={secondaryButton}>Back</button>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {!readOnly && <button type="button" onClick={() => void saveDraftNow()} disabled={saveState === 'saving'} className={secondaryButton}>Save draft</button>}
                {readOnly
                  ? step === 'checklist'
                    ? <button type="button" onClick={() => router.push('/activity')} className={primaryButton}>Done</button>
                    : <button type="submit" className={primaryButton}>{step === 'product' ? 'Continue' : 'Continue to checklist'}</button>
                  : <button type="submit" disabled={step === 'checklist' && saveState === 'saving'} className={primaryButton}>{step === 'product' ? 'Continue' : step === 'energyLabel' ? 'Continue to checklist' : 'Complete'}</button>}
              </div>
            </div>
          </ActionBar>
      </form>
    </div>
    {duplicateInspection && <AccessibleModal onClose={() => setDuplicateInspection(undefined)} labelledBy="duplicate-inspection-title" className="max-w-md rounded-2xl bg-white p-5 shadow-xl">
      <h2 id="duplicate-inspection-title" className="text-lg font-semibold text-ink">Product already inspected</h2>
      <p className="mt-3 text-sm text-muted">
        This product was already inspected at this store by {textValue(duplicateInspection?.username) || 'the same inspector'}. Do you want to save another inspection anyway?
      </p>
      <div className="mt-5 flex flex-col justify-end gap-2 sm:flex-row"><button type="button" onClick={() => setDuplicateInspection(undefined)} className={secondaryButton}>Cancel</button><button type="button" onClick={() => { setDuplicateInspection(undefined); void finishInspection(true); }} className={primaryButton}>Continue anyway</button></div>
    </AccessibleModal>}
    {viewingEvidence && <AccessibleModal onClose={closeEvidenceViewer} labelledBy="evidence-viewer-title" className="flex max-h-[calc(100dvh-24px)] max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl" backdropClassName="bg-black/70">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3"><h2 id="evidence-viewer-title" className="min-w-0 truncate font-semibold text-ink">{viewingEvidence.fileName}</h2><button type="button" onClick={closeEvidenceViewer} aria-label="Close" className="rounded-lg p-2 text-muted hover:bg-surface-alt"><X aria-hidden className="size-5" /></button></div>
      <div className="grid min-h-[280px] flex-1 place-items-center overflow-auto bg-gray-900 p-2 sm:min-h-[420px] sm:p-4">{viewingEvidence.previewUrl && (
        // Local blob URLs are already decoded by the browser; next/image cannot optimize them.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={viewingEvidence.previewUrl} alt={`Evidence image ${viewingEvidence.displayOrder + 1}`} className="max-h-[calc(100dvh-220px)] max-w-full object-contain transition-transform duration-150 motion-reduce:transition-none" style={{ transform: `scale(${evidenceZoom})` }} />
      )}</div>
      <div className="flex flex-wrap items-center justify-center gap-2 border-t border-border p-3"><button type="button" onClick={() => setEvidenceZoom((value) => Math.max(0.5, value - 0.25))} disabled={evidenceZoom <= 0.5} className={secondaryButton}>Zoom out</button><span className="min-w-12 text-center text-sm text-muted">{Math.round(evidenceZoom * 100)}%</span><button type="button" onClick={() => setEvidenceZoom((value) => Math.min(3, value + 0.25))} disabled={evidenceZoom >= 3} className={secondaryButton}>Zoom in</button><button type="button" onClick={() => setEvidenceZoom(1)} disabled={evidenceZoom === 1} className={secondaryButton}>Reset</button>{viewingEvidence.previewUrl && <a href={viewingEvidence.previewUrl} download={viewingEvidence.fileName} className={primaryButton}>Download</a>}<button type="button" onClick={closeEvidenceViewer} className={secondaryButton}>Close</button></div>
    </AccessibleModal>}
  </PageShell>;
}

function ProductStep({ draft, stepError, readOnly, onChange }: { draft: Draft; stepError?: string; readOnly: boolean; onChange: (changes: Partial<Draft>) => void }) {
  return <Section title="Confirm the product">
    <div className="space-y-4">
      <p className="text-sm text-muted">These details come from the catalog stored on this device.</p>
      <label className="block space-y-1.5 text-sm font-medium text-ink">Store name<input className={inputClass} value={draft.storeName} onChange={(event) => onChange({ storeName: event.target.value })} disabled={readOnly} /></label>
      <label className="block space-y-1.5 text-sm font-medium text-ink">Product control number<input className={inputClass} value={draft.controlNumber} onChange={(event) => onChange({ controlNumber: event.target.value })} disabled={readOnly} aria-invalid={Boolean(stepError)} aria-describedby={stepError ? 'control-number-error' : undefined} />{stepError && <span id="control-number-error" className="block text-sm text-danger">{stepError}</span>}</label>
      <div><label htmlFor="inspection-price" className="block space-y-1.5 text-sm font-medium text-ink">Price<input id="inspection-price" className={inputClass} inputMode="decimal" value={draft.price} onChange={(event) => onChange({ price: event.target.value })} disabled={readOnly} /></label><span className="mt-1 block text-xs text-muted">Optional</span></div>
      <label className="block space-y-1.5 text-sm font-medium text-ink">Remarks<textarea className={`${inputClass} min-h-28 py-3`} rows={4} value={draft.remarks} onChange={(event) => onChange({ remarks: event.target.value })} disabled={readOnly} /></label>
    </div>
  </Section>;
}

function EnergyLabelStep({ draft, catalogProduct, productSource }: { draft: Draft; catalogProduct?: CatalogRecord; productSource: InspectionProductSource }) {
  return <Section title="Review the Energy Label">
    <div className="space-y-4">
      <p className="text-sm text-muted">Review the registered product values before completing the compliance checklist.</p>
      <InlineNotice severity="info">The QR code and catalog identity are linked to this inspection.</InlineNotice>
      {catalogProduct ? <ProductSummary product={catalogProduct} source={productSource} /> : <InlineNotice severity="warning">No product snapshot was found. Confirm the control number manually.</InlineNotice>}
      <p className="text-sm text-muted">Control number: <strong className="font-mono text-[13px] text-ink">{draft.controlNumber}</strong></p>
    </div>
  </Section>;
}

function ChecklistStep({ draft, evidence, evidenceError, evidenceNotice, remotePhotoStates, readOnly, onChange, onAddEvidence, onRemoveEvidence, onReplaceEvidence, onOpenEvidence, onRetryRemoteEvidence }: { draft: Draft; evidence: EvidenceImage[]; evidenceError?: string; evidenceNotice?: string; remotePhotoStates: Record<string, { state: 'loading' | 'unavailable' | 'offline' | 'error'; message?: string }>; readOnly: boolean; onChange: (changes: Partial<Draft>) => void; onAddEvidence: (event: React.ChangeEvent<HTMLInputElement>) => void; onRemoveEvidence: (id: string) => void; onReplaceEvidence: (id: string, event: React.ChangeEvent<HTMLInputElement>) => void; onOpenEvidence: (image: EvidenceImage) => void; onRetryRemoteEvidence: (image: EvidenceImage) => void }) {
  return <Section title="Compliance checklist">
    <div className="space-y-4">
    <p className="text-sm text-muted">Record the inspector’s assessment for this product.</p>
    <AccessibleSelect id="inspection-labeling" label="Labeling requirements" value={draft.labeling} onChange={(labeling) => onChange({ labeling })} disabled={readOnly} options={[{ value: '', label: 'Select an answer' }, { value: 'with_label', label: 'With Label' }, { value: 'with_coe', label: 'With COE' }, { value: 'registered_only', label: 'Registered Only (NC)' }, { value: 'not_registered', label: 'Not Registered (NC)' }]} />
    <ComplianceToggle label="Energy label placement" value={draft.placement} readOnly={readOnly} onChange={(placement) => onChange({ placement })} />
    <ComplianceToggle label="Visual quality" value={draft.visualQuality} readOnly={readOnly} onChange={(visualQuality) => onChange({ visualQuality })} />
    <ComplianceToggle label="Product details" value={draft.productDetails} readOnly={readOnly} onChange={(productDetails) => onChange({ productDetails })} />
    <EvidenceSection evidence={evidence} error={evidenceError} notice={evidenceNotice} remotePhotoStates={remotePhotoStates} readOnly={readOnly} onAdd={onAddEvidence} onRemove={onRemoveEvidence} onReplace={onReplaceEvidence} onOpen={onOpenEvidence} onRetry={onRetryRemoteEvidence} />
    <label className="block space-y-1.5 text-sm font-medium text-ink">Remarks / description of non-compliance<textarea className={`${inputClass} min-h-28 py-3`} rows={4} value={draft.remarks} onChange={(event) => onChange({ remarks: event.target.value })} disabled={readOnly} /></label>
    </div>
  </Section>;
}

function EvidenceSection({ evidence, error, notice, remotePhotoStates, readOnly, onAdd, onRemove, onReplace, onOpen, onRetry }: { evidence: EvidenceImage[]; error?: string; notice?: string; remotePhotoStates: Record<string, { state: 'loading' | 'unavailable' | 'offline' | 'error'; message?: string }>; readOnly: boolean; onAdd: (event: React.ChangeEvent<HTMLInputElement>) => void; onRemove: (id: string) => void; onReplace: (id: string, event: React.ChangeEvent<HTMLInputElement>) => void; onOpen: (image: EvidenceImage) => void; onRetry: (image: EvidenceImage) => void }) {
  return <Section title="Evidence photos">
    <div className="space-y-3">
      <p className="text-sm text-muted">Optional when all findings are Complied. Required when any finding is NC.</p>
      {error && <InlineNotice severity="error">{error}</InlineNotice>}{notice && <InlineNotice>{notice}</InlineNotice>}
      <div data-testid="evidence-grid" data-column-count="2" className="grid grid-cols-2 gap-3">
        {evidence.map((image, index) => <Surface key={image.id} className="overflow-hidden">
          {image.previewUrl ? <button type="button" onClick={() => onOpen(image)} aria-label={`View evidence image ${index + 1}`} className="block w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            {/* Local blob URLs are already decoded by the browser; next/image cannot optimize them. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.previewUrl} alt={`Evidence image ${index + 1}`} className="block aspect-[4/3] w-full bg-surface-alt object-cover" />
          </button>
            : remotePhotoStates[image.id]?.state === 'loading' ? <div aria-label={`Loading evidence image ${index + 1}`} className="aspect-[4/3] animate-pulse bg-surface-alt motion-reduce:animate-none" />
              : <div role="img" aria-label={`Evidence image ${index + 1} unavailable`} className="grid min-h-[120px] place-items-center bg-surface-alt px-3 text-center text-sm text-muted"><div className="space-y-2">{remotePhotoStates[image.id]?.state === 'unavailable' ? 'Photo not available yet.' : remotePhotoStates[image.id]?.state === 'offline' ? 'Photo is not on this device. Connect to the internet to download it.' : remotePhotoStates[image.id]?.message || 'Photo could not be downloaded.'}{remotePhotoStates[image.id]?.state === 'error' && <button type="button" onClick={() => onRetry(image)} className={secondaryButton}>Retry</button>}</div></div>}
          <div className="space-y-2 p-3"><p className="text-xs leading-4 text-muted">Captured {formatEvidenceTimestamp(image.capturedAt)} · {evidenceStatusLabel(image.syncStatus, Boolean(image.blob))}</p>
            {!readOnly && <div className="flex flex-wrap gap-2"><label className={`${secondaryButton} cursor-pointer`}>Replace<input className="sr-only" type="file" accept="image/*" capture="environment" onChange={(event) => onReplace(image.id, event)} /></label><button type="button" className="inline-flex min-h-11 items-center justify-center rounded-[10px] px-3 text-sm font-semibold text-danger hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-focus" onClick={() => onRemove(image.id)}>Remove</button></div>}</div>
        </Surface>)}
        {!readOnly && <label role="button" tabIndex={evidence.length >= MAX_EVIDENCE_IMAGES ? -1 : 0} aria-label="Add photo" onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.querySelector('input')?.click(); } }} className={`flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong text-primary hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-focus ${evidence.length >= MAX_EVIDENCE_IMAGES ? 'pointer-events-none opacity-50' : ''}`}>
          <Camera aria-hidden className="size-6" /><span className="text-sm font-semibold">Add photo</span><input className="sr-only" type="file" accept="image/*" multiple capture="environment" onChange={onAdd} disabled={evidence.length >= MAX_EVIDENCE_IMAGES} />
        </label>}
      </div>
    </div>
  </Section>;
}

function evidenceStatusLabel(status: EvidenceImage['syncStatus'], hasLocalImage: boolean): string {
  if (!hasLocalImage) return 'Image unavailable on this browser';
  if (status === 'unavailable') return 'Image unavailable on this browser';
  if (status === 'synced') return 'Synced to shared mirror';
  if (status === 'pending') return 'Waiting for upload';
  return 'Saved on this device';
}

function ComplianceToggle({ label, value, readOnly, onChange }: { label: string; value: string; readOnly: boolean; onChange: (value: string) => void }) {
  const id = label.toLowerCase().replaceAll(' ', '-');
  return <fieldset className="min-w-0"><legend id={`${id}-label`} className="text-sm font-medium text-ink">{label}</legend><div role="group" aria-labelledby={`${id}-label`} className="mt-2 grid grid-cols-2 overflow-hidden rounded-[10px] border border-border-strong">
    <button type="button" aria-pressed={value === 'passing'} disabled={readOnly} onClick={() => onChange(value === 'passing' ? '' : 'passing')} className={`min-h-12 px-3 text-sm font-semibold focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50 ${value === 'passing' ? 'bg-success-soft text-success' : 'bg-white text-ink hover:bg-surface-alt'}`}>Complied</button>
    <button type="button" aria-pressed={value === 'failing'} disabled={readOnly} onClick={() => onChange(value === 'failing' ? '' : 'failing')} className={`min-h-12 border-l border-border-strong px-3 text-sm font-semibold focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50 ${value === 'failing' ? 'bg-danger-soft text-danger' : 'bg-white text-ink hover:bg-surface-alt'}`}>NC</button>
  </div></fieldset>;
}

function ProductSummary({ product, source }: { product: CatalogRecord; source: InspectionProductSource }) {
  const label = source === 'catalog' ? 'Registered product' : 'Inspection product snapshot';
  return <Surface className="p-4"><div className="space-y-3"><div className="flex items-center justify-between gap-2"><h3 className="font-semibold text-ink">{label}</h3><span className="rounded-lg border border-border px-2 py-1 text-xs text-muted">{source === 'catalog' ? 'Catalog' : 'Saved with inspection'}</span></div><CatalogDetails row={product} defaultExpanded /></div></Surface>;
}

function StepProgress({ currentStep }: { currentStep: InspectionStep }) {
  const activeIndex = Math.max(0, steps.findIndex((item) => item.key === currentStep));

  return <ol
    aria-label="Inspection progress"
    className="flex w-full items-center overflow-x-auto pb-1"
  >
    {steps.map((item, index) => {
      const isActive = index === activeIndex;
      const isComplete = index < activeIndex;
      return <li
        key={item.key}
        className={`flex min-w-0 items-center ${index < steps.length - 1 ? 'flex-1' : 'shrink-0'}`}
      >
        <span
          aria-label={`${index + 1}. ${item.label}`}
          aria-current={isActive ? 'step' : undefined}
          className={`flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-3 text-xs sm:px-4 sm:text-sm ${isActive ? 'border-primary bg-primary font-semibold text-white' : isComplete ? 'border-primary/40 bg-primary-soft font-semibold text-primary' : 'border-border bg-white text-ink'}`}
        >
          {index + 1}. {item.label}
        </span>
        {index < steps.length - 1 && <span
          aria-hidden="true"
          className={`mx-1 h-0.5 min-w-3 flex-1 sm:mx-2 sm:min-w-7 ${isComplete ? 'bg-primary' : 'bg-border'}`}
        />}
      </li>;
    })}
  </ol>;
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

function toEvidenceImage(image: EvidenceRecord & { blob?: Blob }, previewUrls: Set<string>): EvidenceImage {
  return { ...image, previewUrl: image.blob ? createPreviewUrl(image.blob, previewUrls) : undefined };
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
