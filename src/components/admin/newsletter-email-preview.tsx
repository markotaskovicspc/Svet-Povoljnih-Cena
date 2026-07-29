"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function NewsletterEmailPreview({ html }: { html: string }) {
  const [mobile, setMobile] = useState(false);
  return (
    <div>
      <div className="mb-3 flex gap-2">
        <Button type="button" variant={mobile ? "outline" : "secondary"} size="sm" onClick={() => setMobile(false)}>Desktop</Button>
        <Button type="button" variant={mobile ? "secondary" : "outline"} size="sm" onClick={() => setMobile(true)}>Mobilni</Button>
      </div>
      <div className="overflow-auto rounded-xl bg-muted-bg/60 p-4">
        <iframe
          title="Pregled newsletter poruke"
          srcDoc={html}
          sandbox=""
          className="mx-auto h-[720px] rounded-lg border border-border bg-white transition-[width]"
          style={{ width: mobile ? 390 : "100%", maxWidth: "100%" }}
        />
      </div>
    </div>
  );
}
