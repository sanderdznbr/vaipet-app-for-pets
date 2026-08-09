import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { PetwalkerNavigation } from '@/components/petwalker/PetwalkerNavigation';
import { PetwalkerProtectedRoute } from '@/components/PetwalkerProtectedRoute';
import { Button } from '@/components/ui/button';
import { User, Bell, Target, Locate, LocateOff, MapPin, Navigation, Clock, ShieldCheck, Info } from 'lucide-react';
import { toast } from 'sonner';
import { NotificationSheet } from '@/components/NotificationSheet';
import { useNavigate } from 'react-router-dom';
import { Database } from '@/integrations/supabase/types';
import { BottomSheet } from '@/components/petwalker/BottomSheet';
import { cn } from '@/lib/utils';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { hideMapLabels, enrichMap, tintMapInk } from '@/lib/mapStyle';

const MAPBOX_TOKEN = 'pk.eyJ1Ijoic2FuZGVyY29sb21iZXMiLCJhIjoiY21kNDBuaHZ4MGF3bjJtb2dwNHdsMWR1aCJ9.D_kYvjRu2iigL2uziaEomQ';

type WalkSession = Database['public']['Tables']['walk_sessions']['Row'] & {
  customer?: { full_name: string | null };
  pet?: { name: string; avatar_url: string | null; breed: string | null };
};

type WalkOffer = Database['public']['Functions']['get_available_walk_offers']['Returns'][number];

const PetwalkerPainel = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const lastLocationRef = useRef<[number, number] | null>(null);
  
  const [activeRequest, setActiveRequest] = useState<WalkSession | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [gpsStatus, setGpsStatus] = useState<'loading' | 'active' | 'denied' | 'error' | 'unstable'>('loading');
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [showOfferSheet, setShowOfferSheet] = useState<WalkOffer | null>(null);

  const watchId = useRef<number | null>(null);

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
        
        // Logic for unstable GPS based on accuracy
        if (accuracy > 50) {
          setGpsStatus('unstable');
        } else {
          setGpsStatus('active');
        }
        
        setLastSync(new Date());
        lastLocationRef.current = [lng, lat];

        // Update Map Marker
        if (map.current) {
          if (!markerRef.current) {
            const el = document.createElement('div');
            el.className = 'marker-walker-pulse';
            markerRef.current = new mapboxgl.Marker(el).setLngLat([lng, lat]).addTo(map.current);
          } else {
            markerRef.current.setLngLat([lng, lat]);
          }
          // Only auto-center if not currently on an offer or active walk to avoid hijacking view
          if (!showOfferSheet && !activeRequest) {
            map.current.easeTo({ center: [lng, lat], duration: 1000 });
          }
        }

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
    lastLocationRef.current = null;
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
        .select('*, customer:profiles!customer_id(full_name), pet:pets!pet_id(name, avatar_url, breed)')
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
    // Availability update via RPC
    const { error } = await supabase.rpc('set_petwalker_availability', { _status: nextOnline ? 'available' : 'offline' });
    if (!error) {
      setIsOnline(nextOnline);
      if (nextOnline) {
        startTracking();
      } else {
        stopTracking();
      }
      toast.success(nextOnline ? 'Online' : 'Offline');
    }
  };

  const recenter = () => {
    if (lastLocationRef.current && map.current) {
      map.current.easeTo({ center: lastLocationRef.current, zoom: 16 });
    }
  };

  return (
    <PetwalkerProtectedRoute>
      <div className="fixed inset-0 bg-white flex flex-col overflow-hidden">
        {/* Layer 1: Map */}
        <div ref={mapContainer} className={cn("absolute inset-0 z-0", !isOnline && "opacity-[0.88]")} />
        
        {/* Layer 2: Floating Header */}
        <header className="absolute top-0 left-0 right-0 px-4 pt-safe-plus flex items-center justify-between z-40 pointer-events-none">
          {/* Left: Profile Button */}
          <button 
            onClick={() => navigate('/petwalker/perfil')}
            className="w-11 h-11 rounded-full overflow-hidden border border-border bg-white shadow-sm pointer-events-auto active:scale-95 transition-transform"
          >
            {user?.user_metadata?.avatar_url ? (
              <img src={user.user_metadata.avatar_url} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gray-50"><User className="text-gray-400" size={20} /></div>
            )}
          </button>

          {/* Center: Status Capsule */}
          <div className="pointer-events-auto">
            <div className={cn(
              "px-4 py-2 rounded-full shadow-md border flex items-center gap-2 bg-white",
              isOnline ? "border-green-100" : "border-gray-100"
            )}>
              <div className={cn(
                "w-2 h-2 rounded-full",
                !isOnline ? "bg-gray-400" : 
                gpsStatus === 'active' ? "bg-[#31D880] animate-pulse" :
                gpsStatus === 'unstable' ? "bg-orange-400" : "bg-red-500"
              )} />
              <span className={cn(
                "text-[13px] font-bold tracking-tight",
                !isOnline ? "text-gray-500" : "text-ink"
              )}>
                {!isOnline ? 'Offline' : 
                 gpsStatus === 'active' ? 'Online' : 
                 gpsStatus === 'unstable' ? 'GPS instável' : 'Sem localização'}
              </span>
            </div>
          </div>

          {/* Right: Notifications */}
          <div className="pointer-events-auto">
            <NotificationSheet />
          </div>
        </header>

        {/* Layer 3: Recentering Button */}
        <button 
          onClick={recenter}
          disabled={!lastLocationRef.current}
          className={cn(
            "absolute right-4 bottom-[calc(240px+env(safe-area-inset-bottom,0px))] z-30 w-12 h-12 rounded-full bg-white shadow-xl flex items-center justify-center text-ink active:scale-90 transition-transform disabled:opacity-50 disabled:active:scale-100",
            (showOfferSheet || activeRequest) && "bottom-[calc(440px+env(safe-area-inset-bottom,0px))]"
          )}
        >
          <Target size={24} />
        </button>

        {/* Layer 4: Lower Panel (Bottom Sheet) */}
        
        {/* State 1 & 2: Offline / Waiting */}
        {!activeRequest && !showOfferSheet && gpsStatus !== 'denied' && gpsStatus !== 'error' && (
          <BottomSheet isOpen={true}>
            {!isOnline ? (
              <div className="space-y-6">
                <div className="text-center space-y-1">
                  <h3 className="text-xl font-bold font-space text-ink">Você está offline</h3>
                  <p className="text-sm text-muted-foreground">Fique online para receber solicitações de passeio próximas</p>
                </div>
                <Button 
                  onClick={handleToggleOnline} 
                  className="w-full bg-[#31D880] text-ink hover:bg-[#2bc473] h-[54px] rounded-2xl font-black text-lg shadow-lg"
                >
                  Ficar Online
                </Button>
                <button 
                  onClick={() => navigate('/petwalker/historico')}
                  className="w-full text-sm font-bold text-muted-foreground hover:text-ink transition-colors pb-2"
                >
                  Ver histórico
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[#31D880] animate-pulse" />
                    <h3 className="text-lg font-bold font-space text-ink">Você está online</h3>
                  </div>
                  <button onClick={handleToggleOnline} className="text-sm font-bold text-red-500 px-2 py-1">Ficar offline</button>
                </div>
                
                <div className="space-y-4">
                  <div className="flex items-center gap-3 bg-gray-50 p-3 rounded-2xl border border-gray-100">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-100 text-[#31D880]">
                      <Navigation size={18} className="animate-pulse" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-ink">Procurando solicitações...</p>
                      <p className="text-[11px] text-muted-foreground font-medium">As solicitações aparecerão aqui automaticamente</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground font-medium px-1">
                    <div className="flex items-center gap-1.5">
                      <Locate size={12} className="text-[#31D880]" />
                      <span>Localização ativa</span>
                    </div>
                    <span>{lastSync ? `Sincronizado ${lastSync.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}` : 'Sincronizando...'}</span>
                  </div>
                </div>
              </div>
            )}
          </BottomSheet>
        )}

        {/* State 3: GPS Failure */}
        {!activeRequest && !showOfferSheet && (gpsStatus === 'denied' || gpsStatus === 'error') && (
          <BottomSheet isOpen={true}>
            <div className="space-y-6 py-2">
              <div className="flex items-center gap-4 bg-red-50 p-4 rounded-2xl border border-red-100">
                <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center text-red-500 shadow-sm">
                  <LocateOff size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-bold font-space text-red-900">Ative sua localização</h3>
                  <p className="text-sm text-red-700 leading-tight">Precisamos do seu GPS para você receber solicitações de passeio.</p>
                </div>
              </div>
              
              <div className="space-y-3">
                <Button 
                  onClick={startTracking}
                  className="w-full bg-ink text-white hover:bg-ink/90 h-[54px] rounded-2xl font-bold"
                >
                  Tentar novamente
                </Button>
                <button className="w-full text-sm font-bold text-muted-foreground py-2">Como permitir a localização</button>
              </div>
            </div>
          </BottomSheet>
        )}

        {/* State 4: New Solicitation (Offer) */}
        {showOfferSheet && (
          <BottomSheet 
            isOpen={true} 
            isHighPriority={true} 
            className="h-[65vh]" 
            onClose={() => setShowOfferSheet(null)}
          >
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="flex justify-between items-start mb-6">
                <div className="space-y-1">
                  <div className="inline-flex items-center px-2.5 py-1 rounded-full bg-green-100 text-[#31D880] text-[10px] font-black uppercase tracking-wider border border-green-200">
                    Nova solicitação
                  </div>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">Agora</p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-black text-ink leading-none tracking-tighter">R$ {((showOfferSheet.total_price_cents || 0)/100).toFixed(2)}</p>
                  <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Valor do passeio</p>
                </div>
              </div>

              {/* Main Info */}
              <div className="space-y-6 flex-1 overflow-y-auto pr-2 pb-4">
                <div className="space-y-1">
                  <h4 className="text-3xl font-black font-space text-ink tracking-tight leading-none">{showOfferSheet.pet_name}</h4>
                  <p className="text-muted-foreground font-bold">{showOfferSheet.pet_breed || 'Raça não informada'}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                     <Clock className="text-[#31D880] mb-2" size={20} />
                     <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Duração</p>
                     <p className="text-lg font-black text-ink">{showOfferSheet.planned_duration_minutes} min</p>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                     <Target className="text-[#31D880] mb-2" size={20} />
                     <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Distância</p>
                     <p className="text-lg font-black text-ink">{Math.round(showOfferSheet.distance_to_walker_meters || 0)}m</p>
                  </div>
                </div>

                <div className="space-y-4 pt-2">
                   <div className="flex gap-4">
                     <div className="flex flex-col items-center">
                       <div className="w-3 h-3 rounded-full border-2 border-[#31D880] bg-white z-10" />
                       <div className="w-0.5 h-10 bg-gray-100 my-1" />
                       <div className="w-3 h-3 rounded-full bg-ink z-10" />
                     </div>
                     <div className="flex flex-col justify-between py-0.5 text-sm font-bold">
                        <div className="space-y-0.5">
                          <p className="text-ink">Encontro com o pet</p>
                          <p className="text-[11px] text-muted-foreground">{showOfferSheet.distance_to_walker_meters ? `${Math.round(showOfferSheet.distance_to_walker_meters)}m de você` : 'Próximo a você'}</p>
                        </div>
                        <p className="text-muted-foreground">Passeio de {showOfferSheet.planned_duration_minutes} min</p>
                     </div>
                   </div>
                </div>
              </div>

              {/* Actions */}
              <div className="pt-4 space-y-3 bg-white">
                <Button 
                  onClick={async () => {
                    // Accept Walk RPC
                    const { data: success, error } = await supabase.rpc('accept_walk_request', { _session_id: showOfferSheet.id });
                    if (error) {
                      toast.error('Erro ao aceitar passeio');
                      return;
                    }
                    if (success) {
                      toast.success('Passeio confirmado!');
                      setShowOfferSheet(null);
                    } else {
                      toast.error('Esta solicitação já foi aceita ou expirou');
                      setShowOfferSheet(null);
                    }
                  }}
                  className="w-full bg-[#31D880] text-ink hover:bg-[#2bc473] h-14 rounded-2xl font-black text-xl shadow-xl active:scale-95 transition-all"
                >
                  ACEITAR PASSEIO
                </Button>
                <button 
                  onClick={() => setShowOfferSheet(null)}
                  className="w-full text-sm font-bold text-muted-foreground py-2 hover:text-ink transition-colors"
                >
                  Recusar
                </button>
              </div>
            </div>
          </BottomSheet>
        )}

        {/* State 5-8: Active Request (Accepted/Operational) */}
        {activeRequest && (
          <BottomSheet isOpen={true} className={cn(activeRequest.current_status === 'in_progress' ? "bg-ink text-white" : "bg-white")}>
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#31D880] animate-pulse" />
                  <h3 className={cn("text-lg font-bold font-space uppercase tracking-tight", activeRequest.current_status === 'in_progress' ? "text-white" : "text-ink")}>
                    {activeRequest.current_status === 'accepted' && 'Passeio confirmado'}
                    {activeRequest.current_status === 'heading_to_pickup' && 'A caminho do pet'}
                    {activeRequest.current_status === 'arrived' && 'Você chegou'}
                    {activeRequest.current_status === 'in_progress' && 'Passeio em andamento'}
                  </h3>
                </div>
                <div className={cn("px-3 py-1 rounded-full text-[10px] font-black uppercase", activeRequest.current_status === 'in_progress' ? "bg-white/10 text-white" : "bg-gray-100 text-muted-foreground")}>
                   {activeRequest.planned_duration_minutes} min
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-[22px] overflow-hidden bg-gray-100 border-2 border-white shadow-sm">
                   {activeRequest.pet?.avatar_url ? (
                     <img src={activeRequest.pet.avatar_url} alt="Pet" className="w-full h-full object-cover" />
                   ) : (
                     <div className="w-full h-full flex items-center justify-center text-gray-400 text-2xl">🐾</div>
                   )}
                </div>
                <div>
                   <h4 className={cn("text-2xl font-black font-space leading-none", activeRequest.current_status === 'in_progress' ? "text-white" : "text-ink")}>
                     {activeRequest.pet?.name || 'Pet'}
                   </h4>
                   <p className={cn("text-sm font-bold mt-1", activeRequest.current_status === 'in_progress' ? "text-white/60" : "text-muted-foreground")}>
                     {activeRequest.customer?.full_name}
                   </p>
                </div>
              </div>

              {activeRequest.current_status !== 'in_progress' && (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin size={16} className="text-[#31D880] mt-0.5 shrink-0" />
                    <p className="font-bold text-ink leading-tight">{activeRequest.meeting_point_address || 'Endereço do encontro'}</p>
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground px-1">
                     <div className="flex items-center gap-1">
                       <Navigation size={12} />
                       <span>{activeRequest.distance_km ? `${Number(activeRequest.distance_km).toFixed(1)} km` : 'Calculando rota...'}</span>
                     </div>
                     <span className="font-black text-ink tracking-tight">R$ {((activeRequest.total_price_cents || 0)/100).toFixed(2)}</span>
                  </div>
                </div>
              )}

              <Button 
                onClick={() => navigate(`/petwalker/passeio/${activeRequest.id}`)}
                className={cn(
                  "w-full h-14 rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-all",
                  activeRequest.current_status === 'in_progress' ? "bg-[#31D880] text-ink hover:bg-[#2bc473]" : "bg-ink text-white hover:bg-ink/90"
                )}
              >
                {activeRequest.current_status === 'accepted' && 'Iniciar deslocamento'}
                {activeRequest.current_status === 'heading_to_pickup' && 'Cheguei ao local'}
                {activeRequest.current_status === 'arrived' && 'Iniciar passeio'}
                {activeRequest.current_status === 'in_progress' && 'Gerenciar Passeio'}
              </Button>
            </div>
          </BottomSheet>
        )}

        {/* Layer 5: Bottom Navigation (Conditional) */}
        {!activeRequest && !showOfferSheet && (
          <PetwalkerNavigation />
        )}

        {/* Map Styles */}
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

export default PetwalkerPainel;
