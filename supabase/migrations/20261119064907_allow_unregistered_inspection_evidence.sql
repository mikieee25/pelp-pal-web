-- Unregistered products have no control number. Keep their evidence metadata
-- instead of rejecting the entire inspection sync transaction.
ALTER TABLE public.inspection_evidence
  ALTER COLUMN product_control_number DROP NOT NULL;
