import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { PetwalkerNavigation } from '@/components/petwalker/PetwalkerNavigation';
import { PetwalkerProtectedRoute } from '@/components/PetwalkerProtectedRoute';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Bell, ShieldCheck, Dog, User, MapPin, Navigation } from 'lucide-react';
import { toast } from 'sonner';
import { NotificationSheet } from '@/components/NotificationSheet';
import { useNavigate } from 'react-router-dom';
import { Database } from '@/integrations/supabase/types';

type WalkSession = Database['public']['Tables']['walk_sessions']['Row'] & {
  customer?: { full_name: string | null };
  pet?: { name: string; breed: string | null };
};

type WalkOffer = Database['public']['Functions']['get_available_walk_offers']['Returns'][number];

const distanceMeters = (a: [number, number], b: [number, number]) => {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

const PetwalkerPainel = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeRequest, setActiveRequest] = useState<WalkSession | null>(null);
  const [openOffers, setOpenOffers] = useState<WalkOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(false);
  const watchId = useRef<number | null>(null);
  const lastLocationUpdateAtRef = useRef<number>(0);
  const lastLocationRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (!user) return;
    
    const init = async () => {
      try {
        const { data: profile } = await supabase
          .from('petwalker_profiles')
          .select('availability_status')
          .eq('user_id', user.id)
          .single();
        
        const online = profile?.availability_status === 'available';
        setIsOnline(online);
        
        // Use functional status update to ensure tracking starts correctly
        if (online) {
            startTracking();
        }

        const { data: request } = await supabase
          .from('walk_sessions')
          .select('*, customer:profiles!customer_id(full_name), pet:pets!pet_id(name, breed)')
          .eq('walker_id', user.id)
          .in('current_status', ['accepted', 'heading_to_pickup', 'arrived', 'in_progress', 'returning'])
          .maybeSingle();
        
        setActiveRequest(request as unknown as WalkSession);
        
        // Pass online status directly to avoid stale state in init
        if (online) {
            fetchOpenRequests(true);
        }
      } catch (err) {
        console.error('Init error:', err);
      } finally {
        setLoading(false);
      }
    };

    init();

    const channel = supabase
      .channel('petwalker-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'walk_sessions'
      }, (payload) => {
        const updated = payload.new as WalkSession;
        const old = payload.old as WalkSession;
        if (updated.walker_id === user.id) {
          setActiveRequest(updated);
        }
        if (old && old.walker_id === user.id && ['completed', 'cancelled'].includes(updated.current_status || '')) {
          setActiveRequest(null);
        }
        fetchOpenRequests(isOnline);
      })
      .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'walk_offers'
      }, () => {
          fetchOpenRequests(isOnline);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      stopTracking();
    };
  }, [user]);

  const startTracking = () => {
    if (!navigator.geolocation) return;
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
    }
    
    watchId.current = window.navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        const now = Date.now();
        
        const prev = lastLocationRef.current;
        const moved = prev ? distanceMeters(prev, [lng, lat]) : Infinity;
        
        if (now - lastLocationUpdateAtRef.current < 10000 && moved < 10) return;
        
        try {
            const { data: success, error } = await supabase.rpc('update_walker_location', {
              _lat: lat,
              _lng: lng,
              _accuracy: accuracy
            });

            if (!error && success) {
              lastLocationUpdateAtRef.current = now;
              lastLocationRef.current = [lng, lat];
            }
        } catch (err) {
            console.error('Failed to update location via RPC', err);
        }
      },
      (err) => {
        console.error('Tracking error:', err);
        if (err.code === 1) toast.error('Permissão de localização negada');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const stopTracking = () => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  };

  const fetchOpenRequests = async (statusOverride?: boolean) => {
    const activeStatus = statusOverride !== undefined ? statusOverride : isOnline;
    if (!activeStatus) return;
    
    const { data, error } = await supabase.rpc('get_available_walk_offers');
    if (!error && data) {
      setOpenOffers(data);
    }
  };

  const handleToggleOnline = async () => {
    const nextOnline = !isOnline;
    const newStatus = nextOnline ? 'available' : 'offline';
    try {
      const { error } = await supabase.rpc('set_petwalker_availability', { _status: newStatus });
      if (error) throw error;
      
      setIsOnline(nextOnline);
      if (nextOnline) {
        startTracking();
        fetchOpenRequests(true);
      } else {
        stopTracking();
        setOpenOffers([]);
      }
      toast.success(nextOnline ? 'Você está online e pronto para passear!' : 'Você está offline');
    } catch (err) {
      toast.error('Erro ao mudar status');
    }
  };

  const handleAccept = async (requestId: string) => {
    try {
      setLoading(true);
      const { data: success, error } = await supabase.rpc('accept_walk_request', { _session_id: requestId });
      if (error) throw error;
      if (!success) {
        toast.error('Este pedido já foi aceito por outro PetWalker ou expirou.');
        fetchOpenRequests(isOnline);
        return;
      }
      toast.success('Passeio aceito! Vá ao encontro do pet.');
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message || 'Erro ao aceitar pedido');
    } finally {
      setLoading(false);
    }
  };

  const handleDecline = async (requestId: string) => {
    try {
      const { error } = await supabase.rpc('decline_walk_offer', { _session_id: requestId });
      if (error) throw error;
      setOpenOffers(prev => prev.filter(o => o.id !== requestId));
      toast.info('Oferta recusada.');
    } catch (err) {
      toast.error('Erro ao recusar oferta');
    }
  };

  return (
    <PetwalkerProtectedRoute>
      <div className="min-h-screen bg-[#F7F5EF] pb-24">
        <header className="px-5 pt-8 pb-4 bg-white/50 backdrop-blur-sm sticky top-0 z-50">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <img src="/vaipet-logo.svg" alt="VaiPet" className="w-24 h-auto" />
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground opacity-60">Portal PetWalker</p>
            </div>
            <div className="flex items-center gap-2.5">
              <NotificationSheet />
              <button
                onClick={() => navigate('/petwalker/perfil')}
                className="w-10 h-10 rounded-full overflow-hidden bg-secondary border border-border/60 cursor-pointer active:scale-95 transition-transform"
              >
                {user?.user_metadata?.avatar_url ? (
                  <img src={user.user_metadata.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-secondary text-ink">
                    <User size={20} />
                  </div>
                )}
              </button>
            </div>
          </div>
        </header>

        <main className="p-6 space-y-6 max-w-lg mx-auto">
          <Card className="p-5 border-none shadow-sm rounded-[28px] bg-white">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold font-space">
                  {isOnline ? 'Você está Online' : 'Você está Offline'}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {isOnline ? 'Aguardando novas solicitações...' : 'Fique online para receber pedidos.'}
                </p>
              </div>
              <Button 
                onClick={handleToggleOnline}
                className={`rounded-full px-6 h-11 font-bold transition-all ${isOnline ? 'bg-red-500 hover:bg-red-600' : 'bg-[#31D880] hover:bg-[#1FB368]'}`}
              >
                {isOnline ? 'Ficar Offline' : 'Ficar Online'}
              </Button>
            </div>
          </Card>

          {activeRequest ? (
            <Card className="p-5 border-none shadow-md rounded-[28px] bg-ink text-white overflow-hidden relative">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <Dog size={80} />
              </div>
              
              <div className="relative z-10 space-y-4">
                <div className="flex items-center gap-2 text-[#31D880]">
                  <div className="w-2 h-2 rounded-full bg-[#31D880] animate-pulse" />
                  <span className="text-xs font-bold uppercase tracking-wider">
                    {activeRequest.current_status === 'accepted' && 'Passeio Confirmado'}
                    {activeRequest.current_status === 'heading_to_pickup' && 'A caminho do Pet'}
                    {activeRequest.current_status === 'arrived' && 'Chegou no Local'}
                    {activeRequest.current_status === 'in_progress' && 'Em Passeio'}
                  </span>
                </div>
                
                <div>
                  <h3 className="text-2xl font-bold font-space">{activeRequest.pet?.name || 'Pet'}</h3>
                  <p className="opacity-70 text-sm">
                    {activeRequest.customer?.full_name} • {activeRequest.meeting_point_address || 'Local de encontro'}
                  </p>
                </div>

                <div className="pt-2 flex flex-col gap-2">
                  <Button 
                    onClick={() => navigate(`/petwalker/passeio/${activeRequest.id}`)}
                    className="w-full bg-[#31D880] text-ink hover:bg-[#31D880]/90 font-bold h-12 rounded-2xl"
                  >
                    Gerenciar Passeio
                  </Button>
                </div>
              </div>
            </Card>
          ) : openOffers.length > 0 ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 px-1">
                <Navigation size={16} className="text-[#31D880]" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Solicitações Próximas</h3>
              </div>
              {openOffers.map((offer) => (
                <Card key={offer.id} className="p-5 border-none shadow-sm rounded-[28px] bg-white space-y-4 animate-in fade-in slide-in-from-bottom-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-bold text-lg">{offer.pet_name}</h4>
                      <p className="text-sm text-muted-foreground">{offer.planned_duration_minutes || 0}min</p>
                      <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                        <MapPin size={12} />
                        <span>{Math.round(offer.distance_to_walker_meters || 0)}m de distância</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-[#31D880]">R$ {((offer.total_price_cents || 0) / 100).toFixed(2)}</p>
                      <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-tighter">Valor Total</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button 
                        onClick={() => handleAccept(offer.id)}
                        disabled={loading}
                        className="flex-1 bg-ink text-white hover:bg-ink/90 font-bold h-11 rounded-2xl"
                    >
                        Aceitar
                    </Button>
                    <Button 
                        onClick={() => handleDecline(offer.id)}
                        variant="outline"
                        className="h-11 px-4 rounded-2xl border-gray-200"
                    >
                        Recusar
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center space-y-4 opacity-40">
              <div className="w-20 h-20 bg-gray-200 rounded-full flex items-center justify-center mx-auto">
                <Bell size={32} />
              </div>
              <p className="font-medium">Nenhuma solicitação ativa no momento</p>
            </div>
          )}

        </main>

        <PetwalkerNavigation />
      </div>
    </PetwalkerProtectedRoute>
  );
};

export default PetwalkerPainel;