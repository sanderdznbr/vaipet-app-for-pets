import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import { hideMapLabels, enrichMap, tintMapInk } from '@/lib/mapStyle';
import { useHomeTheme } from '@/hooks/useHomeTheme';
import 'mapbox-gl/dist/mapbox-gl.css';

import { ArrowLeft, Clock, Calendar, Route, DollarSign, MapPin, Flag, Home, Star, Timer } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

const MAPBOX_TOKEN = 'pk.eyJ1Ijoic2FuZGVyY29sb21iZXMiLCJhIjoiY21kNDBuaHZ4MGF3bjJtb2dwNHdsMWR1aCJ9.D_kYvjRu2iigL2uziaEomQ';

const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
const fmtDuration = (m?: number | null) => {
  if (!m) return '—';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}min` : `${h}h`;
};

export const WalkDetails: React.FC<{ isOperational?: boolean }> = ({ isOperational = false }) => {
  const { id } = useParams<{ name: string; id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const { theme } = useHomeTheme();
  const isDarkMode = theme === 'dark';
  const [walk, setWalk] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [concluding, setConcluding] = useState(false);
  const [concludeError, setConcludeError] = useState<string | null>(null);

  const handleCompleteWalk = async () => {
    if (concluding || !walk?.id) return;
    setConcluding(true);
    setConcludeError(null);
    try {
      const { data, error } = await supabase.rpc('petwalker_complete_walk', {
        _session_id: walk.id
      });
      if (error) {
        setConcludeError(error.message);
        setConcluding(false);
        return;
      }
      if (data === true) {
        navigate('/petwalker/painel');
        return;
      }
      setConcludeError('Não foi possível concluir o passeio. Tente novamente.');
      setConcluding(false);
    } catch (e) {
      setConcludeError('Erro inesperado ao concluir o passeio. Tente novamente.');
      setConcluding(false);
    }
  };

  useEffect(() => {
    if (!id || !user) return;
    (async () => {
      const { data, error } = await supabase
        .from('walk_sessions')
        .select('*, pets:pet_id(name, avatar_url)')
        .eq('id', id)
        .maybeSingle();
      if (error) console.error('WalkDetails fetch error', error);
      setWalk(data);
      setLoading(false);
    })();
  }, [id, user]);

  // Initialize map with the persisted trail
  useEffect(() => {
    if (!walk || !mapContainer.current || map.current) return;
    const coords = (walk.route_coordinates as [number, number][] | null) || [];
    const start = coords[0] || (walk.home_location ? [walk.home_location.lng, walk.home_location.lat] : null);
    if (!start) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/standard",
      center: start,
      zoom: 16,
      pitch: 40,
      interactive: true,
      attributionControl: false,
      config: {
        basemap: {
          lightPreset: isDarkMode ? "night" : "day",
          theme: isDarkMode ? "default" : "faded",
          colorLand: "#F2F1E8",
          colorWater: "#D5E8E5",
          colorGreenspace: "#C5DEBC",
          colorRoads: "#FFFFFF",
          colorTrunks: "#F5EEDB",
          colorMotorways: "#EEE4C8",
          colorBuildings: "#E6E3D8",
          colorRoadLabels: "#84908A",
          colorPlaceLabels: "#46534D"
        }
      }
    });
    map.current.on('load', () => {
      const m = map.current!;
      hideMapLabels(m);
      enrichMap(m, !isDarkMode);
      tintMapInk(m, isDarkMode);

      if (coords.length >= 2) {
        m.addSource('trail', {
          type: 'geojson',
          lineMetrics: true,
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
        });
        m.addLayer({
          id: 'trail-glow', type: 'line', source: 'trail',
          paint: { 'line-color': '#31D880', 'line-width': 14, 'line-opacity': 0.18, 'line-blur': 6 },
          layout: { 'line-join': 'round', 'line-cap': 'round' },
        });
        m.addLayer({
          id: 'trail-line', type: 'line', source: 'trail',
          paint: {
            'line-width': 7,
            'line-gradient': [
              'interpolate', ['linear'], ['line-progress'],
              0,   'rgba(0, 169, 120, 0.10)',
              0.5, 'rgba(0, 169, 120, 0.50)',
              1,   'rgba(0, 169, 120, 1.00)',
            ] as any,
          },
          layout: { 'line-join': 'round', 'line-cap': 'round' },
        });
        // Start + end pins
        const startEl = document.createElement('div');
        startEl.innerHTML = `<div style="width:28px;height:28px;border-radius:50%;background:#31D880;border:4px solid white;box-shadow:0 4px 12px rgba(0,0,0,0.25);"></div>`;
        new mapboxgl.Marker(startEl).setLngLat(coords[0]).addTo(m);
        const endEl = document.createElement('div');
        endEl.innerHTML = `<div style="width:34px;height:34px;border-radius:50%;background:white;border:4px solid #31D880;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.25);font-weight:800;color:#31D880;font-size:14px;">🏁</div>`;
        new mapboxgl.Marker(endEl).setLngLat(coords[coords.length - 1]).addTo(m);
        const bounds = coords.reduce((b, c) => b.extend(c as any), new mapboxgl.LngLatBounds(coords[0] as any, coords[0] as any));
        m.fitBounds(bounds, { padding: 60, duration: 1200 });
      }
    });
    return () => { map.current?.remove(); map.current = null; };
  }, [walk]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!walk) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground">Passeio não encontrado</p>
        <button onClick={() => navigate(-1)} className="text-sm font-bold text-accent">Voltar</button>
      </div>
    );
  }

  const coords = (walk.route_coordinates as [number, number][] | null) || [];
  const duration = walk.actual_duration_minutes || walk.planned_duration_minutes;
  const distance = Number(walk.distance_km || 0);
  const price = walk.total_price_cents ? walk.total_price_cents / 100 : 0;

  return (
    <div className="min-h-screen bg-background max-w-md mx-auto pb-10">
      {/* Header */}
      <div className="px-4 pt-8 pb-4 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-card border border-border/40 flex items-center justify-center active:scale-95 transition-transform"
          aria-label="Voltar"
        >
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-extrabold text-foreground truncate">Detalhes do passeio</h1>
          <p className="text-xs text-muted-foreground font-medium truncate">
            {walk.pets?.name || 'Pet'} • {fmtDate(walk.start_time || walk.created_at)}
          </p>
        </div>
      </div>

      {/* Trajeto */}
      <div className="px-4">
        <div className="rounded-3xl overflow-hidden border border-border/40 bg-card relative" style={{ height: 320 }}>
          {coords.length >= 2 ? (
            <div ref={mapContainer} className="absolute inset-0" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
              <Route className="w-8 h-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">Sem trajeto registrado</p>
              <p className="text-[11px] text-muted-foreground/60">Este passeio não armazenou pontos GPS.</p>
            </div>
          )}
          {coords.length >= 2 && (
            <div className="absolute bottom-3 left-3 right-3 rounded-2xl bg-background/85 backdrop-blur px-3 py-2 flex items-center justify-between text-[11px] font-semibold">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-accent/30" /> Início</span>
              <span className="text-muted-foreground">{coords.length} pontos</span>
              <span className="flex items-center gap-1.5">Fim <span className="w-2 h-2 rounded-full bg-accent" /></span>
            </div>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="px-4 mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-border/40 bg-card p-3">
          <Timer className="w-4 h-4 text-accent mb-1" />
          <p className="text-[10px] text-muted-foreground font-medium">Duração</p>
          <p className="text-sm font-extrabold text-foreground">{fmtDuration(duration)}</p>
        </div>
        <div className="rounded-2xl border border-border/40 bg-card p-3">
          <Route className="w-4 h-4 text-accent mb-1" />
          <p className="text-[10px] text-muted-foreground font-medium">Distância</p>
          <p className="text-sm font-extrabold text-foreground">{distance.toFixed(2)} km</p>
        </div>
        <div className="rounded-2xl border border-border/40 bg-card p-3">
          <DollarSign className="w-4 h-4 text-accent mb-1" />
          <p className="text-[10px] text-muted-foreground font-medium">Valor</p>
          <p className="text-sm font-extrabold text-foreground">R$ {price.toFixed(2)}</p>
        </div>
      </div>

      {/* Linha do tempo */}
      <div className="px-4 mt-4">
        <div className="rounded-2xl border border-border/40 bg-card p-4">
          <h2 className="text-xs font-extrabold text-foreground/80 uppercase tracking-wider mb-3">Linha do tempo</h2>
          <div className="space-y-3">
            <TimelineRow
              icon={<Home className="w-4 h-4 text-accent" />}
              label="Pet retirado"
              value={fmtTime(walk.start_time)}
            />
            <TimelineRow
              icon={<Flag className="w-4 h-4 text-accent" />}
              label="Pet entregue"
              value={fmtTime(walk.end_time)}
            />
            <TimelineRow
              icon={<Calendar className="w-4 h-4 text-accent" />}
              label="Data"
              value={fmtDate(walk.start_time || walk.created_at)}
            />
            <TimelineRow
              icon={<Clock className="w-4 h-4 text-accent" />}
              label="Duração planejada"
              value={fmtDuration(walk.planned_duration_minutes)}
            />
          </div>
        </div>
      </div>

      {/* Passeador */}
      <div className="px-4 mt-4">
        <div className="rounded-2xl border border-border/40 bg-card p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
            <span className="text-base font-extrabold text-accent">
              {(walk.walker_name || 'P').charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground truncate">{walk.walker_name || 'Pet Walker'}</p>
            <p className="text-[11px] text-muted-foreground">Passeador</p>
          </div>
          {walk.rating ? (
            <div className="flex items-center gap-1 text-sm font-bold">
              <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
              {walk.rating}
            </div>
          ) : null}
        </div>
      </div>

      {walk.feedback ? (
        <div className="px-4 mt-4">
          <div className="rounded-2xl border border-border/40 bg-card p-4">
            <h2 className="text-xs font-extrabold text-foreground/80 uppercase tracking-wider mb-2">Seu feedback</h2>
            <p className="text-sm text-foreground/90">{walk.feedback}</p>
          </div>
        </div>
      ) : null}

      {/* Status */}
      <div className="px-4 mt-4">
        <div className="rounded-2xl border border-border/40 bg-card p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-foreground font-medium">Status</span>
          </div>
          <span className="text-xs font-extrabold px-3 py-1 rounded-full bg-accent/10 text-accent capitalize">
            {walk.current_status}
          </span>
        </div>
      </div>
      {isOperational && walk.current_status !== 'completed' && walk.current_status !== 'cancelled' && (
        <div className="fixed bottom-6 left-4 right-4 z-50 flex flex-col gap-3">
          {walk.current_status === 'accepted' && (
            <button 
              onClick={async () => {
                const { error } = await supabase.rpc('petwalker_start_heading', { _session_id: walk.id });
                if (!error) window.location.reload();
              }}
              className="w-full bg-[#31D880] text-ink font-extrabold py-4 rounded-2xl shadow-xl active:scale-95 transition-transform"
            >
              Iniciar Deslocamento
            </button>
          )}
          {walk.current_status === 'heading_to_pickup' && (
            <button 
              onClick={async () => {
                const { error } = await supabase.rpc('petwalker_arrive_pickup', { _session_id: walk.id });
                if (!error) window.location.reload();
              }}
              className="w-full bg-blue-500 text-white font-extrabold py-4 rounded-2xl shadow-xl active:scale-95 transition-transform"
            >
              Cheguei no Local
            </button>
          )}
          {walk.current_status === 'arrived' && (
            <button 
              onClick={async () => {
                const { error } = await supabase.rpc('petwalker_start_walk', { _session_id: walk.id });
                if (!error) window.location.reload();
              }}
              className="w-full bg-orange-500 text-white font-extrabold py-4 rounded-2xl shadow-xl active:scale-95 transition-transform"
            >
              Iniciar Passeio
            </button>
          )}
          {walk.current_status === 'in_progress' && (
            <>
              {concludeError && (
                <div className="w-full rounded-2xl bg-destructive/10 text-destructive text-sm font-semibold px-4 py-3">
                  {concludeError}
                </div>
              )}
              <button
                onClick={handleCompleteWalk}
                disabled={concluding}
                className="w-full bg-purple-600 text-white font-extrabold py-4 rounded-2xl shadow-xl active:scale-95 transition-transform disabled:opacity-60"
              >
                {concluding ? 'Finalizando…' : concludeError ? 'Tentar novamente' : 'Finalizar Passeio'}
              </button>
            </>
          )}
          <button 
            onClick={() => navigate('/petwalker/painel')}
            className="w-full bg-card text-foreground border border-border/40 font-bold py-3 rounded-2xl active:scale-95 transition-transform text-sm"
          >
            Voltar ao Painel
          </button>
        </div>
      )}
    </div>
  );
};

const TimelineRow: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="flex items-center gap-3">
    <div className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center">{icon}</div>
    <div className="flex-1 min-w-0">
      <p className="text-[11px] text-muted-foreground font-medium">{label}</p>
      <p className="text-sm font-bold text-foreground">{value}</p>
    </div>
  </div>
);

export default WalkDetails;