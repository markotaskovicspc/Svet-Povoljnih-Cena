"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { recordMetaEvent } from "@/lib/analytics/meta-client";

export function MetaPixel({ pixelId }: { pixelId: string }) {
  const pathname = usePathname();
  const lastTrackedPath = useRef<string | null>(null);

  useEffect(() => {
    if (lastTrackedPath.current === pathname) return;
    if (recordMetaEvent({ name: "PageView" })) {
      lastTrackedPath.current = pathname;
    }
  }, [pathname]);

  return (
    <>
      <Script id="meta-pixel-bootstrap" strategy="afterInteractive">
        {`!function(f){if(f.fbq)return;var n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[]}(window);`}
      </Script>
      <Script
        id="meta-pixel-script"
        src="https://connect.facebook.net/en_US/fbevents.js"
        strategy="afterInteractive"
        data-pixel-id={pixelId}
      />
    </>
  );
}
