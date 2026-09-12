import type * as React from "react";
import type { ModelViewerElement } from "@google/model-viewer";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<React.HTMLAttributes<ModelViewerElement>, ModelViewerElement> & {
        src: string;
        poster?: string;
        alt?: string;
        ar?: boolean;
        exposure?: string;
        loading?: "eager" | "lazy";
        reveal?: "auto" | "manual";
      };
    }
  }
}
