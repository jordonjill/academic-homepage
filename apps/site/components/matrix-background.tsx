"use client";

import { useEffect, useRef } from "react";

const GLYPHS = "01{}[]<>/\\|=+-*ABCDEFGHIJKLMNOPQRSTUVWXYZｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ";

export function MatrixBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    let fontSize = window.innerWidth < 768 ? 24 : 16;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();

    let columns = Math.ceil(window.innerWidth / fontSize);
    let drops = Array.from({ length: columns }, () => Math.random() * -100);

    const draw = () => {
      context.fillStyle = "rgba(2, 9, 4, 0.14)";
      context.fillRect(0, 0, window.innerWidth, window.innerHeight);
      context.font = `${fontSize}px "IBM Plex Mono", monospace`;

      for (let index = 0; index < drops.length; index += 1) {
        const char = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        const x = index * fontSize;
        const y = drops[index] * fontSize;

        context.fillStyle = y % 160 < 32 ? "rgba(233, 255, 231, 0.7)" : "rgba(71, 230, 91, 0.5)";
        context.fillText(char, x, y);

        if (y > window.innerHeight && Math.random() > 0.975) {
          drops[index] = Math.random() * -20;
        }

        drops[index] += 0.42;
      }
    };

    let frame: number;
    let isRunning = true;

    const loop = () => {
      if (isRunning) {
        draw();
        frame = window.requestAnimationFrame(loop);
      }
    };
    
    frame = window.requestAnimationFrame(loop);

    const handleResize = () => {
      resize();
      fontSize = window.innerWidth < 768 ? 24 : 16;
      columns = Math.ceil(window.innerWidth / fontSize);
      drops = Array.from({ length: columns }, () => Math.random() * -100);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        isRunning = false;
        window.cancelAnimationFrame(frame);
      } else {
        isRunning = true;
        frame = window.requestAnimationFrame(loop);
      }
    };

    window.addEventListener("resize", handleResize);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isRunning = false;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-0 opacity-75"
      aria-hidden="true"
    />
  );
}
