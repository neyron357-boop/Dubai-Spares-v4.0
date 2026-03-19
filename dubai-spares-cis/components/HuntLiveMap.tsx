/**
 * HuntLiveMap – Leaflet-based live map for the client tracking page.
 *
 * Shows:
 *  • The GPS track (blue polyline of all recorded pings)
 *  • The current position (animated pulsing marker)
 *  • Waypoint pins (colour-coded by result)
 *
 * The map smoothly pans to the latest GPS position whenever it changes.
 */
import React, { useEffect, useRef } from 'react';
import type { Map as LeafletMap, Marker, Polyline, CircleMarker } from 'leaflet';
import { HuntGpsPingRow, HuntWaypointResult, HuntWaypointRow } from '../types';

// Lazy-load the CSS so Vite only bundles it on import
import 'leaflet/dist/leaflet.css';

interface HuntLiveMapProps {
  track: HuntGpsPingRow[];
  latestPing: HuntGpsPingRow | null;
  waypoints: HuntWaypointRow[];
  /** Height class applied to the container div, e.g. "h-56". Defaults to "h-56". */
  heightClass?: string;
}

const WAYPOINT_COLORS: Record<HuntWaypointResult, string> = {
  found: '#10b981',      // emerald-500
  not_found: '#f87171', // red-400
  high_price: '#f59e0b', // amber-500
  visited: '#60a5fa',   // blue-400
  defect: '#f97316'     // orange-500
};

/** Default centre over Sharjah / Dubai area */
const DEFAULT_CENTER: [number, number] = [25.3352, 55.4117];
const DEFAULT_ZOOM = 13;

const HuntLiveMap: React.FC<HuntLiveMapProps> = ({
  track,
  latestPing,
  waypoints,
  heightClass = 'h-56'
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const posMarkerRef = useRef<CircleMarker | null>(null);
  const trackLineRef = useRef<Polyline | null>(null);
  const waypointMarkersRef = useRef<Marker[]>([]);

  // ── Initialise map once ───────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Leaflet is a large lib — dynamic import keeps initial bundle small
    import('leaflet').then((L) => {
      if (!containerRef.current || mapRef.current) return;

      // Fix Leaflet default marker icon paths broken by bundlers
      (L.Icon.Default.prototype as any)._getIconUrl = undefined;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png'
      });

      const center: [number, number] = latestPing
        ? [latestPing.lat, latestPing.lng]
        : (track.length > 0 ? [track[track.length - 1].lat, track[track.length - 1].lng] : DEFAULT_CENTER);

      const map = L.map(containerRef.current, {
        center,
        zoom: DEFAULT_ZOOM,
        zoomControl: false,
        attributionControl: false
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
      }).addTo(map);

      // Compact zoom control in bottom-right corner
      L.control.zoom({ position: 'bottomright' }).addTo(map);

      mapRef.current = map;

      // Draw initial track and position
      renderTrack(L, map);
      renderPosition(L, map);
      renderWaypoints(L, map);
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        posMarkerRef.current = null;
        trackLineRef.current = null;
        waypointMarkersRef.current = [];
      }
    };
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const renderTrack = (L: typeof import('leaflet'), map: LeafletMap) => {
    if (trackLineRef.current) {
      trackLineRef.current.remove();
      trackLineRef.current = null;
    }
    if (track.length < 2) return;
    const latlngs = track.map((p) => [p.lat, p.lng] as [number, number]);
    trackLineRef.current = L.polyline(latlngs, {
      color: '#38bdf8',   // sky-400
      weight: 3,
      opacity: 0.8,
      dashArray: '6, 4'
    }).addTo(map);
  };

  const renderPosition = (L: typeof import('leaflet'), map: LeafletMap) => {
    if (!latestPing) return;
    const pos: [number, number] = [latestPing.lat, latestPing.lng];
    if (posMarkerRef.current) {
      posMarkerRef.current.setLatLng(pos);
    } else {
      posMarkerRef.current = L.circleMarker(pos, {
        radius: 10,
        color: '#ef4444',    // red-500 — matching the LIVE indicator colour
        fillColor: '#ef4444',
        fillOpacity: 0.85,
        weight: 3,
        className: 'hunt-live-position-marker'
      }).addTo(map);
    }
  };

  const renderWaypoints = (L: typeof import('leaflet'), map: LeafletMap) => {
    waypointMarkersRef.current.forEach((m) => m.remove());
    waypointMarkersRef.current = [];
    waypoints.forEach((wp) => {
      if (wp.lat == null || wp.lng == null) return;
      const color = WAYPOINT_COLORS[wp.result] ?? '#94a3b8';
      const icon = L.divIcon({
        html: `<div style="
          width:22px;height:22px;border-radius:50%;
          background:${color};border:2.5px solid white;
          box-shadow:0 1px 6px rgba(0,0,0,0.35);
          display:flex;align-items:center;justify-content:center;
          font-size:10px;color:white;font-weight:700
        ">${wp.shop_name.slice(0, 1).toUpperCase()}</div>`,
        className: '',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });
      const marker = L.marker([wp.lat, wp.lng], { icon })
        .bindPopup(`<b>${wp.shop_name}</b><br/>${wp.result}${wp.price_aed ? ` · ${wp.price_aed} AED` : ''}`);
      marker.addTo(map);
      waypointMarkersRef.current.push(marker);
    });
  };

  // ── Sync track when it changes ────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    import('leaflet').then((L) => {
      if (!mapRef.current) return;
      renderTrack(L, mapRef.current);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);

  // ── Sync position when latestPing changes (with smooth pan) ──────────────
  useEffect(() => {
    if (!mapRef.current || !latestPing) return;
    import('leaflet').then((L) => {
      if (!mapRef.current || !latestPing) return;
      const pos: [number, number] = [latestPing.lat, latestPing.lng];
      renderPosition(L, mapRef.current);
      // Smooth pan to new position
      mapRef.current.panTo(pos, { animate: true, duration: 0.8 });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestPing?.lat, latestPing?.lng]);

  // ── Sync waypoints when they change ──────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    import('leaflet').then((L) => {
      if (!mapRef.current) return;
      renderWaypoints(L, mapRef.current);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypoints.length]);

  return (
    <div
      ref={containerRef}
      className={`w-full ${heightClass} bg-slate-800`}
      style={{ minHeight: '200px' }}
    />
  );
};

export default HuntLiveMap;
