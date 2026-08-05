import React from 'react';
import { Home, PawPrint, Users, Store, Settings } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useHomeTheme } from '@/hooks/useHomeTheme';

const BRAND = '#31D880';

const navItems = [
  { icon: PawPrint, route: '/search-walk', label: 'Passeio' },
  { icon: Users, route: '/rede-pet', label: 'Rede' },
  { icon: Home, route: '/inicio', label: 'Home' },
  { icon: Store, route: '/petshop', label: 'Shop' },
  { icon: Settings, route: '/configuracoes', label: 'Ajustes' },
];

export const BottomNavigation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // Always render INVERTED relative to the page so the bar pops.
  const { inverted } = useHomeTheme();
  const BG = inverted.paper; // navbar background (inverted page paper)
  const FG = inverted.ink;   // icon color on the bar

  const isActive = (route: string) =>
    route === '/inicio' ? location.pathname === '/inicio' || location.pathname === '/' : location.pathname.startsWith(route);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none">
      <div className="max-w-md mx-auto pointer-events-auto">
        <div
          className="relative"
          style={{
            background: BG,
            borderRadius: '32px 32px 0 0',
            paddingTop: 16,
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
            boxShadow: '0 -12px 40px rgba(0,0,0,0.12)',
          }}
        >
          {/* subtle organic highlight */}
          <span
            aria-hidden
            className="absolute left-0 right-0 top-0 pointer-events-none"
            style={{
              height: 1,
              background:
                `linear-gradient(90deg, transparent 0%, ${FG}1A 50%, transparent 100%)`,
              borderRadius: '32px 32px 0 0',
            }}
          />

          <div className="relative flex items-center justify-around px-4">
            {navItems.map((item) => {
              const active = isActive(item.route);
              const IconComponent = item.icon;

              return (
                <button
                  key={item.route}
                  id={item.route === '/petshop' ? 'tour-nav-shop' : item.route === '/search-walk' ? 'tour-nav-walk' : undefined}
                  onClick={() => navigate(item.route)}
                  aria-label={item.label}
                  className="relative flex items-center justify-center transition-all duration-300 active:scale-90"
                  style={{
                    width: active ? 64 : 48,
                    height: active ? 64 : 48,
                  }}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute inset-0"
                      style={{
                        background: BRAND,
                        borderRadius: '58% 42% 55% 45% / 50% 55% 45% 50%',
                        boxShadow: '0 10px 26px -8px rgba(49,216,128,0.7)',
                      }}
                    />
                  )}
                  <IconComponent
                    className="relative transition-all duration-300"
                    style={{
                      width: active ? 26 : 22,
                      height: active ? 26 : 22,
                      color: active ? '#0B1410' : `${FG}8C`,
                    }}
                    strokeWidth={active ? 2.4 : 1.7}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
