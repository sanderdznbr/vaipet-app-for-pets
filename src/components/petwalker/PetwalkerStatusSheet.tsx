import React from 'react';
import { Button } from '@/components/ui/button';
import { BottomSheet } from './BottomSheet';
import { useNavigate } from 'react-router-dom';
import { Navigation } from 'lucide-react';
import { PetwalkerGpsStatus } from './PetwalkerGpsStatus';

interface PetwalkerStatusSheetProps {
  isOnline: boolean;
  onToggleOnline: () => void;
  gpsStatus: 'loading' | 'active' | 'denied' | 'error' | 'unstable';
  lastSync: Date | null;
  onRetryGps: () => void;
}

export const PetwalkerStatusSheet = ({ 
  isOnline, 
  onToggleOnline, 
  gpsStatus, 
  lastSync,
  onRetryGps
}: PetwalkerStatusSheetProps) => {
  const navigate = useNavigate();

  if (gpsStatus === 'denied' || gpsStatus === 'error') {
    return (
      <BottomSheet isOpen={true} navigationOffset={false} dismissible={true}>
        <div className="space-y-6 py-2">
          <div className="flex items-center gap-4 bg-red-50 p-4 rounded-2xl border border-red-100">
            <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center text-red-500 shadow-sm">
              <Navigation size={24} />
            </div>
            <div>
              <h3 className="text-lg font-bold font-space text-red-900">Ative sua localização</h3>
              <p className="text-sm text-red-700 leading-tight">Precisamos do seu GPS para você receber solicitações de passeio.</p>
            </div>
          </div>
          
          <div className="space-y-3">
            <Button 
              onClick={onRetryGps}
              className="w-full bg-ink text-white hover:bg-ink/90 h-[54px] rounded-2xl font-bold"
            >
              Tentar novamente
            </Button>
            <button className="w-full text-sm font-bold text-muted-foreground py-2">Como permitir a localização</button>
          </div>
        </div>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet isOpen={true} navigationOffset={true} dismissible={true}>
      {!isOnline ? (
        <div className="space-y-6">
          <div className="text-center space-y-1">
            <h3 className="text-xl font-bold font-space text-ink">Você está offline</h3>
            <p className="text-sm text-muted-foreground">Fique online para receber solicitações de passeio próximas</p>
          </div>
          <Button 
            onClick={onToggleOnline} 
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
            <button onClick={onToggleOnline} className="text-sm font-bold text-red-500 px-2 py-1">Ficar offline</button>
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

            <PetwalkerGpsStatus gpsStatus={gpsStatus} lastSync={lastSync} />
          </div>
        </div>
      )}
    </BottomSheet>
  );
};