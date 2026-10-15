"use client";

import { useEffect, useRef } from "react";
import { LOGIN_BACKGROUND_VIDEOS, mountLoginVideoBackground } from "@/lib/loginVideoBackground";

export default function LoginBackground() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => root.current ? mountLoginVideoBackground(root.current) : undefined, []);
  return <div ref={root} className="login-background" aria-hidden="true">
    <div className="login-background-poster" />
    <div className="login-background-video">
      {LOGIN_BACKGROUND_VIDEOS.map(source => <video key={source} data-src={source} data-mobile-src={source.replace("-1280.mp4", "-640.mp4")} muted playsInline preload="none" tabIndex={-1} disablePictureInPicture disableRemotePlayback controlsList="nodownload noplaybackrate nofullscreen" />)}
    </div>
  </div>;
}
