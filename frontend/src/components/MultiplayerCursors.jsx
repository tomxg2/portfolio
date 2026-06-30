import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase.js';

// Multiplayer cursors via Supabase Realtime.
//
// Each visitor joins the 'portfolio:lobby' channel:
//   • presence  → who's online (mounts visitor list)
//   • broadcast → throttled cursor positions in normalized screen space
//
// Screen-space is intentional: every visitor has their own camera angle,
// so projecting cursors into 3D world coords would put them in wildly
// different places. Overlay HTML cursors stay consistent across views.
//
// Falls back to rendering nothing if VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
// are missing — so the rest of the site still works in environments that
// don't have Realtime wired up yet.

const COLORS = ['#00ffcc', '#a78bfa', '#60a5fa', '#f472b6', '#fb923c', '#4ade80', '#facc15', '#22d3ee'];
const BROADCAST_THROTTLE_MS = 33; // ~30fps

// Stable per-tab identity
function makeIdentity() {
  const id   = Math.random().toString(36).slice(2, 8).toUpperCase();
  const seed = id.charCodeAt(0) + id.charCodeAt(1);
  return {
    id,
    name:  `Visitor ${id}`,
    color: COLORS[seed % COLORS.length],
  };
}

export default function MultiplayerCursors() {
  const [me]      = useState(makeIdentity);
  const [peers, setPeers] = useState({}); // { [peerId]: { x, y, name, color, lastSeen } }
  const channelRef = useRef(null);
  const lastBroadcastRef = useRef(0);

  // Open the realtime channel
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase.channel('portfolio:lobby', {
      config: {
        broadcast: { self: false }, // we already render our own cursor
        presence:  { key: me.id },
      },
    });
    channelRef.current = channel;

    channel
      .on('broadcast', { event: 'cursor' }, ({ payload }) => {
        if (!payload || payload.id === me.id) return;
        setPeers((prev) => ({
          ...prev,
          [payload.id]: {
            x: payload.x,
            y: payload.y,
            name: payload.name,
            color: payload.color,
            lastSeen: performance.now(),
          },
        }));
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        const ids = new Set(leftPresences.map((p) => p.id));
        setPeers((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(next)) if (ids.has(k)) delete next[k];
          return next;
        });
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ id: me.id, name: me.name, color: me.color });
        }
      });

    return () => { try { channel.unsubscribe(); } catch { /* noop */ } };
  }, [me]);

  // Pointer tracking — throttled broadcast
  useEffect(() => {
    if (!supabase) return;
    const onMove = (e) => {
      const now = performance.now();
      if (now - lastBroadcastRef.current < BROADCAST_THROTTLE_MS) return;
      lastBroadcastRef.current = now;
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      channelRef.current?.send({
        type: 'broadcast',
        event: 'cursor',
        payload: { id: me.id, name: me.name, color: me.color, x, y },
      });
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [me]);

  // GC peers we haven't heard from in 6s (handles tab close without proper leave)
  useEffect(() => {
    if (!supabase) return;
    const id = setInterval(() => {
      const now = performance.now();
      setPeers((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [k, v] of Object.entries(next)) {
          if (now - v.lastSeen > 6000) { delete next[k]; changed = true; }
        }
        return changed ? next : prev;
      });
    }, 2500);
    return () => clearInterval(id);
  }, []);

  if (!supabase) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]">
      <AnimatePresence>
        {Object.entries(peers).map(([id, p]) => (
          <motion.div
            key={id}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            style={{
              position: 'absolute',
              left: `${p.x * 100}%`,
              top:  `${p.y * 100}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            {/* Cursor dot */}
            <div
              className="w-3 h-3 rounded-full"
              style={{
                background: p.color,
                boxShadow: `0 0 8px ${p.color}, 0 0 16px ${p.color}55`,
                border: '1px solid rgba(255,255,255,0.7)',
              }}
            />
            {/* Name pill */}
            <div
              className="absolute top-4 left-4 px-2 py-0.5 rounded-full font-mono text-[10px]
                         whitespace-nowrap backdrop-blur-md"
              style={{
                background: 'rgba(8,8,12,0.7)',
                color: p.color,
                border: `1px solid ${p.color}55`,
              }}
            >
              {p.name}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
