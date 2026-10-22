import { useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
export default function QrScanner({ onResult, onClose }) {
  const video = useRef();
  const [error, setError] = useState("");
  useEffect(() => {
    let stream;
    let timer;
    const start = async () => {
      if (!("BarcodeDetector" in window)) {
        setError(
          "This browser does not support camera QR detection. Use the OTP fallback.",
        );
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        video.current.srcObject = stream;
        await video.current.play();
        const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        timer = setInterval(async () => {
          try {
            const codes = await detector.detect(video.current);
            if (codes[0]?.rawValue) onResult(codes[0].rawValue);
          } catch {}
        }, 350);
      } catch {
        setError("Camera access is unavailable. Use the OTP fallback.");
      }
    };
    start();
    return () => {
      clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onResult]);
  return (
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-slate-950/85 p-4">
      <section className="w-full max-w-[460px] rounded-2xl bg-white p-4 shadow-2xl">
        <header className="mb-3 flex items-center gap-2">
          <Camera />
          <b>Scan handover QR</b>
          <button
            onClick={onClose}
            className="ml-auto grid size-9 place-items-center rounded-lg bg-transparent text-ink/60 hover:bg-ink/5"
          >
            <X />
          </button>
        </header>
        <video
          ref={video}
          muted
          playsInline
          className="aspect-square w-full rounded-2xl bg-slate-900 object-cover"
        />
        {error && (
          <p className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
