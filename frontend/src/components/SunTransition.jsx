import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

export default function SunTransition({ onDone }) {
  const videoRef = useRef(null);
  const doneRef = useRef(false);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone?.();
  };

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => finish());
    const failsafe = setTimeout(finish, 2600);
    return () => clearTimeout(failsafe);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <motion.div
      className="fixed inset-0 z-[60] pointer-events-none bg-black"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        muted
        playsInline
        preload="auto"
        poster="/transitions/sun_warp_poster.jpg"
        onEnded={finish}
      >
        <source src="/transitions/sun_warp.webm" type="video/webm" />
        <source src="/transitions/sun_warp.mp4" type="video/mp4" />
      </video>
    </motion.div>
  );
}
