-- Remove references to the dropped *_device_id columns from the sync RPCs.
--
-- Background: device enrollment was removed and these columns no longer exist:
--   inspections.owner_device_id
--   inspection_revisions.edited_by_device_id
--   inspection_evidence.uploaded_by_device_id
--   activity_events.device_id
-- push_inspection_revisions, push_activity_events and resolve_inspection_conflict
-- still INSERT into them, so every call fails with
--   42703 column "..." does not exist  ->  HTTP 400 from PostgREST.
--
-- CREATE OR REPLACE keeps existing grants/privileges. Signatures are unchanged.

CREATE OR REPLACE FUNCTION public.push_inspection_revisions(p_inspection_id uuid, p_revisions jsonb, p_events jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_account JSONB := public.current_account();
    v_account_id UUID;
    v_org_id UUID;
    v_username TEXT;
    v_role TEXT;
    v_current_head BIGINT;
    v_head_id UUID;
    v_base_revision BIGINT;
    v_candidate_head BIGINT;
    v_candidate_head_id UUID;
    v_conflict_id UUID;
BEGIN
    IF v_account IS NULL OR COALESCE((v_account ->> 'is_active')::BOOLEAN, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Personnel account is not active';
    END IF;

    v_account_id := (v_account ->> 'account_id')::UUID;
    v_org_id := (v_account ->> 'organization_id')::UUID;
    v_username := v_account ->> 'username';
    v_role := v_account ->> 'role';

    IF v_account_id IS NULL OR v_org_id IS NULL OR v_username IS NULL THEN
        RAISE EXCEPTION 'Personnel account is unavailable';
    END IF;

    IF jsonb_typeof(p_revisions) <> 'array' OR jsonb_array_length(p_revisions) = 0 THEN
        RAISE EXCEPTION 'At least one revision is required';
    END IF;

    SELECT current_revision, current_revision_id
      INTO v_current_head, v_head_id
      FROM public.inspections
     WHERE id = p_inspection_id
       AND organization_id = v_org_id
       AND (
           v_role = 'admin'
           OR EXISTS (
               SELECT 1
                 FROM public.organization_accounts AS owner
                WHERE owner.id = public.inspections.owner_account_id
                  AND owner.organization_id = v_org_id
                  AND owner.role = v_role
           )
       )
     FOR UPDATE;

    v_base_revision := (p_revisions -> 0 ->> 'base_revision')::BIGINT;
    v_candidate_head := (p_revisions -> (jsonb_array_length(p_revisions) - 1) ->> 'revision')::BIGINT;
    v_candidate_head_id := (p_revisions -> (jsonb_array_length(p_revisions) - 1) ->> 'id')::UUID;

    IF v_current_head IS NULL THEN
        IF v_base_revision <> 0 THEN
            RETURN jsonb_build_object('status', 'conflict', 'server_head', 0, 'server_head_id', NULL);
        END IF;

        INSERT INTO public.inspections (
            id, organization_id, owner_account_id, owner_username,
            current_revision, current_revision_id, created_at, updated_at
        ) VALUES (
            p_inspection_id, v_org_id, v_account_id, v_username,
            v_candidate_head, v_candidate_head_id, now(), now()
        );
        v_current_head := 0;
    END IF;

    IF v_current_head <> v_base_revision THEN
        IF v_head_id = v_candidate_head_id THEN
            RETURN jsonb_build_object('status', 'ok');
        END IF;

        v_conflict_id := extensions.gen_random_uuid();
        INSERT INTO public.inspection_conflicts (
            id, organization_id, inspection_id, candidate_revision_id,
            candidate_account_id, expected_base_revision, actual_head_revision,
            candidate_payload, status
        ) VALUES (
            v_conflict_id, v_org_id, p_inspection_id, v_candidate_head_id,
            v_account_id, v_base_revision, v_current_head, p_revisions, 'open'
        )
        ON CONFLICT (candidate_revision_id) DO NOTHING;

        RETURN jsonb_build_object(
            'status', 'conflict',
            'server_head', v_current_head,
            'server_head_id', v_head_id
        );
    END IF;

    INSERT INTO public.inspection_revisions (
        id, inspection_id, organization_id, revision, base_revision,
        parent_client_revision_id, payload,
        edited_by_account_id, edited_by_username, client_created_at
    )
    SELECT
        (r ->> 'id')::UUID, p_inspection_id, v_org_id,
        (r ->> 'revision')::BIGINT, (r ->> 'base_revision')::BIGINT,
        (r ->> 'parent_client_revision_id')::UUID, (r -> 'payload')::JSONB,
        v_account_id, v_username, (r ->> 'client_created_at')::TIMESTAMPTZ
      FROM jsonb_array_elements(p_revisions) AS r
    ON CONFLICT (inspection_id, revision) DO NOTHING;

    INSERT INTO public.inspection_evidence (
        id, inspection_id, organization_id, product_control_number, storage_path,
        mime_type, original_file_name, export_file_name, sha256, size_bytes,
        captured_at, display_order, uploaded_by_account_id
    )
    SELECT
        (e ->> 'id')::UUID,
        p_inspection_id,
        v_org_id,
        COALESCE(NULLIF(e ->> 'product_control_number', ''), r -> 'payload' ->> 'product_control_number'),
        e ->> 'remote_path',
        e ->> 'mime_type',
        e ->> 'original_file_name',
        e ->> 'export_file_name',
        e ->> 'sha256',
        (e ->> 'size_bytes')::BIGINT,
        (e ->> 'captured_at')::TIMESTAMPTZ,
        (e ->> 'display_order')::INTEGER,
        v_account_id
      FROM jsonb_array_elements(p_revisions) AS r
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r -> 'payload' -> 'evidence', '[]'::JSONB)) AS e
     WHERE e ->> 'remote_path' IS NOT NULL
    ON CONFLICT (id) DO UPDATE SET
        product_control_number = EXCLUDED.product_control_number,
        storage_path = EXCLUDED.storage_path,
        mime_type = EXCLUDED.mime_type,
        original_file_name = EXCLUDED.original_file_name,
        export_file_name = EXCLUDED.export_file_name,
        sha256 = EXCLUDED.sha256,
        size_bytes = EXCLUDED.size_bytes,
        captured_at = EXCLUDED.captured_at,
        display_order = EXCLUDED.display_order,
        uploaded_by_account_id = EXCLUDED.uploaded_by_account_id
     WHERE public.inspection_evidence.organization_id = v_org_id;

    INSERT INTO public.activity_events (
        id, organization_id, inspection_id, inspection_revision_id,
        account_id, username, event_type, payload, client_created_at
    )
    SELECT
        (e ->> 'id')::UUID, v_org_id, p_inspection_id,
        (e ->> 'inspection_revision_id')::UUID, v_account_id,
        v_username, e ->> 'event_type',
        COALESCE((e -> 'payload')::JSONB, '{}'::JSONB),
        (e ->> 'client_created_at')::TIMESTAMPTZ
      FROM jsonb_array_elements(COALESCE(p_events, '[]'::JSONB)) AS e
    ON CONFLICT (id) DO NOTHING;

    UPDATE public.inspections
       SET current_revision = v_candidate_head,
           current_revision_id = v_candidate_head_id,
           updated_at = now()
     WHERE id = p_inspection_id
       AND organization_id = v_org_id;

    RETURN jsonb_build_object('status', 'ok', 'new_revision_id', v_candidate_head_id);
END;
$function$;


CREATE OR REPLACE FUNCTION public.push_activity_events(p_events jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_account JSONB := public.current_account();
    v_account_id UUID;
    v_org_id UUID;
    v_username TEXT;
    v_role TEXT;
BEGIN
    IF v_account IS NULL OR COALESCE((v_account ->> 'is_active')::BOOLEAN, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Personnel account is not active';
    END IF;

    v_account_id := (v_account ->> 'account_id')::UUID;
    v_org_id := (v_account ->> 'organization_id')::UUID;
    v_username := v_account ->> 'username';
    v_role := v_account ->> 'role';

    INSERT INTO public.activity_events (
        id, organization_id, inspection_id, inspection_revision_id,
        account_id, username, event_type, payload, client_created_at
    )
    SELECT
        (e ->> 'id')::UUID, v_org_id, (e ->> 'inspection_id')::UUID,
        (e ->> 'inspection_revision_id')::UUID, v_account_id,
        v_username, e ->> 'event_type',
        COALESCE((e -> 'payload')::JSONB, '{}'::JSONB),
        (e ->> 'client_created_at')::TIMESTAMPTZ
      FROM jsonb_array_elements(COALESCE(p_events, '[]'::JSONB)) AS e
     WHERE (e ->> 'inspection_id') IS NULL
        OR EXISTS (
            SELECT 1
              FROM public.inspections AS inspection
             WHERE inspection.id = (e ->> 'inspection_id')::UUID
               AND inspection.organization_id = v_org_id
               AND (
                   v_role = 'admin'
                   OR EXISTS (
                       SELECT 1
                         FROM public.organization_accounts AS owner
                        WHERE owner.id = inspection.owner_account_id
                          AND owner.organization_id = v_org_id
                          AND owner.role = v_role
                   )
               )
        )
    ON CONFLICT (id) DO NOTHING;

    RETURN jsonb_build_object('status', 'ok');
END;
$function$;


CREATE OR REPLACE FUNCTION public.resolve_inspection_conflict(p_conflict_id uuid, p_inspection_id uuid, p_expected_head_revision bigint, p_resolved_revision jsonb, p_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_account JSONB := public.current_account();
    v_account_id UUID;
    v_org_id UUID;
    v_username TEXT;
    v_role TEXT;
    v_current_head BIGINT;
    v_head_id UUID;
    v_status TEXT;
    v_resolved_id UUID := (p_resolved_revision ->> 'id')::UUID;
BEGIN
    IF v_account IS NULL OR COALESCE((v_account ->> 'is_active')::BOOLEAN, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Personnel account is not active';
    END IF;

    v_account_id := (v_account ->> 'account_id')::UUID;
    v_org_id := (v_account ->> 'organization_id')::UUID;
    v_username := v_account ->> 'username';
    v_role := v_account ->> 'role';

    SELECT current_revision, current_revision_id
      INTO v_current_head, v_head_id
      FROM public.inspections
     WHERE id = p_inspection_id
       AND organization_id = v_org_id
       AND (
           v_role = 'admin'
           OR EXISTS (
               SELECT 1
                 FROM public.organization_accounts AS owner
                WHERE owner.id = public.inspections.owner_account_id
                  AND owner.organization_id = v_org_id
                  AND owner.role = v_role
           )
       )
     FOR UPDATE;

    IF v_current_head IS NULL THEN
        RAISE EXCEPTION 'Inspection not found';
    END IF;

    IF v_current_head <> p_expected_head_revision THEN
        RETURN jsonb_build_object(
            'status', 'conflict',
            'server_head', v_current_head,
            'server_head_id', v_head_id
        );
    END IF;

    SELECT status
      INTO v_status
      FROM public.inspection_conflicts
     WHERE id = p_conflict_id
       AND inspection_id = p_inspection_id
       AND organization_id = v_org_id
     FOR UPDATE;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Conflict not found';
    END IF;

    IF v_status = 'resolved' THEN
        RETURN jsonb_build_object('status', 'ok', 'new_revision_id', v_resolved_id);
    END IF;

    INSERT INTO public.inspection_revisions (
        id, inspection_id, organization_id, revision, base_revision,
        parent_client_revision_id, payload,
        edited_by_account_id, edited_by_username, client_created_at
    ) VALUES (
        v_resolved_id, p_inspection_id, v_org_id,
        (p_resolved_revision ->> 'revision')::BIGINT,
        (p_resolved_revision ->> 'base_revision')::BIGINT,
        (p_resolved_revision ->> 'parent_client_revision_id')::UUID,
        (p_resolved_revision -> 'payload')::JSONB,
        v_account_id, v_username,
        (p_resolved_revision ->> 'client_created_at')::TIMESTAMPTZ
    )
    ON CONFLICT (inspection_id, revision) DO NOTHING;

    INSERT INTO public.activity_events (
        id, organization_id, inspection_id, inspection_revision_id,
        account_id, username, event_type, payload, client_created_at
    ) VALUES (
        (p_event ->> 'id')::UUID, v_org_id, p_inspection_id, v_resolved_id,
        v_account_id, v_username, p_event ->> 'event_type',
        COALESCE((p_event -> 'payload')::JSONB, '{}'::JSONB),
        (p_event ->> 'client_created_at')::TIMESTAMPTZ
    )
    ON CONFLICT (id) DO NOTHING;

    UPDATE public.inspection_conflicts
       SET status = 'resolved',
           resolved_revision_id = v_resolved_id,
           resolved_at = now(),
           change_cursor = nextval('public.inspection_change_cursor_seq')
     WHERE id = p_conflict_id;

    UPDATE public.inspections
       SET current_revision = (p_resolved_revision ->> 'revision')::BIGINT,
           current_revision_id = v_resolved_id,
           updated_at = now()
     WHERE id = p_inspection_id
       AND organization_id = v_org_id;

    RETURN jsonb_build_object('status', 'ok', 'new_revision_id', v_resolved_id);
END;
$function$;
