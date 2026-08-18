import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

export type GpsStatus = 'requesting' | 'synced' | 'unstable' | 'stale' | 'denied' | 'error';

export const usePetwalkerGps = (isOnline: boolean) => {
  const { user } = useAuth();
  const [coords, setCoords] = useState<[number, number] | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [status, setStatus] = useState<GpsStatus>('requesting');
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const watchId = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const UPDATE_INTERVAL = 10000; // 10s

  const syncLocation = useCallback(async (lat: number, lng: number, acc: number) => {
    if (!user) return;
    const now = Date.now();
    
    // Accuracy check (> 60m is unstable)
    const isUnstable = acc > 60;
    
    // Frequency control
    if (now - lastUpdateRef.current < UPDATE_INTERVAL) return;

    try {
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
        console.error('RPC update_walker_location error:', error);
        setStatus('error');
      }
    } catch (e) {
      console.error('Sync error:', e);
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
        if (err.code === 1) toast.error('Permissão de GPS negada');
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

  // Stale check
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
