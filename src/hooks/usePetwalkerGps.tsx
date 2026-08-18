import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

export type GpsStatus = 'requesting' | 'synced' | 'unstable' | 'stale' | 'denied' | 'error';

/**
 * usePetwalkerGps
 * Shared GPS infrastructure for Petwalkers.
 * Walker is the SOLE authority for producing GPS tracking.
 */
export const usePetwalkerGps = (isPetwalker: boolean) => {
  const { user } = useAuth();
  const [coords, setCoords] = useState<[number, number] | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [status, setStatus] = useState<GpsStatus>('requesting');
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [isOnline, setIsOnline] = useState(false);

  const watchId = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const UPDATE_INTERVAL = 10000; // 10s throttle per Phase 4.2 specs

  // Fetch online status from petwalker_profiles
  useEffect(() => {
    if (!user || !isPetwalker) {
      setIsOnline(false);
      return;
    }

    const checkOnline = async () => {
      const { data } = await supabase
        .from('petwalker_profiles')
        .select('availability_status')
        .eq('user_id', user.id)
        .maybeSingle();
      
      setIsOnline(data?.availability_status === 'available');
    };

    checkOnline();

    // Subscribe to status changes to enable/disable GPS reactively
    const channel = supabase
      .channel('gps-online-status')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'petwalker_profiles',
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
        setIsOnline((payload.new as any).availability_status === 'available');
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isPetwalker]);

  const syncLocation = useCallback(async (lat: number, lng: number, acc: number) => {
    if (!user) return;
    const now = Date.now();
    
    // Accuracy check (> 60m is considered unstable for high-trust tracking)
    const isUnstable = acc > 60;
    
    // Frequency control: don't hammer the database
    if (now - lastUpdateRef.current < UPDATE_INTERVAL) return;

    try {
      // Hardened RPC: handles profile update, tracking log, and auto-trail append
      const { error } = await supabase.rpc('update_walker_location', {
        _lat: lat,
        _lng: lng,
        _accuracy: acc,
        _captured_at: now
      });

      if (!error) {
        setStatus(isUnstable ? 'unstable' : 'synced');
        setLastSync(new Date());
        lastUpdateRef.current = now;
      } else {
        console.error('GPS Sync failed:', error);
        setStatus('error');
      }
    } catch (e) {
      console.error('GPS Sync exception:', e);
      setStatus('error');
    }
  }, [user]);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setStatus('error');
      return;
    }

    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy: acc } = pos.coords;
        setCoords([longitude, latitude]);
        setAccuracy(acc);
        syncLocation(latitude, longitude, acc);
      },
      (err) => {
        setStatus(err.code === 1 ? 'denied' : 'error');
        if (err.code === 1) toast.error('Permissão de GPS necessária para trabalhar');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [syncLocation]);

  const stopTracking = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    setStatus('requesting');
    setCoords(null);
    setAccuracy(null);
  }, []);

  useEffect(() => {
    if (isOnline && user) {
      startTracking();
    } else {
      stopTracking();
    }
    return () => stopTracking();
  }, [isOnline, user, startTracking, stopTracking]);

  // Stale check: if last sync was > 45s ago, mark as stale
  useEffect(() => {
    if (!isOnline) return;
    const interval = setInterval(() => {
      if (lastSync && (Date.now() - lastSync.getTime() > 45000)) {
        setStatus('stale');
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [isOnline, lastSync]);

  return {
    coords,
    accuracy,
    status,
    lastSync,
    retry: startTracking
  };
};
