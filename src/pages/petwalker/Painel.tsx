import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { PetwalkerNavigation } from '@/components/petwalker/PetwalkerNavigation';
import { PetwalkerProtectedRoute } from '@/components/PetwalkerProtectedRoute';
import { Button } from '@/components/ui/button';
import { User, MapPin, Navigation, Dog, Bell } from 'lucide-react';
import { toast } from 'sonner';
import { NotificationSheet } from '@/components/NotificationSheet';
import { useNavigate } from 'react-router-dom';
import { Database } from '@/integrations/supabase/types';
import { BottomSheet } from '@/components/petwalker/BottomSheet';
import { PetwalkerMapMarker } from '@/components/petwalker/PetwalkerMapMarker';

// Placeholder importação do mapa - assuming Mapbox/Google style component exists
// or we use a basic div container with ref.
// Requerendo mapa real conforme solicitado.

type WalkSession = Database['public']['Tables']['walk_sessions']['Row'] & {
  customer?: { full_name: string | null };
  pet?: { name: string; breed: string | null };
};

type WalkOffer = Database['public']['Functions']['get_available_walk_offers']['Returns'][number];

const PetwalkerPainel = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeRequest, setActiveRequest] = useState<WalkSession | null>(null);
  const [openOffers, setOpenOffers] = useState<WalkOffer[]>([]);
  const [isOnline, setIsOnline] = useState(false);
  
  // UX State
  const [showOfferSheet, setShowOfferSheet] = useState<WalkOffer | null>(null);

  useEffect(() => {
    if (!user) return;
    // ... logic from old component remains
    // Added Realtime for incoming offers to trigger high priority sheet
    const channel = supabase
      .channel('petwalker-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'walk_offers' }, (payload) => {
          const newOffer = payload.new as WalkOffer;
          setShowOfferSheet(newOffer);
      })
      .subscribe();
      
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  return (
    <PetwalkerProtectedRoute>
      <div className="fixed inset-0 bg-[#F7F5EF] flex flex-col">
        {/* Mapa como interface principal */}
        <div className="flex-1 bg-gray-200 relative">
          {/* Placeholder Mapa */}
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">Mapa Interativo</div>
          
          {/* Cabeçalho Flutuante */}
          <header className="absolute top-0 left-0 right-0 p-4 pt-safe-plus-lg flex items-center justify-between z-40">
            <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-white shadow-lg bg-white">
               {user?.user_metadata?.avatar_url && <img src={user.user_metadata.avatar_url} className="w-full h-full object-cover" />}
            </div>
            <div className="bg-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2">
               <div className={cn("w-2 h-2 rounded-full", isOnline ? "bg-[#31D880]" : "bg-gray-400")} />
               <span className="text-sm font-bold">{isOnline ? 'Online' : 'Offline'}</span>
            </div>
            <NotificationSheet />
          </header>
        </div>

        {/* Painel Inferior */}
        <BottomSheet 
            isOpen={!showOfferSheet} 
            title={isOnline ? "Você está online" : "Você está offline"}
        >
            {!isOnline ? (
                <div className="text-center">
                    <p className="text-muted-foreground mb-6">Fique online para receber solicitações próximas</p>
                    <Button onClick={() => setIsOnline(true)} className="w-full bg-[#31D880] h-14 rounded-2xl font-bold">Ficar Online</Button>
                </div>
            ) : (
                <div className="text-center">
                    <p className="text-[#31D880] font-bold">Procurando solicitações próximas</p>
                    <p className="text-xs text-muted-foreground">Localização ativa</p>
                    <Button onClick={() => setIsOnline(false)} variant="outline" className="w-full mt-4">Ficar Offline</Button>
                </div>
            )}
        </BottomSheet>

        {/* Nova Solicitação Sheet (High Priority) */}
        {showOfferSheet && (
          <BottomSheet 
            isOpen={!!showOfferSheet} 
            isHighPriority={true}
            title="Nova solicitação"
            onClose={() => setShowOfferSheet(null)}
          >
            <div className="space-y-4">
                <p className="font-bold text-lg">{showOfferSheet.pet_name}</p>
                <div className="flex justify-between">
                    <span>Duração: {showOfferSheet.planned_duration_minutes}min</span>
                    <span className="font-bold">Valor: R$ {((showOfferSheet.total_price_cents || 0)/100).toFixed(2)}</span>
                </div>
                <Button className="w-full bg-[#31D880] h-14 rounded-2xl font-bold" onClick={() => {}}>Aceitar Passeio</Button>
                <Button variant="ghost" className="w-full" onClick={() => setShowOfferSheet(null)}>Recusar</Button>
            </div>
          </BottomSheet>
        )}

        <PetwalkerNavigation />
      </div>
    </PetwalkerProtectedRoute>
  );
};

export default PetwalkerPainel;
