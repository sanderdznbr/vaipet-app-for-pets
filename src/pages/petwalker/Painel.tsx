import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { PetwalkerNavigation } from '@/components/petwalker/PetwalkerNavigation';
import { PetwalkerProtectedRoute } from '@/components/PetwalkerProtectedRoute';
import { Button } from '@/components/ui/button';
import { User, MapPin, Navigation, Dog, Bell, Target, GpsFixed, GpsOff } from 'lucide-react';
import { toast } from 'sonner';
import { NotificationSheet } from '@/components/NotificationSheet';
import { useNavigate } from 'react-router-dom';
import { Database } from '@/integrations/supabase/types';
import { BottomSheet } from '@/components/petwalker/BottomSheet';
import { PetwalkerMapMarker } from '@/components/petwalker/PetwalkerMapMarker';
import { cn } from '@/lib/utils';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { hideMapLabels, enrichMap, tintMapInk } from '@/lib/mapStyle';

const MAPBOX_TOKEN = 'pk.eyJ1Ijoic2FuZGVyY29sb21iZXMiLCJhIjoiY21kNDBuaHZ4MGF3bjJtb2dwNHdsMWR1aCJ9.D_kYvjRu2iigL2uziaEomQ';

type WalkSession = Database['public']['Tables']['walk_sessions']['Row'] & {
  customer?: { full_name: string | null };
  pet?: { name: string; breed: string | null };
};

type WalkOffer = Database['public']['Functions']['get_available_walk_offers']['Returns'][number];

const PetwalkerPainel = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  
  const [activeRequest, setActiveRequest] = useState<WalkSession | null>(null);
  const [openOffers, setOpenOffers] = useState<WalkOffer[]>([]);
  const [isOnline, setIsOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [gpsStatus, setGpsStatus] = useState<'loading' | 'active' | 'denied' | 'error'>('loading');
  const [lastSync, setLastSync] = useState<Date | null>(null);
  
  const watchId = useRef<number | null>(null);
  const [showOfferSheet, setShowOfferSheet] = useState<WalkOffer | null>(null);

  // Initialize Map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/standard",
      center: [-46.6333, -23.5505], // SP Default
      zoom: 15,
      pitch: 45,
      attributionControl: false,
    });

    map.current.on('load', () => {
      if (!map.current) return;
      hideMapLabels(map.current);
      enrichMap(map.current, true);
      tintMapInk(map.current, false);
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  const startTracking = () => {
    if (!navigator.geolocation) {
      setGpsStatus('error');
      return;
    }
    
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    
    watchId.current = window.navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        setGpsStatus('active');
        setLastSync(new Date());

        // Update Map Marker
        if (map.current) {
          if (!markerRef.current) {
            const el = document.createElement('div');
            el.className = 'marker-walker';
            markerRef.current = new mapboxgl.Marker(el).setLngLat([lng, lat]).addTo(map.current);
          } else {
            markerRef.current.setLngLat([lng, lat]);
          }
          map.current.easeTo({ center: [lng, lat], duration: 1000 });
        }

        // RPC update logic...
        await supabase.rpc('update_walker_location', { _lat: lat, _lng: lng, _accuracy: accuracy });
      },
      (err) => {
        setGpsStatus(err.code === 1 ? 'denied' : 'error');
        if (err.code === 1) toast.error('Permissão de GPS negada');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const stopTracking = () => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
    setGpsStatus('loading');
  };

  useEffect(() => {
    if (!user) return;
    
    const init = async () => {
      const { data: profile } = await supabase.from('petwalker_profiles').select('availability_status').eq('user_id', user.id).single();
      const online = profile?.availability_status === 'available';
      setIsOnline(online);
      if (online) startTracking();

      const { data: request } = await supabase
        .from('walk_sessions')
        .select('*, customer:profiles!customer_id(full_name), pet:pets!pet_id(name, avatar_url)')
        .eq('walker_id', user.id)
        .in('current_status', ['accepted', 'heading_to_pickup', 'arrived', 'in_progress', 'returning'])
        .maybeSingle();
      
      setActiveRequest(request as unknown as WalkSession);
      setLoading(false);
    };

    init();

    const channel = supabase
      .channel('petwalker-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'walk_offers' }, (payload) => {
          setShowOfferSheet(payload.new as WalkOffer);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      stopTracking();
    };
  }, [user]);

  const handleToggleOnline = async () => {
    const nextOnline = !isOnline;
    const { error } = await supabase.rpc('set_petwalker_availability', { _status: nextOnline ? 'available' : 'offline' });
    if (!error) {
      setIsOnline(nextOnline);
      if (nextOnline) startTracking(); else stopTracking();
      toast.success(nextOnline ? 'Online' : 'Offline');
    }
  };

  return (
    <PetwalkerProtectedRoute>
      <div className="fixed inset-0 bg-[#F7F5EF] flex flex-col overflow-hidden">
        {/* Fullscreen Map */}
        <div ref={mapContainer} className="absolute inset-0 z-0" />
        
        {/* Floating Header */}
        <header className="absolute top-0 left-0 right-0 p-4 pt-12 flex items-center justify-between z-40 pointer-events-none">
          <div className="flex items-center gap-3 pointer-events-auto">
            <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-white shadow-xl bg-white">
               {user?.user_metadata?.avatar_url ? (
                 <img src={user.user_metadata.avatar_url} className="w-full h-full object-cover" />
               ) : (
                 <div className="w-full h-full flex items-center justify-center bg-gray-100"><User className="text-gray-400" /></div>
               )}
            </div>
            <div className="bg-white/90 backdrop-blur px-4 py-2 rounded-full shadow-lg flex items-center gap-2 border border-white/20">
               <div className={cn("w-2 h-2 rounded-full", isOnline ? "bg-[#31D880] animate-pulse" : "bg-gray-400")} />
               <span className="text-sm font-bold font-space">{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
            </div>
          </div>
          <div className="pointer-events-auto">
            <NotificationSheet />
          </div>
        </header>

        {/* Floating Map Controls */}
        <div className="absolute right-4 bottom-40 z-30 flex flex-col gap-2">
          <button 
            onClick={() => {
              if (lastLocationRef.current && map.current) {
                map.current.easeTo({ center: lastLocationRef.current, zoom: 16 });
              }
            }}
            className="w-12 h-12 rounded-full bg-white shadow-xl flex items-center justify-center text-ink active:scale-90 transition-transform"
          >
            <Target size={24} />
          </button>
        </div>

        {/* Operational Bottom Sheets */}
        {!activeRequest && (
          <BottomSheet isOpen={!showOfferSheet}>
            {!isOnline ? (
              <div className="py-2">
                <h3 className="text-2xl font-bold font-space mb-2">Você está offline</h3>
                <p className="text-muted-foreground mb-6">Fique online para receber solicitações próximas e começar a ganhar.</p>
                <Button 
                  onClick={handleToggleOnline} 
                  className="w-full bg-[#31D880] text-ink hover:bg-[#2bc473] h-16 rounded-[22px] font-extrabold text-lg shadow-lg shadow-green-200"
                >
                  Ficar Online
                </Button>
              </div>
            ) : (
              <div className="py-2">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center">
                    <Navigation className="text-[#31D880] animate-bounce" size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold font-space">Procurando solicitações</h3>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                      {gpsStatus === 'active' ? <GpsFixed size={12} className="text-[#31D880]" /> : <GpsOff size={12} className="text-red-500" />}
                      <span>GPS {gpsStatus === 'active' ? 'Ativo' : 'Indisponível'} • {lastSync ? lastSync.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '--:--'}</span>
                    </div>
                  </div>
                </div>
                <Button 
                  onClick={handleToggleOnline} 
                  variant="ghost" 
                  className="w-full text-red-500 font-bold h-12"
                >
                  Ficar Offline
                </Button>
              </div>
            )}
          </BottomSheet>
        )}

        {/* Active Walk Summary */}
        {activeRequest && (
          <BottomSheet isOpen={true} title="Passeio em andamento" className="bg-ink text-white">
            <div className="flex items-center justify-between mb-4">
               <div className="flex items-center gap-3">
                 <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center text-2xl">🐾</div>
                 <div>
                   <h4 className="font-bold text-xl">{activeRequest.pet?.name}</h4>
                   <p className="text-white/60 text-sm">{activeRequest.customer?.full_name}</p>
                 </div>
               </div>
               <div className="text-right">
                  <span className="text-xs font-bold bg-[#31D880] text-ink px-3 py-1 rounded-full uppercase">
                    {activeRequest.current_status}
                  </span>
               </div>
            </div>
            <Button 
              onClick={() => navigate(`/petwalker/passeio/${activeRequest.id}`)}
              className="w-full bg-[#31D880] text-ink hover:bg-[#2bc473] h-14 rounded-2xl font-bold"
            >
              Ver Detalhes do Passeio
            </Button>
          </BottomSheet>
        )}

        {/* New Offer Modal (High Priority) */}
        {showOfferSheet && (
          <BottomSheet 
            isOpen={true} 
            isHighPriority={true} 
            title="Nova solicitação"
            onClose={() => setShowOfferSheet(null)}
          >
            <div className="space-y-6">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="text-3xl font-black font-space">{showOfferSheet.pet_name}</h4>
                  <p className="text-muted-foreground font-medium">{showOfferSheet.planned_duration_minutes} min • {Math.round(showOfferSheet.distance_to_walker_meters || 0)}m de distância</p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-black text-[#31D880]">R$ {((showOfferSheet.total_price_cents || 0)/100).toFixed(2)}</p>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Valor do passeio</p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                 <Button 
                    onClick={async () => {
                      const { data: success } = await supabase.rpc('accept_walk_request', { _session_id: showOfferSheet.id });
                      if (success) {
                        toast.success('Passeio aceito!');
                        setShowOfferSheet(null);
                      } else {
                        toast.error('Oferta indisponível');
                        setShowOfferSheet(null);
                      }
                    }}
                    className="col-span-2 h-16 bg-ink text-white rounded-[22px] font-black text-xl shadow-xl active:scale-95 transition-all"
                  >
                   ACEITAR PASSEIO
                 </Button>
                 <Button 
                  variant="ghost" 
                  onClick={() => setShowOfferSheet(null)}
                  className="col-span-2 text-muted-foreground font-bold"
                 >
                   Recusar
                 </Button>
              </div>
            </div>
          </BottomSheet>
        )}

        <PetwalkerNavigation />
        
        {/* Style injection for marker */}
        <style dangerouslySetInnerHTML={{ __html: `
          .marker-walker {
            width: 48px;
            height: 48px;
            background: rgba(49, 216, 128, 0.2);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .marker-walker::after {
            content: '';
            width: 14px;
            height: 14px;
            background: #31D880;
            border: 3px solid white;
            border-radius: 50%;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          }
        `}} />
      </div>
    </PetwalkerProtectedRoute>
  );
};

export default PetwalkerPainel;
