import React from 'react';
import { User as LucideUser, Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { NotificationSheet } from '@/components/NotificationSheet';
import { User } from '@supabase/supabase-js';

interface PetwalkerFloatingHeaderProps {
  user: User | null;
  isOnline: boolean;
  gpsStatus: 'requesting' | 'synced' | 'unstable' | 'stale' | 'denied' | 'error';
}

export const PetwalkerFloatingHeader = ({ user, isOnline, gpsStatus }: PetwalkerFloatingHeaderProps) => {
  const navigate = useNavigate();

  return (
    <header className="absolute top-0 left-0 right-0 px-4 pt-safe-plus flex items-center justify-between z-40 pointer-events-none">
      {/* Left: Profile Button */}
      <button 
        onClick={() => navigate('/petwalker/perfil')}
        className="w-11 h-11 rounded-full overflow-hidden border border-border bg-white shadow-sm pointer-events-auto active:scale-95 transition-transform"
      >
        {user?.user_metadata?.avatar_url ? (
          <img src={user.user_metadata.avatar_url} alt="Profile" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-50"><LucideUser className="text-gray-400" size={20} /></div>
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
  );
};