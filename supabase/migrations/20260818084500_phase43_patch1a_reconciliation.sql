-- PHASE 4.3 — PATCH 1A RECONCILIATION
-- 1. HARDEN STATE MACHINE TRIGGER
CREATE OR REPLACE FUNCTION public.fn_validate_walk_status_transition_v4()
RETURNS TRIGGER AS $$
BEGIN
    -- Terminal states cannot change
    IF OLD.current_status IN ('completed', 'cancelled', 'expired') AND NEW.current_status <> OLD.current_status THEN
        RAISE EXCEPTION 'Terminal status % cannot be changed', OLD.current_status;
    END IF;

    -- Strict status/current_status synchronization check
    IF NEW.status IS DISTINCT FROM NEW.current_status THEN
        RAISE EXCEPTION 'Status/Current Status mismatch detected';
    END IF;

    -- Strict transition blocking
    IF OLD.current_status = 'in_progress' AND NEW.current_status = 'completed' THEN
        RAISE EXCEPTION 'Cannot complete directly from in_progress. Must request return first.';
    END IF;
    
    IF OLD.current_status = 'in_progress' AND NEW.current_status = 'returning' AND (auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.walk_sessions WHERE id = NEW.id AND customer_id = auth.uid())) THEN
        RAISE EXCEPTION 'Only customer can request return';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_validate_walk_status_transition ON public.walk_sessions;
CREATE TRIGGER tr_validate_walk_status_transition
    BEFORE UPDATE ON public.walk_sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_validate_walk_status_transition_v4();
