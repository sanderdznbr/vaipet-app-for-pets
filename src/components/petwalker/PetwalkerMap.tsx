import React, { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { hideMapLabels, enrichMap, tintMapInk } from '@/lib/mapStyle';
import { cn } from '@/lib/utils';

interface PetwalkerMapProps {
  mapboxToken: string;
  isOnline: boolean;
  onMapLoad: (map: mapboxgl.Map) => void;
  className?: string;
}

export const PetwalkerMap = ({ mapboxToken, isOnline, onMapLoad, className }: PetwalkerMapProps) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    mapboxgl.accessToken = mapboxToken;
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/standard",
      // Neutral view instead of hardcoded city
      center: [0, 0],
      zoom: 1,
      pitch: 45,
      attributionControl: false,
    });

    map.current.on('load', () => {
      if (!map.current) return;
      hideMapLabels(map.current);
      enrichMap(map.current, true);
      tintMapInk(map.current, false);
      onMapLoad(map.current);
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [mapboxToken]);

  return (
    <div 
      ref={mapContainer} 
      className={cn("absolute inset-0 z-0 transition-opacity duration-500", !isOnline && "opacity-[0.88]", className)} 
    />
  );
};