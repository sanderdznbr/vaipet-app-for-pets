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

type WalkOffer = {
  id: string;
  customer_name: string;
  pet_name: string;
  pet_breed: string;
  meeting_point_address: string;
  distance_meters: number;
  planned_duration_minutes: number;
  total_price_cents: number;
};


const PetwalkerPainel = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeRequest, setActiveRequest] = useState<WalkSession | null>(null);
  const [openOffers, setOpenOffers] = useState<WalkOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(false);
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (!user) return;
    
    // 1. Initial check for availability and active requests
    const init = async () => {
      try {
        const { data: profile } = await supabase
          .from('petwalker_profiles')
          .select('availability_status')
          .eq('user_id', user.id)
          .single();
        
        const online = profile?.availability_status === 'available';
        setIsOnline(online);
        if (online) startTracking();

        const { data: request } = await supabase
          .from('walk_sessions')
          .select('*, customer:profiles!customer_id(full_name), pet:pets!pet_id(name, breed)')
          .eq('walker_id', user.id)
          .in('current_status', ['accepted', 'heading_to_pickup', 'arrived', 'in_progress'])
          .maybeSingle();
        
        setActiveRequest(request as WalkSession);
        fetchOpenRequests();
      } catch (err) {
        console.error('Init error:', err);
      } finally {
        setLoading(false);
      }
    };

    init();

    // 2. Realtime subscription
    const channel = supabase
      .channel('petwalker-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'walk_sessions'
      }, (payload) => {
        const updated = payload.new as WalkSession;
        // If it was assigned to me
        if (updated.walker_id === user.id) {
          setActiveRequest(updated);
        }
        // If I was the walker and it ended
        if (payload.old && (payload.old as any).walker_id === user.id && ['completed', 'cancelled'].includes(updated.current_status || '')) {
          setActiveRequest(null);
        }
        fetchOpenRequests();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      stopTracking();
    };
  }, [user]);

  const startTracking = () => {
    if (!navigator.geolocation || watchId.current) return;
    
    watchId.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        await supabase.rpc('update_walker_location', {
          _lat: latitude,
          _lng: longitude,
          _accuracy: accuracy
        });
      },
      (err) => console.error('Tracking error:', err),
      { enableHighAccuracy: true }
    );
  };

  const stopTracking = () => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  };

  const fetchOpenRequests = async () => {
    if (!isOnline) return;
    const { data, error } = await supabase.rpc('get_available_walk_offers');
    if (!error && data) {
      setOpenOffers(data as WalkOffer[]);
    }
  };

  const handleToggleOnline = async () => {
    const newStatus = isOnline ? 'offline' : 'available';
    try {
      const { error } = await supabase.rpc('set_petwalker_availability', { _status: newStatus });
      if (error) throw error;
      
      setIsOnline(!isOnline);
      if (!isOnline) {
        startTracking();
        fetchOpenRequests();
      } else {
        stopTracking();
        setOpenOffers([]);
      }
      toast.success(isOnline ? 'Você está offline' : 'Você está online e pronto para passear!');
    } catch (err) {
      toast.error('Erro ao mudar status');
    }
  };

  const handleAccept = async (requestId: string) => {
    try {
      const { error } = await supabase.rpc('accept_walk_request', { _session_id: requestId });
      if (error) throw error;
      toast.success('Passeio aceito! Vá ao encontro do pet.');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao aceitar pedido');
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
          {/* Status Card */}
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

          {/* Active Walk Section */}
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
                    onClick={() => navigate(`/passeio/${activeRequest.id}`)}
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
                      <p className="text-sm text-muted-foreground">{offer.pet_breed} • {offer.planned_duration_minutes}min</p>
                      <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                        <MapPin size={12} />
                        <span>{Math.round(offer.distance_meters)}m de distância</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-[#31D880]">R$ {(offer.total_price_cents / 100).toFixed(2)}</p>
                      <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-tighter">Ganhos est.</p>
                    </div>
                  </div>
                  <Button 
                    onClick={() => handleAccept(offer.id)}
                    className="w-full bg-ink text-white hover:bg-ink/90 font-bold h-11 rounded-2xl"
                  >
                    Aceitar Passeio
                  </Button>
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

          {/* Beta Simulation Tools */}
          <Card className="p-5 border-2 border-dashed border-[#31D880]/30 rounded-[28px] bg-white/50">
            <div className="flex items-center gap-2 mb-4 text-[#31D880]">
              <ShieldCheck size={18} />
              <h3 className="font-bold text-sm uppercase tracking-widest">Beta Simulation Tools</h3>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" className="h-10 text-xs rounded-xl border-gray-200">
                Simular Rota
              </Button>
              <Button variant="outline" className="h-10 text-xs rounded-xl border-gray-200">
                Resetar GPS
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-3 text-center italic">
              Apenas visível para contas PetWalker Beta.
            </p>
          </Card>
        </main>

        <PetwalkerNavigation />
      </div>
    </PetwalkerProtectedRoute>
  );
};

export default PetwalkerPainel;
