import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { PetwalkerNavigation } from '@/components/petwalker/PetwalkerNavigation';
import { PetwalkerProtectedRoute } from '@/components/PetwalkerProtectedRoute';
import { Target } from 'lucide-react';
import { toast } from 'sonner';
import { Database } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';
import mapboxgl from 'mapbox-gl';

// Components
import { PetwalkerMap } from '@/components/petwalker/PetwalkerMap';
import { PetwalkerFloatingHeader } from '@/components/petwalker/PetwalkerFloatingHeader';
import { PetwalkerStatusSheet } from '@/components/petwalker/PetwalkerStatusSheet';
import { IncomingWalkOfferSheet } from '@/components/petwalker/IncomingWalkOfferSheet';
import { ActiveWalkSheet } from '@/components/petwalker/ActiveWalkSheet';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || 'pk.eyJ1Ijoic2FuZGVyY29sb21iZXMiLCJhIjoiY21kNDBuaHZ4MGF3bjJtb2dwNHdsMWR1aCJ9.D_kYvjRu2iigL2uziaEomQ';

type WalkSession = Database['public']['Tables']['walk_sessions']['Row'] & {
  customer?: { full_name: string | null };
  pet?: { name: string; avatar_url: string | null; breed: string | null };
};

type WalkOffer = Database['public']['Functions']['get_available_walk_offers']['Returns'][number];

const Painel = () => {
  const { user } = useAuth();
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const routeLayerId = 'walk-route';
  
  const [activeRequest, setActiveRequest] = useState<WalkSession | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [gpsStatus, setGpsStatus] = useState<'requesting' | 'synced' | 'unstable' | 'stale' | 'denied' | 'error'>('requesting');
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [showOfferSheet, setShowOfferSheet] = useState<WalkOffer | null>(null);
  const [offerAction, setOfferAction] = useState<'accepting' | 'declining' | null>(null);
  const [walkerCoords, setWalkerCoords] = useState<[number, number] | null>(null);
  const [walkerAccuracy, setWalkerAccuracy] = useState<number | null>(null);
  const [isFirstLock, setIsFirstLock] = useState(true);

  const watchId = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const UPDATE_INTERVAL = 10000; // 10s frequency control

  // --- Data Fetching ---

  const refreshActiveRequest = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('walk_sessions')
      .select('*, customer:profiles!customer_id(full_name), pet:pets!pet_id(name, avatar_url, breed)')
      .eq('walker_id', user.id)
      .in('current_status', ['accepted', 'heading_to_pickup', 'arrived', 'in_progress', 'returning'])
      .maybeSingle();

    if (error) {
      console.error('Error fetching active request:', error);
      return;
    }
    setActiveRequest(data as unknown as WalkSession);
  }, [user]);

  const refreshAvailableOffer = useCallback(async () => {
    // Priority check: user profile, online status, and NO active request
    if (!user || !isOnline || activeRequest) {
      setShowOfferSheet(null);
      return;
    }

    const { data, error } = await supabase.rpc('get_available_walk_offers');
    if (error) {
      console.error('Error fetching offers:', error);
      return;
    }
    setShowOfferSheet(data?.[0] ?? null);
  }, [user, isOnline, activeRequest]);

  // --- Map & GPS ---

  const drawRoute = useCallback(async (start: [number, number], end: [number, number]) => {
    if (!mapRef.current) return;

    try {
      const query = await fetch(
        `https://api.mapbox.com/directions/v5/mapbox/walking/${start[0]},${start[1]};${end[0]},${end[1]}?steps=true&geometries=geojson&access_token=${MAPBOX_TOKEN}`
      );
      const json = await query.json();
      const data = json.routes[0];
      const route = data.geometry.coordinates;
      
      const geojson: any = {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: route
        }
      };

      if (mapRef.current.getSource(routeLayerId)) {
        (mapRef.current.getSource(routeLayerId) as mapboxgl.GeoJSONSource).setData(geojson);
      } else {
        mapRef.current.addLayer({
          id: routeLayerId,
          type: 'line',
          source: {
            type: 'geojson',
            data: geojson
          },
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
          paint: {
            'line-color': '#31D880',
            'line-width': 5,
            'line-opacity': 0.75
          }
        });
      }

      // Fit bounds to show both points
      const bounds = new mapboxgl.LngLatBounds()
        .extend(start)
        .extend(end);
      mapRef.current.fitBounds(bounds, { padding: 80 });
    } catch (e) {
      console.error('Error drawing route:', e);
    }
  }, []);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsStatus('error');
      return;
    }
    
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    
    watchId.current = window.navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        const now = Date.now();
        
        // 1. Accuracy check
        const isUnstable = accuracy > 60;
        
        // 2. Update local state for Map component
        setWalkerCoords([lng, lat]);
        setWalkerAccuracy(accuracy);
        
        // 3. Auto-centering on first lock
        if (isFirstLock && mapRef.current) {
          mapRef.current.easeTo({ 
            center: [lng, lat], 
            zoom: 16.5, 
            pitch: 0,
            duration: 800,
            offset: [0, -70]
          });
          setIsFirstLock(false);
        }

        // 4. Stale check (if last sync was too long ago)
        if (lastSync && (now - lastSync.getTime() > 45000)) {
          setGpsStatus('stale');
        }

        // 5. Frequency and server sync
        const shouldUpdate = now - lastUpdateRef.current > UPDATE_INTERVAL;
        if (shouldUpdate) {
          const { error } = await supabase.rpc('update_walker_location', { 
            _lat: lat, 
            _lng: lng, 
            _accuracy: accuracy 
          });

          if (!error) {
            setGpsStatus(isUnstable ? 'unstable' : 'synced');
            setLastSync(new Date());
            lastUpdateRef.current = now;
          } else {
            console.error('RPC update_walker_location error:', error);
            setGpsStatus('error');
          }
        } else if (gpsStatus !== 'synced' && !isUnstable && gpsStatus !== 'stale') {
           // If we're not syncing yet but GPS is fine, keep at least showing we have a lock
           // but 'synced' only after RPC success as per requirements
        }
      },
      (err) => {
        setGpsStatus(err.code === 1 ? 'denied' : 'error');
        if (err.code === 1) toast.error('Permissão de GPS negada');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [isFirstLock, lastSync, gpsStatus]);

  const stopTracking = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    setGpsStatus('requesting');
    setWalkerCoords(null);
    setWalkerAccuracy(null);
    setIsFirstLock(true);
  }, []);

  // --- Effects ---

  useEffect(() => {
    if (!user) return;
    
    const init = async () => {
      // 1. Availability
      const { data: profile } = await supabase.from('petwalker_profiles').select('availability_status').eq('user_id', user.id).single();
      const online = profile?.availability_status === 'available';
      setIsOnline(online);
      
      // 2. Active Session
      await refreshActiveRequest();
      
      // 3. Start GPS if online
      if (online) startTracking();
      
      setLoading(false);
    };

    init();

    // Subscriptions
    const offersChannel = supabase
      .channel('petwalker-offers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'walk_offers' }, () => {
        refreshAvailableOffer();
      })
      .subscribe();

    const sessionsChannel = supabase
      .channel('petwalker-sessions')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'walk_sessions',
        filter: `walker_id=eq.${user.id}`
      }, (payload) => {
        refreshActiveRequest();
        // If session closed/cancelled, we might be available for offers again
        if (payload.eventType === 'DELETE' || (payload.new && ['completed', 'cancelled'].includes((payload.new as any).current_status))) {
          refreshAvailableOffer();
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(offersChannel);
      supabase.removeChannel(sessionsChannel);
      stopTracking();
    };
  }, [user, refreshActiveRequest, refreshAvailableOffer, startTracking, stopTracking]);

  // Handle offer search dependency
  useEffect(() => {
    if (isOnline && !activeRequest && !loading) {
      refreshAvailableOffer();
    }
  }, [isOnline, activeRequest, loading, refreshAvailableOffer]);

  // Route drawing logic
  useEffect(() => {
    if (activeRequest && ['accepted', 'heading_to_pickup', 'arrived'].includes(activeRequest.current_status) && walkerCoords) {
      const destLat = (activeRequest as any).meeting_point_geom?.coordinates?.[1];
      const destLng = (activeRequest as any).meeting_point_geom?.coordinates?.[0];
      
      if (destLat && destLng) {
        drawRoute(walkerCoords, [destLng, destLat]);
      }
    } else if (mapRef.current && mapRef.current.getLayer(routeLayerId)) {
      mapRef.current.removeLayer(routeLayerId);
      mapRef.current.removeSource(routeLayerId);
    }
  }, [activeRequest, drawRoute]);

  // --- Handlers ---

  const handleToggleOnline = async () => {
    const nextOnline = !isOnline;
    const { error } = await supabase.rpc('set_petwalker_availability', { _status: nextOnline ? 'available' : 'offline' });
    if (!error) {
      setIsOnline(nextOnline);
      if (nextOnline) {
        startTracking();
      } else {
        stopTracking();
        setShowOfferSheet(null);
      }
      toast.success(nextOnline ? 'Você está online' : 'Você está offline');
    }
  };

  const handleAcceptWalk = async () => {
    if (!showOfferSheet || offerAction) return;
    if (!showOfferSheet.session_id) {
      toast.error('ID da sessão inválido');
      return;
    }
    setOfferAction('accepting');
    try {
      const { data: success, error } = await supabase.rpc('accept_walk_request', { _session_id: showOfferSheet.session_id });
      if (error) throw error;
      
      if (success) {
        toast.success('Passeio confirmado!');
        await refreshActiveRequest();
        setShowOfferSheet(null);
      } else {
        toast.error('Esta solicitação já foi aceita ou expirou');
        refreshAvailableOffer();
      }
    } catch (e) {
      toast.error('Erro ao aceitar passeio');
    } finally {
      setOfferAction(null);
    }
  };

  const handleDeclineWalk = async () => {
    if (!showOfferSheet || offerAction) return;
    if (!showOfferSheet.session_id) {
      toast.error('ID da sessão inválido');
      return;
    }
    setOfferAction('declining');
    try {
      const { error } = await supabase.rpc('decline_walk_offer', { _session_id: showOfferSheet.session_id });
      if (error) throw error;
      
      setShowOfferSheet(null);
      refreshAvailableOffer();
    } catch (e) {
      toast.error('Erro ao recusar passeio');
    } finally {
      setOfferAction(null);
    }
  };

  const recenter = () => {
    if (walkerCoords && mapRef.current) {
      mapRef.current.easeTo({ 
        center: walkerCoords, 
        zoom: 16.5,
        offset: [0, -70]
      });
    }
  };

  if (loading) return null;

  return (
    <PetwalkerProtectedRoute>
      <div className="fixed inset-0 bg-white flex flex-col overflow-hidden">
        {/* Layer 1: Map */}
        <PetwalkerMap 
          mapboxToken={MAPBOX_TOKEN} 
          isOnline={isOnline} 
          onMapLoad={(map) => { mapRef.current = map; }} 
          walkerCoords={walkerCoords}
          walkerAccuracy={walkerAccuracy}
          meetingCoords={showOfferSheet ? [showOfferSheet.meeting_point_lng, showOfferSheet.meeting_point_lat] : 
                        (activeRequest && (activeRequest as any).meeting_point_geom?.coordinates) ? 
                        [(activeRequest as any).meeting_point_geom.coordinates[0], (activeRequest as any).meeting_point_geom.coordinates[1]] : null}
        />
        
        {/* Layer 2: Floating Header */}
        <PetwalkerFloatingHeader user={user} isOnline={isOnline} gpsStatus={gpsStatus} />

        {/* Layer 3: Recentering Button */}
        <button 
          onClick={recenter}
          disabled={!walkerCoords}
          className={cn(
            "absolute right-4 z-30 w-12 h-12 rounded-full bg-white shadow-xl flex items-center justify-center text-ink active:scale-90 transition-transform disabled:opacity-50",
            // Dynamic position based on sheets
            (showOfferSheet || activeRequest) 
              ? "bottom-[calc(400px+env(safe-area-inset-bottom,0px))]" 
              : "bottom-[calc(240px+env(safe-area-inset-bottom,0px))]"
          )}
        >
          <Target size={24} />
        </button>

        {/* Layer 4: Bottom Sheets */}
        <ActiveWalkSheet activeRequest={activeRequest} />
        
        {!activeRequest && (
          <IncomingWalkOfferSheet 
            offer={showOfferSheet} 
            onAccept={handleAcceptWalk} 
            onDecline={handleDeclineWalk} 
            actionLoading={offerAction}
          />
        )}

        {!activeRequest && !showOfferSheet && (
          <PetwalkerStatusSheet 
            isOnline={isOnline} 
            onToggleOnline={handleToggleOnline} 
            gpsStatus={gpsStatus} 
            lastSync={lastSync}
            onRetryGps={startTracking}
          />
        )}

        {/* Layer 5: Bottom Navigation */}
        {!activeRequest && !showOfferSheet && <PetwalkerNavigation />}

      </div>
    </PetwalkerProtectedRoute>
  );
};

export default Painel;