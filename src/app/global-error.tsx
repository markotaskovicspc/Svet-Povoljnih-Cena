"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="sr-Latn"><body><main style={{maxWidth:640,margin:"80px auto",padding:24,fontFamily:"system-ui",textAlign:"center"}}><h1>Stranica trenutno nije dostupna</h1><p>Osvežite stranicu ili pokušajte ponovo kasnije.</p><button type="button" onClick={reset}>Pokušaj ponovo</button></main></body></html>;
}
