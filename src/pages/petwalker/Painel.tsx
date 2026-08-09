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
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const routeLayerId = 'walk-route';
  
  const [activeRequest, setActiveRequest] = useState<WalkSession | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [gpsStatus, setGpsStatus] = useState<'loading' | 'active' | 'denied' | 'error' | 'unstable'>('loading');
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [showOfferSheet, setShowOfferSheet] = useState<WalkOffer | null>(null);
  const [offerAction, setOfferAction] = useState<'accepting' | 'declining' | null>(null);

  const watchId = useRef<number | null>(null);
  const lastLocationRef = useRef<[number, number] | null>(null);
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
        
        // Update local marker immediately for UX
        if (mapRef.current) {
          if (!markerRef.current) {
            const el = document.createElement('div');
            el.className = 'marker-walker-pulse';
            markerRef.current = new mapboxgl.Marker(el).setLngLat([lng, lat]).addTo(mapRef.current);
            // First fix: center map on walker
            mapRef.current.easeTo({ center: [lng, lat], zoom: 15, duration: 1000 });
          } else {
            markerRef.current.setLngLat([lng, lat]);
          }
        }
        
        lastLocationRef.current = [lng, lat];

        // Frequency and accuracy validation
        const shouldUpdate = now - lastUpdateRef.current > UPDATE_INTERVAL;
        if (shouldUpdate) {
          const { error } = await supabase.rpc('update_walker_location', { 
            _lat: lat, 
            _lng: lng, 
            _accuracy: accuracy 
          });

          if (!error) {
            setGpsStatus(accuracy > 50 ? 'unstable' : 'active');
            setLastSync(new Date());
            lastUpdateRef.current = now;
          } else {
            setGpsStatus('error');
          }
        }
      },
      (err) => {
        setGpsStatus(err.code === 1 ? 'denied' : 'error');
        if (err.code === 1) toast.error('Permissão de GPS negada');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, []);

  const stopTracking = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
    setGpsStatus('loading');
    lastLocationRef.current = null;
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
    if (activeRequest && ['accepted', 'heading_to_pickup', 'arrived'].includes(activeRequest.current_status) && lastLocationRef.current) {
      const destLat = (activeRequest as any).meeting_point_geom?.coordinates?.[1];
      const destLng = (activeRequest as any).meeting_point_geom?.coordinates?.[0];
      
      if (destLat && destLng) {
        drawRoute(lastLocationRef.current, [destLng, destLat]);
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
    if (!showOfferSheet) return;
    setOfferAction('accepting');
    try {
      const { data: success, error } = await supabase.rpc('accept_walk_request', { _session_id: showOfferSheet.id });
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
    if (!showOfferSheet) return;
    setOfferAction('declining');
    try {
      const { error } = await supabase.rpc('decline_walk_offer', { _session_id: showOfferSheet.id });
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
    if (lastLocationRef.current && mapRef.current) {
      mapRef.current.easeTo({ center: lastLocationRef.current, zoom: 16 });
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
        />
        
        {/* Layer 2: Floating Header */}
        <PetwalkerFloatingHeader user={user} isOnline={isOnline} gpsStatus={gpsStatus} />

        {/* Layer 3: Recentering Button */}
        <button 
          onClick={recenter}
          disabled={!lastLocationRef.current}
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

        {/* Map Pulse Style */}
        <style dangerouslySetInnerHTML={{ __html: `
          .marker-walker-pulse {
            width: 32px;
            height: 32px;
            background: rgba(49, 216, 128, 0.2);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: markerPulse 2s infinite ease-out;
          }
          .marker-walker-pulse::after {
            content: '';
            width: 14px;
            height: 14px;
            background: #31D880;
            border: 3px solid white;
            border-radius: 50%;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10;
          }
          @keyframes markerPulse {
            0% { transform: scale(0.9); opacity: 0.8; }
            50% { transform: scale(1.4); opacity: 0.3; }
            100% { transform: scale(0.9); opacity: 0.8; }
          }
        `}} />
      </div>
    </PetwalkerProtectedRoute>
  );
};

export default Painel;