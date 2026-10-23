import { Link, useLocation } from "react-router-dom";
import { Headphones, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";

export default function VoiceWelcomePrompt() {
  const { user, voicePrompt, dismissVoicePrompt } = useAuth();
  const { pathname } = useLocation();
  if (!user || !voicePrompt || pathname === "/voice") return null;
  return (
    <section
      aria-label="Voice assistant invitation"
      className="border-b border-mesh-200 bg-mesh-50"
    >
      <div className="mx-auto flex max-w-7xl items-start gap-3 px-4 py-4 sm:items-center sm:px-6">
        <Headphones
          size={21}
          aria-hidden="true"
          className="mt-1 shrink-0 text-mesh-700 sm:mt-0"
        />
        <div className="min-w-0 flex-1 text-sm leading-6 sm:flex sm:items-center sm:gap-4">
          <p>
            <strong>Welcome to CampusMesh.</strong> Need a hand getting started?
          </p>
          <Link
            onClick={dismissVoicePrompt}
            to="/voice"
            className="inline-flex min-h-11 items-center font-bold text-mesh-700 underline underline-offset-4"
          >
            Start AI voice
          </Link>
        </div>
        <button
          onClick={dismissVoicePrompt}
          aria-label="Dismiss voice invitation"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-mesh-100"
        >
          <X size={19} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
