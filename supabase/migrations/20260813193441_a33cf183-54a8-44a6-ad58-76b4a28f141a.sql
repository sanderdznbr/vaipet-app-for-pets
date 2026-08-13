-- Migration 20260813193441_a33cf183-54a8-44a6-ad58-76b4a28f141a.sql
-- Estabilização Fase 3.1: Unificação de status (current_status)
-- REMOVIDAS redefinições de RPCs (movidas para migration corretiva 193923)

DO $$
DECLARE
    divergence_count integer := 0;
BEGIN
    -- 1. Contagem de divergências antes de qualquer atualização
    SELECT count(*) INTO divergence_count
    FROM public.walk_sessions
    WHERE status IS DISTINCT FROM current_status::text;
    
    RAISE NOTICE 'Divergências encontradas antes do backfill: %', divergence_count;

    -- 2. Backfill de current_status somente quando current_status IS NULL
    -- Conversão explícita dos valores legados conhecidos
    UPDATE public.walk_sessions
    SET current_status = CASE 
        WHEN status = 'active' THEN 'in_progress'::public.walk_status
        WHEN status = 'finished' THEN 'completed'::public.walk_status
        WHEN status = 'returning' THEN 'returning'::public.walk_status
        WHEN status = 'completed' THEN 'completed'::public.walk_status
        WHEN status = 'cancelled' THEN 'cancelled'::public.walk_status
        WHEN status = 'searching' THEN 'searching'::public.walk_status
        WHEN status = 'accepted' THEN 'accepted'::public.walk_status
        ELSE 'searching'::public.walk_status
    END
    WHERE current_status IS NULL;
END $$;

-- 3. Garantir constraints
ALTER TABLE public.walk_sessions
ALTER COLUMN current_status SET DEFAULT 'searching',
ALTER COLUMN current_status SET NOT NULL;

-- 4. Trigger que espelha current_status em status (Trigger de compatibilidade)
CREATE OR REPLACE FUNCTION public.sync_walk_session_status()
RETURNS TRIGGER AS $$
BEGIN
    -- current_status é a autoridade única
    NEW.status := NEW.current_status::text;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_walk_session_status ON public.walk_sessions;
CREATE TRIGGER trg_sync_walk_session_status
BEFORE INSERT OR UPDATE ON public.walk_sessions
FOR EACH ROW
EXECUTE FUNCTION public.sync_walk_session_status();
