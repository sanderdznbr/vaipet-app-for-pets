import React, { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Header } from '@/components/Header';
import { PetwalkerNavigation } from '@/components/petwalker/PetwalkerNavigation';
import { PetwalkerProtectedRoute } from '@/components/PetwalkerProtectedRoute';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MapPin, Navigation, Dog, Bell, ShieldCheck, Play, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

const PetwalkerPainel = () => {
  const { user } = useAuth();
  const [activeRequest, setActiveRequest] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(false);
  const [trackingEnabled, setTrackingEnabled] = useState(false);

  useEffect(() => {
    if (!user) return;
    
    // 1. Initial check for availability and active requests
    const init = async () => {
      const { data: profile } = await supabase
        .from('petwalker_profiles')
        .select('availability_status')
        .eq('user_id', user.id)
        .single();
      
      setIsOnline(profile?.availability_status === 'available');

      const { data: request } = await supabase
        .from('walk_sessions')
        .select('*, customer:customer_id(full_name), pet:pet_id(name, breed)')
        .eq('walker_id', user.id)
        .in('current_status', ['accepted', 'heading_to_pickup', 'arrived', 'in_progress'])
        .maybeSingle();
      
      setActiveRequest(request);
      setLoading(false);
    };

    init();

    // 2. Realtime subscription for NEW requests (searching in radius)
    // For Phase 3, we'll poll for 'searching' requests nearby OR use a broadcast channel
    const channel = supabase
      .channel('petwalker-offers')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'walk_sessions',
        filter: 'current_status=eq.searching'
      }, (payload) => {
        // Ideally filter by distance here or let the server handle matching notifications
        console.log('New request found:', payload.new);
        fetchOpenRequests();
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'walk_sessions',
        filter: `walker_id=eq.${user.id}`
      }, (payload) => {
        setActiveRequest(payload.new);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const fetchOpenRequests = async () => {
    // In a real implementation, this would call a RPC that filters by geography
    const { data } = await supabase
      .from('walk_sessions')
      .select('*, customer:customer_id(full_name), pet:pet_id(name, breed)')
      .eq('current_status', 'searching')
      .is('walker_id', null)
      .limit(5);
    
    // For simplicity in this step, if we find any "searching", we show as offer
    if (data && data.length > 0 && !activeRequest) {
      // Logic to show modal/card for acceptance
    }
  };

  const handleToggleOnline = async () => {
    const newStatus = isOnline ? 'offline' : 'available';
    try {
      await supabase.rpc('set_petwalker_availability', { _status: newStatus });
      setIsOnline(!isOnline);
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
        <Header />
        
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

          {/* Active Walk / Simulation Section */}
          {activeRequest ? (
            <Card className="p-5 border-none shadow-md rounded-[28px] bg-ink text-white overflow-hidden relative">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <Dog size={80} />
              </div>
              
              <div className="relative z-10 space-y-4">
                <div className="flex items-center gap-2 text-[#31D880]">
                  <div className="w-2 h-2 rounded-full bg-[#31D880] animate-pulse" />
                  <span className="text-xs font-bold uppercase tracking-wider">Passeio Ativo</span>
                </div>
                
                <div>
                  <h3 className="text-2xl font-bold font-space">{activeRequest.pet?.name}</h3>
                  <p className="opacity-70 text-sm">{activeRequest.customer?.full_name} • {activeRequest.meeting_point_address || 'Ponto de encontro'}</p>
                </div>

                <div className="pt-2 flex flex-col gap-2">
                  <Button className="w-full bg-[#31D880] text-ink hover:bg-[#31D880]/90 font-bold h-12 rounded-2xl">
                    Abrir Mapa e Tracking
                  </Button>
                </div>
              </div>
            </Card>
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
